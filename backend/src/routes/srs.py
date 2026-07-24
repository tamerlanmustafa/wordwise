"""
Spaced-repetition review endpoints (WordWise Plus).

See docs/MONETIZATION_PLAN.md §3 / §9. Leitner scheduler: box 1..5 with
intervals 1d/3d/7d/14d/30d. "Got it" advances the box, "forgot" drops to
box 1. Every saved word starts at box 1 / due now, so first session pulls
exactly what the user has saved.

Free users get N preview sessions (SRS_FREE_PREVIEW_SESSIONS env, default 3)
before they hit the paywall. Admin preview toggle is client-side — the
server authorizes based on the real subscription_tier / is_admin, which
matches what admins see when they flip to "Free view": the server ALSO
treats them as premium (they are), but the client simulates the paywall UI.
To simulate the actual gating end-to-end, admins can create a comped account
from the grant UI and log in as that user instead.
"""

from __future__ import annotations

import os
import logging
import random
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from prisma import Prisma

from ..database import get_db
from ..middleware.auth import get_current_active_user
from ..services.chest_service import award_session_chest
from ..services.milestone_service import parse_unlocked
from ..services.movie_progress_service import recompute_for_user_movie
from ..services.session_kinds import (
    VALID_KINDS,
    compose_for_kind,
)
from ..services.quiz_service import build_translation_choices
from ..services.sentence_bank_service import get_llm_examples_for_lemmas
from ..services.srs_engine import (
    BOX_INTERVALS_DAYS,
    MAX_BOX,
    advance_user_rollup_after_review,
    advance_word_after_review,
    can_free_user_start_session_today,
    next_due_after,
)
from ..services.translation_service import TranslationService
from ..utils.subscription import is_premium

# Friendly POS labels surfaced on the typing-card hint chip. Anything
# spaCy returns outside this map gets dropped (no chip rather than a
# confusing "X" / "PART" tag).
_POS_FRIENDLY: dict[str, str] = {
    "NOUN": "noun",
    "PROPN": "noun",
    "VERB": "verb",
    "AUX":  "verb",
    "ADJ":  "adj",
    "ADV":  "adv",
}


def _lemmatize_one(word: str) -> tuple[str, Optional[str]]:
    """Return `(lemma, friendly_pos)` for a single surface form via
    spaCy (the same singleton the lemmatization service uses for full
    scripts). Falls back to the input + None on any error so a flaky
    spaCy load never breaks card composition.

    The lemma is lowercased so display + downstream lookups
    (translation MCQ) all key on a canonical form."""
    w = (word or "").strip()
    if not w:
        return word, None
    try:
        from ..services.lemmatization_service import get_nlp
        nlp = get_nlp()
        doc = nlp(w)
        if len(doc) == 0:
            return w.lower(), None
        tok = doc[0]
        lemma = (tok.lemma_ or w).lower().strip()
        if not lemma:
            lemma = w.lower()
        return lemma, _POS_FRIENDLY.get(tok.pos_)
    except Exception as e:
        logger.warning(f"[srs.start] lemmatize failed for '{word}': {e}")
        return w.lower(), None


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/srs", tags=["srs"])

# How many cards to surface per session. Small enough to stay under the
# "5–10 min session" target in the plan.
SESSION_SIZE = int(os.environ.get("SRS_SESSION_SIZE", "10"))

# Free-preview gate. Controls how many review sessions a non-premium user
# can start before the paywall fires. Variant B from the A/B test in §3.
FREE_PREVIEW_SESSIONS = int(os.environ.get("SRS_FREE_PREVIEW_SESSIONS", "3"))

class MCQChoice(BaseModel):
    word: str
    is_correct: bool


class ReviewCard(BaseModel):
    user_word_id: int
    word: str
    movie_id: Optional[int]
    movie_title: Optional[str] = None
    srs_box: int
    srs_due_at: datetime
    definition: Optional[str] = None
    example_sentence: Optional[str] = None
    cefr_level: Optional[str] = None
    # Card variant: 'mcq' — a translation MCQ whose distractors are the
    # other deck words' translations. Cards without one (no translation)
    # are skipped. The legacy typed-translation 'type' card was removed
    # with v0.8; the 'synonym_mcq' variant was retired with v0.9.
    card_type: str = "mcq"
    # Present for 'mcq': 4 translation entries, exactly one is_correct.
    choices: Optional[list[MCQChoice]] = None
    pos: Optional[str] = None
    # Canonical translation — the correct 'mcq' choice, echoed for
    # callout copy.
    translation: Optional[str] = None


class SessionStartResponse(BaseModel):
    cards: list[ReviewCard]
    total_due: int
    session_size: int
    # Free-preview budget the client uses to show the paywall nudge.
    is_preview: bool
    previews_remaining: int
    # v0.7.2 — which practice tile produced this session. Echoed back so
    # the client can confirm + cross-check against `last_session_kind`
    # on the next /daily/state read.
    kind: str = "quick_recall"


class TodaysWordResponse(BaseModel):
    word: str
    translated_word: Optional[str]
    example_sentence: Optional[str]
    translated_sentence: Optional[str]
    cefr_level: Optional[str]
    # Legacy movie attribution. Today's word is no longer drawn from a specific
    # movie, so these are always None — kept for backward compatibility with
    # older client builds that still read the field.
    movie_title: Optional[str] = None
    movie_poster_url: Optional[str] = None
    movie_id: Optional[int] = None


class ReviewBody(BaseModel):
    user_word_id: int
    correct: bool  # True = "Got it", False = "Forgot"


class ReviewResponse(BaseModel):
    user_word_id: int
    new_box: int
    next_due_at: datetime


class ChestPayload(BaseModel):
    kind: str   # 'xp_small' | 'xp_large' | 'freeze' | 'cosmetic'
    label: str  # human-readable, drives the chest reveal headline
    payload: dict  # type-specific data (xp amount, cosmetic name, …)


class CompleteSessionResponse(BaseModel):
    chest: Optional[ChestPayload] = None
    already_claimed: bool
    correct_count: int
    total_count: int
    streak: int
    # v0.6 W10: full inventory; client diffs against an AsyncStorage
    # last-seen list to fire MilestoneUnlockModal for new entries.
    unlocked_cosmetics: list[str] = []


class CompleteSessionBody(BaseModel):
    correct_count: int = 0
    total_count: int = 0


class StatsResponse(BaseModel):
    total_saved: int
    due_now: int
    due_today: int
    by_box: dict[int, int]
    is_premium: bool
    previews_remaining: int
    current_streak: int
    longest_streak: int
    total_reviews: int
    total_correct: int
    retention_pct: int


@router.get("/stats", response_model=StatsResponse)
async def srs_stats(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """Lightweight counts for the HomeScreen review CTA. Cheap queries only."""
    now = datetime.now(timezone.utc)
    end_of_day = now.replace(hour=23, minute=59, second=59, microsecond=0)

    total_saved = await db.userword.count(where={"userId": current_user.id})
    due_now = await db.userword.count(
        where={"userId": current_user.id, "srsDueAt": {"lte": now}}
    )
    due_today = await db.userword.count(
        where={"userId": current_user.id, "srsDueAt": {"lte": end_of_day}}
    )

    by_box: dict[int, int] = {}
    for b in range(1, MAX_BOX + 1):
        by_box[b] = await db.userword.count(
            where={"userId": current_user.id, "srsBox": b}
        )

    premium = is_premium(current_user)
    # Under the new daily-cap model: 1 free session/day, premium unlimited.
    # `previews_remaining` is now "can the free user start one right now"
    # (0 or 1), preserved for legacy mobile clients that read this field.
    if premium:
        remaining = FREE_PREVIEW_SESSIONS
    else:
        last_started = getattr(current_user, "srsLastSessionStartedAt", None)
        remaining = 1 if can_free_user_start_session_today(last_started, now=now) else 0

    total_reviews = getattr(current_user, "srsTotalReviews", 0) or 0
    total_correct = getattr(current_user, "srsTotalCorrect", 0) or 0
    retention_pct = round((total_correct / total_reviews) * 100) if total_reviews > 0 else 0

    return StatsResponse(
        total_saved=total_saved,
        due_now=due_now,
        due_today=due_today,
        by_box=by_box,
        is_premium=premium,
        previews_remaining=remaining,
        current_streak=getattr(current_user, "srsCurrentStreak", 0) or 0,
        longest_streak=getattr(current_user, "srsLongestStreak", 0) or 0,
        total_reviews=total_reviews,
        total_correct=total_correct,
        retention_pct=retention_pct,
    )


_CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]


def _band_levels_around(level: str) -> list[str]:
    """CEFR ±1 band (e.g. B1 → ['A2','B1','B2']). Unknown level → B1 band."""
    try:
        i = _CEFR_LEVELS.index(level)
    except ValueError:
        i = _CEFR_LEVELS.index("B1")
    return _CEFR_LEVELS[max(0, i - 1): min(len(_CEFR_LEVELS), i + 2)]


async def _pad_with_fresh_reel_lemmas(
    db: Prisma,
    *,
    user_id: int,
    user_level: str,
    excluded_words: set[str],
    needed: int,
    restrict_movie_id: Optional[int] = None,
):
    """Top up a short SRS queue with fresh lemmas from the user's reel.

    Walks reel movies in position order, pulling top-frequency lemmas at
    the user's CEFR ±1 band that aren't yet in `user_words` and aren't in
    the running `excluded_words` set. Each picked lemma gets a new
    UserWord row (defaults: srsBox=1, srsDueAt=now) so it surfaces in
    the response with a real id and naturally enters the SRS lifecycle.

    `restrict_movie_id` constrains the pull to that one movie — used by
    the v0.7.2 Movie Deep-Dive tile so padding stays inside the user's
    pick rather than spilling into other reel movies.

    Returns the list of newly-created UserWord rows (already fetched), in
    the order they were picked. Empty list when the reel can't fill the
    gap (no reel, no movie data, or no fresh lemmas at this level).
    """
    if needed <= 0:
        return []
    reel = await db.userreelmovie.find_many(
        where={"userId": user_id},
        order={"position": "asc"},
    )
    if not reel:
        return []
    tmdb_ids = [r.tmdbId for r in reel]
    movies = await db.movie.find_many(where={"tmdbId": {"in": tmdb_ids}})
    tmdb_to_movie_id = {m.tmdbId: m.id for m in movies}

    band = _band_levels_around(user_level)
    band_placeholders = ",".join(f"${i + 4}" for i in range(len(band)))

    created_ids: list[int] = []
    for r in reel:
        if len(created_ids) >= needed:
            break
        movie_id = tmdb_to_movie_id.get(r.tmdbId)
        if movie_id is None:
            continue
        # Deep-dive: skip every reel movie except the picked one.
        if restrict_movie_id is not None and movie_id != restrict_movie_id:
            continue
        # Over-fetch (2x remaining) to give us headroom against the
        # in-flight excluded_words dedupe below.
        remaining = needed - len(created_ids)
        rows = await db.query_raw(
            f"""
            SELECT l.lemma
            FROM movie_lemma_mappings mlm
            JOIN lemmas l ON l.id = mlm.lemma_id
            WHERE mlm.movie_id = $1
              AND l.cefr_level::text IN ({band_placeholders})
              AND NOT EXISTS (
                  SELECT 1 FROM user_words uw
                  WHERE uw.user_id = $2
                    AND LOWER(uw.word) = LOWER(l.lemma)
              )
              AND NOT EXISTS (
                  SELECT 1 FROM hidden_words hw
                  WHERE LOWER(hw.word) = LOWER(l.lemma)
              )
            ORDER BY mlm.frequency_in_movie DESC, l.frequency_rank ASC NULLS LAST
            LIMIT $3
            """,
            movie_id, user_id, remaining * 2, *band,
        )
        for row in rows:
            if len(created_ids) >= needed:
                break
            word = row["lemma"].lower()
            if word in excluded_words:
                continue
            uw = await db.userword.create(data={
                "userId": user_id,
                "word": word,
                "movieId": movie_id,
            })
            created_ids.append(uw.id)
            excluded_words.add(word)

    if not created_ids:
        return []
    # Refetch in creation order so the caller can hydrate uniformly with
    # the existing due_rows path.
    fresh = await db.userword.find_many(where={"id": {"in": created_ids}})
    by_id = {r.id: r for r in fresh}
    return [by_id[i] for i in created_ids if i in by_id]


@router.post("/session/start", response_model=SessionStartResponse)
async def start_session(
    kind: str = Query("quick_recall", description="Practice tile (v0.7.2). One of "
                                                 "quick_recall / tough_words / "
                                                 "movie_deep_dive."),
    movie_id: Optional[int] = Query(None, description="Required when kind=movie_deep_dive."),
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """
    Claim a new review session.

    Free users: one session per UTC day (the daily 2-min habit). Hitting
    /srs/session/start a second time the same day returns HTTP 402 with
    a `srs_daily_cap_reached` paywall payload — premium unlocks unlimited.

    v0.7.2: the user picks a "practice tile" (`kind` param) before
    starting. Default `quick_recall` matches the v0.7.1 behaviour for
    older clients that don't pass the param. Each kind has its own
    queue composer in `services/session_kinds.py`. The kind is stamped
    on `User.srsLastSessionKind` so the Practice tab can render the
    matching tile as done-today.

    v0.7.3: streak-based per-kind unlocks have been retired. The
    Practice tab is now a linear path with a client-side cursor — any
    kind is reachable in order, and progression is sequential. The
    KIND_UNLOCK_THRESHOLDS table is preserved in session_kinds.py for
    backward compatibility with stale clients but is no longer
    enforced server-side.

    The legacy `srsFreePreviewsUsed` counter is no longer consulted; the
    column remains in the schema for backward compatibility with older
    mobile builds that still poll /srs/stats.
    """
    # v0.7.2 — validate kind + movie_id requirement.
    if kind not in VALID_KINDS:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown session kind: {kind}. "
                   f"Expected one of {sorted(VALID_KINDS)}.",
        )
    if kind == "movie_deep_dive" and movie_id is None:
        raise HTTPException(
            status_code=422,
            detail="movie_deep_dive requires the `movie_id` query parameter.",
        )

    premium = is_premium(current_user)
    now = datetime.now(timezone.utc)

    if not premium:
        last_started = getattr(current_user, "srsLastSessionStartedAt", None)
        if not can_free_user_start_session_today(last_started, now=now):
            raise HTTPException(
                status_code=402,
                detail={
                    "paywall": "srs_daily_cap_reached",
                    "message": "You've finished today's free review. "
                               "Come back tomorrow — or upgrade for unlimited sessions.",
                },
            )

    # Count true due-now debt before padding so the header value reflects
    # what the user actually has waiting, not the inflated post-padding total.
    # Note: this stays scoped to all due cards (not kind-restricted) so the
    # header value reflects total debt, not the slice this tile carved.
    total_due = await db.userword.count(
        where={"userId": current_user.id, "srsDueAt": {"lte": now}}
    )

    # v0.7.2 — dispatch to the per-kind composer instead of the fixed
    # due-today query. `compose_for_kind` raises ValueError for invalid
    # combos; we already validated above so it shouldn't trigger.
    due_rows = await compose_for_kind(
        db,
        kind=kind,
        user_id=current_user.id,
        movie_id=movie_id,
        now=now,
    )

    # Pad short sessions with fresh lemmas from the next reel movie so
    # the daily 2-min habit always has SESSION_SIZE cards to chew on.
    # Movie Deep-Dive constrains padding to the picked movie so the
    # session stays "about that one film".
    # Dedupe by lemma before padding. Cards display `word=lemma` (below),
    # so two saved inflections of one word — e.g. "run" and "running",
    # both lemmatize to "run" — would otherwise surface as two
    # identical-looking cards: the user answers one and is immediately
    # asked the "same word" again, with the session counter ticking up.
    # Keep the first (oldest-due / lowest-id, per composer ordering) row
    # for each lemma. The lemma set we build here also seeds the padding
    # exclusion so fresh reel lemmas can't reintroduce a collision — the
    # padding filter keyed on surface form, which let a freshly-padded
    # "run" slip past an already-saved "running".
    session_rows: list = []
    seen_lemmas: set[str] = set()
    for r in due_rows:
        lemma = _lemmatize_one(r.word)[0]
        if lemma in seen_lemmas:
            continue
        seen_lemmas.add(lemma)
        session_rows.append(r)

    if len(session_rows) < SESSION_SIZE:
        raw_level = getattr(current_user, "proficiencyLevel", None)
        user_level = raw_level.value if hasattr(raw_level, "value") else (raw_level or "B1")
        fresh_rows = await _pad_with_fresh_reel_lemmas(
            db,
            user_id=current_user.id,
            user_level=str(user_level),
            excluded_words=set(seen_lemmas),
            needed=SESSION_SIZE - len(session_rows),
            restrict_movie_id=movie_id if kind == "movie_deep_dive" else None,
        )
        session_rows.extend(fresh_rows)

    # Hydrate cards with definitions and movie titles
    word_texts = list({r.word for r in session_rows})
    movie_ids = list({r.movieId for r in session_rows if r.movieId})

    # v0.7 §7 — lemmatize every surface form once up front. Downstream
    # translation/CEFR lookups all key on the lemma so 'hated'
    # is studied as 'hate'. user_word_id keeps pointing at the original
    # row, so /srs/review still maps the correct DB record on submit.
    lemma_pos_map: dict[str, tuple[str, Optional[str]]] = {
        w: _lemmatize_one(w) for w in word_texts
    }
    unique_lemmas = list({lemma_pos_map[w][0] for w in word_texts})

    def_map: dict[str, tuple] = {}
    pos_map: dict[str, Optional[str]] = {}
    if word_texts:
        # Look up definitions / example sentences for BOTH the surface
        # forms and the lemmas — `words` rows are sparse and may be
        # keyed on either depending on how they were ingested.
        defs = await db.word.find_many(
            where={"word": {"in": list(set(word_texts + unique_lemmas))}}
        )
        for d in defs:
            # Keep the row whether or not it has a definition — the
            # example sentence is independently useful (we surface it
            # on the typing card's IN CONTEXT callout).
            if d.word not in def_map:
                def_map[d.word] = (d.definition, d.example_sentence, getattr(d, "difficulty_level", None))
            if d.word not in pos_map and getattr(d, "part_of_speech", None):
                pos_map[d.word] = d.part_of_speech

    # v0.7 §7 — example sentences for the IN CONTEXT callout. Global
    # LLM-authored (Haiku) sentences only — subtitle extracts read like
    # dialogue fragments and are deliberately excluded, so a lemma the
    # sentence worker hasn't reached yet shows no example rather than a
    # raw movie line.
    example_by_lemma: dict[str, str] = {}
    if unique_lemmas:
        try:
            example_by_lemma = await get_llm_examples_for_lemmas(db, unique_lemmas)
            logger.info(
                "[srs.start] llm sentence hits: %d / %d lemmas (%s)",
                len(example_by_lemma), len(unique_lemmas),
                ",".join(sorted(example_by_lemma.keys())[:8]),
            )
        except Exception as e:
            logger.warning(f"[srs.start] sentence lookup failed: {e}")

    movie_map: dict[int, str] = {}
    if movie_ids:
        movies = await db.movie.find_many(where={"id": {"in": movie_ids}})
        for m in movies:
            movie_map[m.id] = m.title

    # Look up CEFR levels from word classifications. We probe both
    # surface form and lemma so 'hated' (rare in classifications) still
    # picks up CEFR through 'hate'.
    cefr_map: dict[str, str] = {}
    if word_texts:
        cefr_rows = await db.query_raw(
            """SELECT DISTINCT ON (wc.word) wc.word, wc.cefr_level
               FROM word_classifications wc
               WHERE wc.word = ANY($1::text[])
               ORDER BY wc.word, wc.id DESC""",
            list(set(word_texts + unique_lemmas)),
        )
        for r in cefr_rows:
            # UNKNOWN is a "could not classify" marker, not a level (#91).
            # cefr_level is Optional, so leave it unset rather than render a
            # word the user saved with an "UNKNOWN" badge.
            if r["cefr_level"] != "UNKNOWN":
                cefr_map[r["word"]] = r["cefr_level"]

    # v0.7 §7 — batch-translate the LEMMAS (not surface forms) so the
    # translation MCQ matches the canonical word the user is studying.
    # English natives get an empty map (translating en→en is gibberish),
    # so their words drop out below — the app's onboarding only offers
    # non-English native languages, making that a legacy-account edge.
    target_lang = (getattr(current_user, "nativeLanguage", None) or "en").upper()
    translation_map: dict[str, str] = {}
    if unique_lemmas and target_lang != "EN":
        try:
            ts = TranslationService(db)
            results = await ts.batch_translate(
                texts=unique_lemmas,
                target_lang=target_lang,
                source_lang="en",
                user_id=current_user.id,
            )
            for w, res in zip(unique_lemmas, results):
                if not isinstance(res, dict) or "error" in res:
                    continue
                t = res.get("translated") or res.get("translation")
                if t and t.lower() != w.lower():
                    translation_map[w] = t
        except Exception as e:
            logger.warning(f"[srs.start] batch translate failed: {e}")

    cards: list[ReviewCard] = []
    skipped: list[str] = []
    # Last-line guard against a duplicate *displayed* word reaching the
    # client. session_rows is already deduped by lemma above, but the
    # hydration lemma (lemma_pos_map) is recomputed here, so we re-check
    # against the form actually shown to be safe against any drift.
    carded_lemmas: set[str] = set()
    # Fresh per-request RNG so choice ordering varies per session.
    rng = random.Random()
    for r in session_rows:
        lemma, spacy_pos = lemma_pos_map.get(r.word, (r.word.lower(), None))
        if lemma in carded_lemmas:
            continue
        carded_lemmas.add(lemma)
        # Prefer CEFR / definitions keyed on the lemma; fall back to
        # the surface form when the canonical row isn't classified yet.
        cefr = cefr_map.get(lemma) or cefr_map.get(r.word)
        def_entry = def_map.get(lemma) or def_map.get(r.word)
        pos_label = spacy_pos or pos_map.get(lemma) or pos_map.get(r.word)
        # Example sentence: global LLM sentence_bank rows only (lemma-
        # keyed; subtitle extracts excluded) → legacy Word.example_sentence
        # (words table is empty in prod, so effectively inert). Lemma
        # resolves irregular forms ("ran" → "run") to the canonical entry.
        example_sentence: Optional[str] = example_by_lemma.get(lemma)
        if not example_sentence and def_entry:
            example_sentence = def_entry[1]
        base = dict(
            user_word_id=r.id,
            word=lemma,
            movie_id=r.movieId,
            movie_title=movie_map.get(r.movieId) if r.movieId else None,
            srs_box=r.srsBox,
            srs_due_at=r.srsDueAt,
            definition=def_entry[0] if def_entry else None,
            example_sentence=example_sentence,
            cefr_level=cefr,
        )
        choices = build_translation_choices(lemma, translation_map, rng=rng)
        if choices:
            cards.append(ReviewCard(
                **base,
                card_type="mcq",
                pos=pos_label,
                translation=translation_map.get(lemma),
                choices=[MCQChoice(**c) for c in choices],
            ))
            continue

        # No translation MCQ (missing translation or too few distinct
        # deck translations for distractors) — drop the word from the
        # session. It stays in the SRS queue and gets retried next time
        # when data may have caught up.
        skipped.append(lemma)

    if skipped:
        logger.info(
            "[srs.start] dropped %d card(s) without a translation MCQ: %s",
            len(skipped), skipped[:10],
        )

    # Stamp the daily-cap field + the picked kind only when there was
    # actually work to do. Don't penalize a free user who taps "review"
    # into an empty queue.
    if cards:
        await db.user.update(
            where={"id": current_user.id},
            data={
                "srsLastSessionStartedAt": now,
                "srsLastSessionKind": kind,
            },
        )

    # `previews_remaining` is preserved in the response shape for legacy
    # mobile clients. Under the new daily-cap model it answers a different
    # question: "can the free user start a session right now?" 0 or 1 for
    # free, sentinel-high for premium.
    if premium:
        remaining = FREE_PREVIEW_SESSIONS
    else:
        # `cards` may have stamped the field above; if so, we just used today's
        # slot. Otherwise the queue was empty and the slot remains available.
        remaining = 0 if cards else 1

    return SessionStartResponse(
        cards=cards,
        total_due=total_due,
        session_size=SESSION_SIZE,
        is_preview=not premium,
        previews_remaining=remaining,
        kind=kind,
    )


@router.post("/review", response_model=ReviewResponse)
async def record_review(
    body: ReviewBody,
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """
    Record one card outcome. Correct → advance box, Forgot → reset to box 1.
    No preview budget consumed here — the cost was paid at session start.

    Both the per-card box update and the per-user rollup go through
    `srs_engine` so the quiz→SRS bridge (called from quiz completion)
    uses the exact same logic.
    """
    word_row = await db.userword.find_unique(where={"id": body.user_word_id})
    if word_row is None or word_row.userId != current_user.id:
        raise HTTPException(404, detail="card not found")

    now = datetime.now(timezone.utc)
    new_box, next_due = await advance_word_after_review(
        db,
        user_word_id=word_row.id,
        current_box=word_row.srsBox,
        correct=body.correct,
        now=now,
    )
    await advance_user_rollup_after_review(
        db,
        user_id=current_user.id,
        correct_count=1 if body.correct else 0,
        total_count=1,
        today=now.date(),
    )

    # Refresh the per-movie progress cache so the reel tile reflects this
    # card. No-op when the word isn't tied to a movie (e.g. cross-movie
    # SRS-only words created via the daily padding from a global pool).
    if word_row.movieId is not None:
        await recompute_for_user_movie(
            db,
            user_id=current_user.id,
            movie_id=word_row.movieId,
        )

    return ReviewResponse(
        user_word_id=word_row.id,
        new_box=new_box,
        next_due_at=next_due,
    )


@router.post("/session/complete", response_model=CompleteSessionResponse)
async def complete_session(
    body: CompleteSessionBody,
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """End-of-session chest reveal.

    Called by the client once after the last /srs/review of a daily
    session. Awards one chest per UTC day (enforced via
    `User.srsLastChestDate`); subsequent same-day calls return
    `already_claimed=true` with `chest=null` so the client can decide
    whether to suppress the reveal animation.

    `correct_count` / `total_count` are accepted for analytics / future
    chest-weighting; they're echoed back so the client UI doesn't need
    to redundantly compute them.
    """
    now = datetime.now(timezone.utc)
    today = now.date()

    user = await db.user.find_unique(where={"id": current_user.id})
    streak = (user.srsCurrentStreak or 0) if user else 0
    last_chest = user.srsLastChestDate if user else None
    unlocked = parse_unlocked(user.unlockedCosmetics) if user else []

    if last_chest == today:
        return CompleteSessionResponse(
            chest=None,
            already_claimed=True,
            correct_count=body.correct_count,
            total_count=body.total_count,
            streak=streak,
            unlocked_cosmetics=unlocked,
        )

    reward = await award_session_chest(db, user_id=current_user.id)
    await db.user.update(
        where={"id": current_user.id},
        data={"srsLastChestDate": today},
    )
    # Re-read in case the chest reward bumped XP/freezes which the
    # client wants to reconcile. Streak itself doesn't change here.
    return CompleteSessionResponse(
        chest=ChestPayload(**reward.as_dict()),
        already_claimed=False,
        correct_count=body.correct_count,
        total_count=body.total_count,
        streak=streak,
        unlocked_cosmetics=unlocked,
    )


_CEFR_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"]


@router.get("/today", response_model=Optional[TodaysWordResponse])
async def todays_word(
    skip: int = 0,
    target_lang: Optional[str] = None,
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """
    One word per hour matched to the user's proficiency level — the "Word of
    the Hour". Pass skip=N to get the Nth next word (used by the reload button).

    The word is drawn from the global Lemma table (any source) — not tied to a
    specific movie — and is guaranteed to have a globally-cached LLM example
    sentence so the card always renders. The candidate pool is the user's CEFR
    level plus one level above, with garbage filtered out via `hidden_words`.
    """
    import hashlib

    # Seed by UTC hour so the pick is stable within an hour and rotates hourly.
    hour_str = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H")
    seed = int(hashlib.md5(f"{current_user.id}:{hour_str}".encode()).hexdigest()[:8], 16) + skip

    raw_level = current_user.proficiencyLevel
    user_level = (raw_level.value if hasattr(raw_level, "value") else str(raw_level or "B1")).upper()
    resolved_target = (target_lang or current_user.nativeLanguage or "en").lower()

    # Pool = user's level + one step up (capped at C2) to stretch them slightly.
    try:
        level_idx = _CEFR_ORDER.index(user_level)
    except ValueError:
        level_idx = _CEFR_ORDER.index("B1")
    levels = [_CEFR_ORDER[level_idx]]
    if level_idx + 1 < len(_CEFR_ORDER):
        levels.append(_CEFR_ORDER[level_idx + 1])
    levels_sql = ",".join(f"'{lvl}'" for lvl in levels)

    logger.info(f"[today_word] user={current_user.id} levels={levels} target_lang={resolved_target}")

    # Pick lemmas at the target levels that:
    #   - aren't flagged as garbage in hidden_words (admin curation)
    #   - look like real English words (alphabetic, length >= 4)
    #   - have at least one global LLM-authored example sentence, so the card
    #     always has something to flip to
    candidates = await db.query_raw(
        f"""
        SELECT
            l.id              AS lemma_id,
            l.lemma           AS word,
            l.cefr_level::text AS cefr_level,
            l.frequency_rank
        FROM lemmas l
        WHERE l.cefr_level::text IN ({levels_sql})
          AND l.lemma ~ '^[a-zA-Z]+$'
          AND length(l.lemma) >= 4
          AND NOT EXISTS (
              SELECT 1 FROM hidden_words hw WHERE hw.word = l.lemma
          )
          AND EXISTS (
              SELECT 1
              FROM sentence_lemma_links sll
              JOIN sentence_bank sb ON sb.id = sll.sentence_id
              WHERE sll.lemma_id = l.id
                AND sb.movie_id IS NULL
                AND sb.source = 'llm'
          )
        ORDER BY l.frequency_rank ASC NULLS LAST
        LIMIT 2000
        """
    )

    logger.info(f"[today_word] candidates={len(candidates)} levels={levels}")

    if not candidates:
        logger.warning(f"[today_word] no eligible lemmas for levels={levels}")
        return None

    # Trim outer bands so we don't surface the most common (boring) or the
    # rarest (often noisy) words.
    n = len(candidates)
    lo = n // 10
    hi = n - (n // 5)
    pool = candidates[lo:hi] if hi > lo else candidates

    pick = pool[seed % len(pool)]

    # Fetch the LLM sentence linked to this lemma. Highest score wins; the
    # global LLM row is guaranteed by the EXISTS filter above.
    sentence_text: Optional[str] = None
    sentence_link = await db.sentencelemmalink.find_first(
        where={
            "lemmaId": pick["lemma_id"],
            "sentence": {"is": {"movieId": None, "source": "llm"}},
        },
        include={"sentence": True},
        order={"score": "desc"},
    )
    if sentence_link and sentence_link.sentence:
        sentence_text = sentence_link.sentence.sentence

    # Best-effort translations. Failures fall back to English-only display
    # rather than dropping the card entirely.
    translated_word: Optional[str] = None
    translated_sentence: Optional[str] = None
    if resolved_target and resolved_target.lower() != "en":
        from ..services.translation_service import TranslationService
        ts = TranslationService(db)
        try:
            word_tx = await ts.get_translation(pick["word"], resolved_target.upper(), "en")
            if word_tx and word_tx.get("translated"):
                translated_word = word_tx["translated"]
        except Exception as e:
            logger.warning(f"[today_word] word translation failed: {e}")
        if sentence_text:
            try:
                sent_tx = await ts.get_translation(sentence_text, resolved_target.upper(), "en")
                if sent_tx and sent_tx.get("translated"):
                    translated_sentence = sent_tx["translated"]
            except Exception as e:
                logger.warning(f"[today_word] sentence translation failed: {e}")

    return TodaysWordResponse(
        word=pick["word"],
        translated_word=translated_word,
        example_sentence=sentence_text,
        translated_sentence=translated_sentence,
        cefr_level=pick.get("cefr_level"),
    )
