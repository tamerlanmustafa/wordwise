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

import hashlib
import os
import logging
import random
import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from prisma import Prisma

from ..database import get_db
from ..middleware.auth import get_current_active_user
from ..services.cefr_registry import registry_levels
from ..services.chest_service import award_session_chest
from ..services.feed_pool import FEED_MIX_LEVELS, feed_eligibility_sql
from ..services.milestone_service import parse_unlocked
from ..services.movie_progress_service import recompute_for_user_movie
from ..services.session_kinds import (
    LIST_KINDS,
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
from ..utils.nlp_executor import run_nlp
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


def _lemmatize_many(words: list[str]) -> dict[str, tuple[str, Optional[str]]]:
    """Return `{surface_form: (lemma, friendly_pos)}` for a batch of surface
    forms, in one spaCy pass over the whole batch (issue #144).

    Uses the same singleton the lemmatization service uses for full scripts,
    driven through `nlp.pipe` — a session's ten words cost ~1.7ms batched
    against ~6.4ms parsed one at a time, and more importantly they cost the
    NLP worker *one* job instead of ten. Never call this from an `async def`
    directly; it is CPU-bound, so it goes through `run_nlp`.

    Falls back to the lowercased input on any error so a flaky spaCy load
    never breaks card composition. The fallback is batch-wide because the
    failure it guards against is model-level (an unloadable model), not
    per-word.

    The lemma is lowercased so display + downstream lookups (translation
    MCQ) all key on a canonical form."""
    out: dict[str, tuple[str, Optional[str]]] = {}
    # dict.fromkeys dedupes while keeping order, so a form repeated across
    # rows is parsed once and the pipe order still lines up with the input.
    pending = [w for w in dict.fromkeys(words) if (w or "").strip()]
    for word in words:
        if not (word or "").strip():
            out[word] = (word, None)
    if not pending:
        return out

    try:
        from ..services.lemmatization_service import get_nlp
        nlp = get_nlp()
        for word, doc in zip(pending, nlp.pipe([w.strip() for w in pending])):
            w = word.strip()
            if len(doc) == 0:
                out[word] = (w.lower(), None)
                continue
            tok = doc[0]
            lemma = (tok.lemma_ or w).lower().strip() or w.lower()
            out[word] = (lemma, _POS_FRIENDLY.get(tok.pos_))
    except Exception as e:
        logger.warning(f"[srs.start] lemmatize failed for {len(pending)} word(s): {e}")
        for word in pending:
            out.setdefault(word, (word.strip().lower(), None))
    return out


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


class SentenceMatch(BaseModel):
    """Character offsets of the inflected surface form inside `sentence`.

    Computed server-side so the Explore card can gold-wash the form that
    actually appears ("lingered"), not the dictionary lemma ("linger").
    """
    start: int
    end: int


class FeedItem(BaseModel):
    lemma_id: int
    word: str
    # No IPA source exists yet (no pronunciation column on `lemmas`), so this
    # is always None today. The card hides the line when null, so wiring a
    # source in later needs no client change.
    ipa: Optional[str] = None
    pos: Optional[str] = None
    cefr: Optional[str] = None
    sentence: str
    sentence_match: Optional[SentenceMatch] = None
    translated_word: Optional[str] = None
    translated_sentence: Optional[str] = None
    translation_source: Optional[str] = None


class FeedResponse(BaseModel):
    items: list[FeedItem]
    # What the server could actually honour this page. Diverges from the
    # requested mix when a CEFR bucket runs dry — see `_allocate_mix`.
    mix_applied: dict[str, int]
    # False once every bucket is drained, so the client stops paging.
    has_more: bool


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


#: One row per Leitner box, with the two due-window counts computed in the same
#: pass. `FILTER` is a per-aggregate WHERE, so all three counts come off a
#: single scan of the user's rows instead of one query each (issue #134).
_STATS_ROLLUP_SQL = """
    SELECT srs_box,
           COUNT(*)                                  AS in_box,
           COUNT(*) FILTER (WHERE srs_due_at <= $2)  AS due_now,
           COUNT(*) FILTER (WHERE srs_due_at <= $3)  AS due_today
    FROM user_words
    WHERE user_id = $1
    GROUP BY srs_box
"""


def _assemble_box_stats(rows) -> tuple[int, int, int, dict[int, int]]:
    """Fold the per-box rollup rows into the totals `/srs/stats` returns.

    Boxes 1..MAX_BOX are always present in `by_box` — a user with nothing in
    box 4 must still see `4: 0`, which the GROUP BY cannot emit on its own.
    Rows outside that range (a box written by an older engine) still count
    toward `total_saved` so the totals can't silently disagree with the table.
    """
    by_box: dict[int, int] = {b: 0 for b in range(1, MAX_BOX + 1)}
    total_saved = due_now = due_today = 0

    for row in rows:
        in_box = int(row["in_box"] or 0)
        total_saved += in_box
        due_now += int(row["due_now"] or 0)
        due_today += int(row["due_today"] or 0)
        box = row["srs_box"]
        if box is not None and int(box) in by_box:
            by_box[int(box)] = in_box

    return total_saved, due_now, due_today, by_box


@router.get("/stats", response_model=StatsResponse)
async def srs_stats(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """Lightweight counts for the HomeScreen review CTA. Cheap queries only."""
    now = datetime.now(timezone.utc)
    end_of_day = now.replace(hour=23, minute=59, second=59, microsecond=0)

    rows = await db.query_raw(_STATS_ROLLUP_SQL, current_user.id, now, end_of_day)
    total_saved, due_now, due_today, by_box = _assemble_box_stats(rows)

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
    movie_ids: Optional[list[int]] = None,
):
    """Top up a short SRS queue with fresh lemmas from a set of movies.

    Walks those movies in order, pulling top-frequency lemmas at the user's
    CEFR ±1 band that aren't yet in `user_words` and aren't in the running
    `excluded_words` set. Each picked lemma gets a new UserWord row
    (defaults: srsBox=1, srsDueAt=now) so it surfaces in the response with a
    real id and naturally enters the SRS lifecycle.

    Which movies:
      • default — the user's reel, in position order.
      • `movie_ids` — an explicit ordered list of internal `movies.id`,
        used by the Lists tab's `list_films` kind so a films list draws from
        its own films rather than the reel. Without this a freshly-built
        films list could never practise: the user has no UserWord rows for
        a film they have not studied yet.

    `restrict_movie_id` further narrows to a single movie — used by the
    v0.7.2 Movie Deep-Dive tile so padding stays inside the user's pick
    rather than spilling into other reel movies.

    Returns the list of newly-created UserWord rows (already fetched), in
    the order they were picked. Empty list when the source can't fill the
    gap (no movies, no movie data, or no fresh lemmas at this level).
    """
    if needed <= 0:
        return []

    if movie_ids is not None:
        ordered_movie_ids = list(movie_ids)
    else:
        reel = await db.userreelmovie.find_many(
            where={"userId": user_id},
            order={"position": "asc"},
        )
        if not reel:
            return []
        tmdb_ids = [r.tmdbId for r in reel]
        movies = await db.movie.find_many(where={"tmdbId": {"in": tmdb_ids}})
        tmdb_to_movie_id = {m.tmdbId: m.id for m in movies}
        ordered_movie_ids = [
            tmdb_to_movie_id[r.tmdbId]
            for r in reel
            if r.tmdbId in tmdb_to_movie_id
        ]

    # Deep-dive: keep only the picked movie.
    if restrict_movie_id is not None:
        ordered_movie_ids = [m for m in ordered_movie_ids if m == restrict_movie_id]
    if not ordered_movie_ids:
        return []

    band = _band_levels_around(user_level)
    # Cast the parameters to the enum, never the column — see
    # `_eligible_lemma_candidates` for why `cefr_level::text` is a trap.
    band_placeholders = ",".join(f"${i + 4}::proficiencylevel" for i in range(len(band)))

    created_ids: list[int] = []
    for movie_id in ordered_movie_ids:
        if len(created_ids) >= needed:
            break
        # Over-fetch (2x remaining) to give us headroom against the
        # in-flight excluded_words dedupe below.
        remaining = needed - len(created_ids)
        rows = await db.query_raw(
            f"""
            SELECT l.lemma
            FROM movie_lemma_mappings mlm
            JOIN lemmas l ON l.id = mlm.lemma_id
            WHERE mlm.movie_id = $1
              AND l.cefr_level IN ({band_placeholders})
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
                                                 "movie_deep_dive / list_words / "
                                                 "list_films."),
    movie_id: Optional[int] = Query(None, description="Required when kind=movie_deep_dive."),
    list_id: Optional[int] = Query(None, description="Required when kind=list_words "
                                                    "or kind=list_films."),
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
    if kind in LIST_KINDS and list_id is None:
        raise HTTPException(
            status_code=422,
            detail=f"{kind} requires the `list_id` query parameter.",
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
        list_id=list_id,
        now=now,
    )

    # Lists tab: `list_films` pads from the list's own films, so resolve them
    # once here rather than inside the padding helper (which has no notion of
    # a list). Empty means the list has no film with catalogue vocabulary.
    pad_movie_ids: Optional[list[int]] = None
    if kind == "list_films":
        from ..services import lists as lists_service
        list_row = await lists_service.get_list_row(db, current_user.id, list_id)
        pad_movie_ids = await lists_service.list_movie_ids(db, current_user.id, list_row)

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
    #
    # Every surface form in the queue is parsed in one hop to the NLP worker
    # (#144). Composers cap at KIND_SESSION_SIZE, so this is ~10 words: cheap,
    # but it used to be ~10 separate spaCy calls sitting on the event loop,
    # which stalls every other request on a single-process API (#117).
    lemma_pos_map: dict[str, tuple[str, Optional[str]]] = {}
    if due_rows:
        lemma_pos_map = await run_nlp(_lemmatize_many, [r.word for r in due_rows])

    session_rows: list = []
    seen_lemmas: set[str] = set()
    for r in due_rows:
        lemma = lemma_pos_map.get(r.word, (r.word.lower(), None))[0]
        if lemma in seen_lemmas:
            continue
        seen_lemmas.add(lemma)
        session_rows.append(r)

    # `list_words` is deliberately excluded from padding: a words list must
    # practise its own members and nothing else, and its composer has already
    # materialised the unstudied ones. Padding it from the reel would put
    # words the user never put in the list into a session they started from
    # that list.
    if len(session_rows) < SESSION_SIZE and kind != "list_words":
        raw_level = getattr(current_user, "proficiencyLevel", None)
        user_level = raw_level.value if hasattr(raw_level, "value") else (raw_level or "B1")
        fresh_rows = await _pad_with_fresh_reel_lemmas(
            db,
            user_id=current_user.id,
            user_level=str(user_level),
            excluded_words=set(seen_lemmas),
            needed=SESSION_SIZE - len(session_rows),
            restrict_movie_id=movie_id if kind == "movie_deep_dive" else None,
            movie_ids=pad_movie_ids,
        )
        session_rows.extend(fresh_rows)

    # Hydrate cards with definitions and movie titles
    word_texts = list({r.word for r in session_rows})
    movie_ids = list({r.movieId for r in session_rows if r.movieId})

    # v0.7 §7 — lemmatize every surface form once up front. Downstream
    # translation/CEFR lookups all key on the lemma so 'hated'
    # is studied as 'hate'. user_word_id keeps pointing at the original
    # row, so /srs/review still maps the correct DB record on submit.
    #
    # The due rows were parsed above, so this second hop covers only the
    # forms padding just added — and is skipped entirely when nothing was
    # padded, which is the common case for a user with a full queue.
    fresh_words = [w for w in word_texts if w not in lemma_pos_map]
    if fresh_words:
        lemma_pos_map.update(await run_nlp(_lemmatize_many, fresh_words))
    unique_lemmas = list({
        lemma_pos_map.get(w, (w.lower(), None))[0] for w in word_texts
    })

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

    # CEFR levels come from the `lemmas` registry, not word_classifications
    # (#127). That table holds one row per (script, word), so the old
    # `DISTINCT ON (word) ... ORDER BY id DESC` badged the card with whichever
    # movie happened to be ingested last — 7,262 words disagreed with the
    # level Explore showed for the same word. The registry is the aggregate,
    # and it already drops UNKNOWN and the #91 A2-default rows, so a word it
    # cannot place gets no badge rather than an "UNKNOWN" one.
    #
    # We still probe both the surface form and the lemma: the registry is
    # lemma-keyed, so 'hated' misses and picks CEFR up through 'hate'.
    cefr_map: dict[str, str] = {}
    if word_texts:
        cefr_map = await registry_levels(db, word_texts + unique_lemmas)

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
    # client. session_rows is already deduped by lemma above, and since
    # #144 both passes read the same `lemma_pos_map` — but padding can
    # still introduce a form that lemmatizes onto a kept one, so we
    # re-check against the form actually shown.
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
        # cefr_map is registry-keyed, so lowercase — `r.word` is the surface
        # form the user saved and may be capitalised.
        cefr = cefr_map.get(lemma) or cefr_map.get(r.word.lower())
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

# Levels the Explore mix can address — owned by services/feed_pool.py, which the
# vocab-coverage report reads too, so "how deep is each level" is measured over
# exactly the levels the feed can serve (#116).
_FEED_MIX_LEVELS = FEED_MIX_LEVELS


def _parse_mix(raw: str) -> dict[str, int]:
    """Parse `A2:0,B1:70,B2:20,C1:10` into {level: percent}.

    Raises HTTPException(400) on anything malformed or not summing to 100 —
    a silently-renormalised mix would make the feed's distribution differ
    from what the user dialled in, with no way to tell.
    """
    mix: dict[str, int] = {}
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        level, _, pct = part.partition(":")
        level = level.strip().upper()
        if level not in _FEED_MIX_LEVELS:
            raise HTTPException(400, f"Unknown level in mix: {level!r}")
        try:
            value = int(pct)
        except ValueError:
            raise HTTPException(400, f"Non-numeric share for {level}: {pct!r}")
        if value < 0 or value > 100:
            raise HTTPException(400, f"Share for {level} out of range: {value}")
        mix[level] = value

    if not mix:
        raise HTTPException(400, "Empty mix")
    total = sum(mix.values())
    if total != 100:
        raise HTTPException(400, f"Mix must sum to 100, got {total}")
    return mix


def _allocate_mix(
    mix: dict[str, int],
    limit: int,
    available: dict[str, int],
) -> dict[str, int]:
    """Split `limit` slots across CEFR buckets in the requested proportions.

    A page of 20 at 70/20/10 draws 14 B1 / 4 B2 / 2 C1. Fractional slots go
    to the largest remainder so the page always totals `limit` when there is
    enough stock. When a bucket is short, its shortfall is redistributed
    across the buckets that still have headroom, largest requested share
    first, so the page stays full rather than short-changing the user.
    """
    if limit <= 0:
        return {}

    wanted = {lvl: pct for lvl, pct in mix.items() if pct > 0}
    if not wanted:
        return {}

    # Largest-remainder apportionment: floor everything, then hand out the
    # leftover slots to whichever levels lost the most to rounding.
    exact = {lvl: (pct / 100.0) * limit for lvl, pct in wanted.items()}
    counts = {lvl: int(value) for lvl, value in exact.items()}
    leftover = limit - sum(counts.values())
    if leftover > 0:
        by_remainder = sorted(
            wanted,
            key=lambda lvl: (-(exact[lvl] - counts[lvl]), _CEFR_ORDER.index(lvl)),
        )
        for lvl in by_remainder[:leftover]:
            counts[lvl] += 1

    # Clamp to stock, then push the shortfall onto whoever can still take it.
    deficit = 0
    for lvl in list(counts):
        stock = available.get(lvl, 0)
        if counts[lvl] > stock:
            deficit += counts[lvl] - stock
            counts[lvl] = stock

    if deficit:
        # Largest requested share first — the dominant level absorbs the
        # slack, which keeps the page feeling like the mix the user chose.
        receivers = sorted(
            wanted,
            key=lambda lvl: (-wanted[lvl], _CEFR_ORDER.index(lvl)),
        )
        # Repeat until nobody has headroom: one pass can leave slots unfilled
        # when the first receiver also caps out.
        progressed = True
        while deficit > 0 and progressed:
            progressed = False
            for lvl in receivers:
                if deficit <= 0:
                    break
                headroom = available.get(lvl, 0) - counts[lvl]
                if headroom > 0:
                    take = min(headroom, deficit)
                    counts[lvl] += take
                    deficit -= take
                    progressed = True

    return {lvl: n for lvl, n in counts.items() if n > 0}


def _page_plan(
    requested: dict[str, int],
    limit: int,
    stock: dict[str, int],
    page_index: int,
) -> tuple[dict[str, int], dict[str, int]]:
    """Where page `page_index` starts in each bucket, and what it draws.

    Replays every earlier page so the cursors account for buckets that ran
    dry along the way — allocation is pure arithmetic, so this is cheap
    even deep into a feed. Returns `(cursors, applied)`.
    """
    cursors = {lvl: 0 for lvl in stock}
    applied: dict[str, int] = {}
    for page in range(page_index + 1):
        remaining = {lvl: stock[lvl] - cursors[lvl] for lvl in stock}
        applied = _allocate_mix(requested, limit, remaining)
        if page < page_index:
            for lvl, n in applied.items():
                cursors[lvl] += n
    return cursors, applied


def _feed_seed(user_id: int, token: Optional[str]) -> int:
    """The shuffle seed for one user's feed ordering.

    `token` comes from the client, which mints a fresh one on every cold
    start, so each launch deals a different deck. It must be echoed back on
    every page of that launch: `offset` only addresses a stable sequence if
    every page hashes to the same seed, and a seed that drifted mid-session
    would make page 2 overlap page 1.

    Older clients send nothing. They fall back to the UTC day, which is the
    behaviour the feed shipped with — stable for a day, reshuffled overnight.

    The user id stays in the hash so two users passing the same token still
    get different orders.
    """
    if not token:
        token = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return int(hashlib.md5(f"{user_id}:{token}".encode()).hexdigest()[:8], 16)


def _sentence_match(
    sentence: str,
    matched_form: Optional[str],
    lemma: str,
) -> Optional[dict[str, int]]:
    """Locate the target word's surface form inside `sentence`.

    Prefers `sentence_lemma_links.matched_form` (what the tagger actually
    saw); falls back to the lemma so a link row with no recorded form still
    highlights something. Matching is case-insensitive and anchored to word
    boundaries so "art" doesn't light up inside "start".
    """
    for needle in (matched_form, lemma):
        if not needle:
            continue
        # `\b` only asserts a boundary next to a word character, so anchor
        # each end only when the needle actually starts/ends with one —
        # otherwise a form like "(net)" could never match.
        lead = r"\b" if needle[0].isalnum() or needle[0] == "_" else ""
        trail = r"\b" if needle[-1].isalnum() or needle[-1] == "_" else ""
        hit = re.search(
            f"{lead}{re.escape(needle)}{trail}", sentence, re.IGNORECASE
        )
        if hit:
            return {"start": hit.start(), "end": hit.end()}
    return None


async def _eligible_lemma_candidates(
    db: Prisma,
    levels: list[str],
    *,
    exclude_user_id: Optional[int] = None,
    limit: int = 2000,
) -> list[dict]:
    """Lemmas eligible to be surfaced as a study card.

    Shared by /today (Word of the Hour) and /feed (Explore). A candidate sits
    at one of `levels` and satisfies `feed_eligibility_sql` — real-word shape,
    not curated away in hidden_words, and guaranteed to have a global
    LLM-authored example sentence so the card always has something to show.
    That fragment is shared with the vocab-coverage report so the depth it
    reports is the depth this query can actually serve (#116).

    Pass `exclude_user_id` to also drop anything already in that user's
    user_words — the feed never re-shows a word you saved or marked known.

    `limit` is the total row budget, split evenly across `levels`: each level
    contributes at most `limit // len(levels)` of its most frequent words.
    """
    # `levels` is always drawn from _CEFR_ORDER by the callers, never from
    # raw user input, so inlining it is safe. The user id is parameterised.
    #
    # Compare against `cefr_level` bare, NOT `cefr_level::text`. The cast turns
    # a column reference into an expression, which costs twice: the planner has
    # no statistics for it and falls back to a guess (this filter estimated 425
    # rows against an actual 6,448), and the b-tree index on the column can no
    # longer supply an Index Cond, so a matching scan reads the whole index and
    # filters. Every level string here is a valid `proficiencylevel` label, so
    # the bare comparison is total.
    #
    # The cap is applied PER LEVEL (row_number partitioned by cefr_level), not
    # as one global `ORDER BY frequency_rank LIMIT n` (#116). Rank correlates
    # with level, so a global cap hands every slot to the easiest level in the
    # band and starves the hard one entirely: measured on prod, the 4,000-row
    # cap over A2+B1+B2+C1 returned 1,499 A2 / 1,417 B1 / 1,084 B2 and **zero**
    # of C1's 8,552 eligible lemmas, and the 2,000-row cap over a B2 user's
    # default B2+C1 band returned 2,000 B2 and zero C1. Their C1 bucket was
    # empty, so _page_plan redistributed the C1 share away and the feed silently
    # stopped stretching them.
    #
    # The outer ORDER BY only has to be deterministic — /feed reshuffles each
    # bucket with the session seed anyway — but /today indexes into this list by
    # a per-hour seed, so ties are broken on lemma_id to keep that pick stable
    # within the hour.
    levels_sql = ",".join(f"'{lvl}'" for lvl in levels)
    per_level = max(1, int(limit) // max(1, len(levels)))
    exclude_sql = ""
    args: list = []
    if exclude_user_id is not None:
        args.append(exclude_user_id)
        exclude_sql = """
          AND NOT EXISTS (
              SELECT 1 FROM user_words uw
              WHERE uw.user_id = $1 AND uw.word = l.lemma
          )
        """

    return await db.query_raw(
        f"""
        SELECT lemma_id, word, pos, cefr_level, frequency_rank
        FROM (
            SELECT
                l.id              AS lemma_id,
                l.lemma           AS word,
                l.pos             AS pos,
                l.cefr_level::text AS cefr_level,
                l.frequency_rank,
                row_number() OVER (
                    PARTITION BY l.cefr_level
                    ORDER BY l.frequency_rank ASC NULLS LAST, l.id
                ) AS rn
            FROM lemmas l
            WHERE l.cefr_level IN ({levels_sql})
              AND {feed_eligibility_sql("l")}
              {exclude_sql}
        ) ranked
        WHERE rn <= {per_level}
        ORDER BY frequency_rank ASC NULLS LAST, lemma_id
        """,
        *args,
    )


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

    logger.info(f"[today_word] user={current_user.id} levels={levels} target_lang={resolved_target}")

    # Pick lemmas at the target levels — see `_eligible_lemma_candidates` for
    # the filters (hidden_words, real-word shape, guaranteed LLM sentence).
    candidates = await _eligible_lemma_candidates(db, levels)

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


@router.get("/feed", response_model=FeedResponse)
async def word_feed(
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
    target_lang: Optional[str] = None,
    mix: Optional[str] = None,
    seed: Optional[str] = Query(None, max_length=64),
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """
    The Explore feed — an endless, level-mixed stream of single words.

    Same candidate pool as /today (real-word shape, hidden_words filtered,
    guaranteed global LLM sentence) plus an exclusion for anything already
    in the user's user_words, so saved and known words never come back.

    `mix` (e.g. `A2:0,B1:70,B2:20,C1:10`, must sum to 100) sets how much of
    each page comes from each CEFR level. Omit it to get the /today
    behaviour: the user's level plus one above.

    `seed` is an opaque client token that fixes the pick order. The app mints
    one per cold start and echoes it on every page, so each launch is a fresh
    shuffle while paging within a launch stays coherent. Omit it and the
    order falls back to being seeded per user per UTC day — see `_feed_seed`.
    """
    shuffle_seed = _feed_seed(current_user.id, seed)

    raw_level = current_user.proficiencyLevel
    user_level = (raw_level.value if hasattr(raw_level, "value") else str(raw_level or "B1")).upper()
    resolved_target = (target_lang or current_user.nativeLanguage or "en").lower()

    if mix:
        requested = _parse_mix(mix)
        levels = [lvl for lvl in _FEED_MIX_LEVELS if requested.get(lvl, 0) > 0]
    else:
        # No mix supplied — fall back to /today's band (level + one above),
        # split evenly so the page isn't dominated by whichever level
        # happens to have more stock.
        try:
            level_idx = _CEFR_ORDER.index(user_level)
        except ValueError:
            level_idx = _CEFR_ORDER.index("B1")
        levels = [_CEFR_ORDER[level_idx]]
        if level_idx + 1 < len(_CEFR_ORDER):
            levels.append(_CEFR_ORDER[level_idx + 1])
        share = 100 // len(levels)
        requested = {lvl: share for lvl in levels}
        # Hand any rounding remainder to the user's own level.
        requested[levels[0]] += 100 - share * len(levels)

    if not levels:
        return FeedResponse(items=[], mix_applied={}, has_more=False)

    candidates = await _eligible_lemma_candidates(
        db, levels, exclude_user_id=current_user.id, limit=4000
    )
    if not candidates:
        logger.warning(f"[feed] no eligible lemmas user={current_user.id} levels={levels}")
        return FeedResponse(items=[], mix_applied={}, has_more=False)

    # Bucket by level, then shuffle each bucket with the session seed. Same
    # user + same seed = same order, so `offset` addresses a stable sequence
    # for as long as the client keeps sending that seed.
    buckets: dict[str, list[dict]] = {lvl: [] for lvl in levels}
    for row in candidates:
        bucket = buckets.get((row.get("cefr_level") or "").upper())
        if bucket is not None:
            bucket.append(row)
    for lvl, rows in buckets.items():
        rng = random.Random(f"{shuffle_seed}:{lvl}")
        rng.shuffle(rows)

    page_index = offset // limit
    stock = {lvl: len(buckets[lvl]) for lvl in levels}
    cursors, applied = _page_plan(requested, limit, stock, page_index)

    picks: list[dict] = []
    for lvl, n in applied.items():
        start = cursors[lvl]
        picks.extend(buckets[lvl][start:start + n])
        cursors[lvl] += n

    if not picks:
        return FeedResponse(items=[], mix_applied={}, has_more=False)

    # Interleave so a page doesn't read as blocks of one level.
    rng = random.Random(f"{shuffle_seed}:page:{page_index}")
    rng.shuffle(picks)

    has_more = any(len(buckets[lvl]) - cursors[lvl] > 0 for lvl in levels)

    # One query for every pick's best sentence. is_representative wins, then
    # score — matching the ordering /today uses for its single lemma. The tie
    # break is spelled `sll.sentence_id`, not `sb.id`: same value, but stating
    # it on the link side makes the ORDER BY exactly ix_sll_global_lemma's key
    # order, so DISTINCT ON walks the index instead of sorting (#120).
    lemma_ids = [p["lemma_id"] for p in picks]
    sentence_rows = await db.query_raw(
        """
        SELECT DISTINCT ON (sll.lemma_id)
            sll.lemma_id      AS lemma_id,
            sb.sentence       AS sentence,
            sll.matched_form  AS matched_form
        FROM sentence_lemma_links sll
        JOIN sentence_bank sb ON sb.id = sll.sentence_id
        WHERE sll.lemma_id = ANY($1::int[])
          AND sll.is_global
        ORDER BY
          sll.lemma_id,
          sll.is_representative DESC,
          sll.score DESC NULLS LAST,
          sll.sentence_id ASC
        """,
        lemma_ids,
    )
    by_lemma = {r["lemma_id"]: r for r in sentence_rows}

    # Keep only picks that actually have a sentence. The EXISTS filter
    # guarantees one, but a link row can point at a sentence that was since
    # deleted — skip rather than ship a card with nothing to read.
    renderable = [
        (pick, by_lemma[pick["lemma_id"]])
        for pick in picks
        if by_lemma.get(pick["lemma_id"]) and by_lemma[pick["lemma_id"]].get("sentence")
    ]

    # Translate the whole page in one shot: one cache read, then one DeepL
    # request per 50 misses. Doing this per item cost 2 round trips per card
    # (40 for a page of 20) and dominated the endpoint's latency.
    translations: dict[str, str] = {}
    needs_translation = resolved_target and resolved_target.lower() != "en"
    if needs_translation and renderable:
        from ..services.translation_service import TranslationService
        ts = TranslationService(db)

        # Words and sentences share one batch — they are just strings to
        # DeepL, and one request beats two.
        to_translate: list[str] = []
        for pick, row in renderable:
            to_translate.append(pick["word"])
            to_translate.append(row["sentence"])

        try:
            results = await ts.batch_translate(
                texts=to_translate,
                target_lang=resolved_target.upper(),
                source_lang="en",
            )
            for source, result in zip(to_translate, results):
                value = result.get("translated")
                if value:
                    translations[source] = value
        except Exception as e:
            # An untranslated page still renders — the card hides the
            # translation block rather than failing.
            logger.warning(f"[feed] batch translation failed: {e}")

    items: list[FeedItem] = []
    for pick, row in renderable:
        sentence = row["sentence"]
        translated_word = translations.get(pick["word"])
        translated_sentence = translations.get(sentence)
        translation_source = "batch" if (translated_word or translated_sentence) else None

        match = _sentence_match(sentence, row.get("matched_form"), pick["word"])
        items.append(
            FeedItem(
                lemma_id=pick["lemma_id"],
                word=pick["word"],
                pos=_POS_FRIENDLY.get((pick.get("pos") or "").upper()),
                cefr=pick.get("cefr_level"),
                sentence=sentence,
                sentence_match=SentenceMatch(**match) if match else None,
                translated_word=translated_word,
                translated_sentence=translated_sentence,
                translation_source=translation_source,
            )
        )

    logger.info(
        f"[feed] user={current_user.id} page={page_index} items={len(items)} "
        f"mix_applied={applied} has_more={has_more}"
    )
    return FeedResponse(items=items, mix_applied=applied, has_more=has_more)
