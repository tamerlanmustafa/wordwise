"""
SRS queue composers for the Practice tab and the Lists tab's practice button.

The Practice tab is ONE kind of session. It used to be a rotating path of
tiles — Quick Recall, Tough Words, Movie Deep-Dive — which meant the vocabulary
you were quizzed on depended on which tile the cursor happened to land on, and
Deep-Dive meant it depended on which films were in your reel. A vocabulary quiz
should be about vocabulary, so all three collapsed into `practice`, whose deck
mixes the three things that actually matter in fixed proportions (`plan_deck`):

  • recalls    — cards that are due. The retention test. Ordered box-first, so
                 the words you keep failing come back before the ones you have
                 nearly graduated. This is what `tough_words` used to be, folded
                 into every session instead of every third one.
  • your words — words the user saved from the reader or Explore, or added to a
                 list, and has never studied.
  • fresh      — new lemmas at the user's CEFR level and one above, padded in by
                 the route (`routes/srs.py::_pad_with_fresh_level_lemmas`).

Available kinds (`SessionKind`):
  • practice    — the Practice tab. The only kind a current client asks for.
  • list_words  — a words list, practised from the Lists tab's gold button.
  • list_films  — a films list. Still movie-scoped, and deliberately so: it is
                  reached from a list of films the user built, not from
                  Practice.
  • movie_lesson — a Screening Mode scene test (#166). The client names the
                  film and the exact words the scene is testing; the composer
                  returns one UserWord row per word, creating rows only for
                  the words with none. Every answer then posts to /srs/review
                  like any other card, so a word missed in a film comes back
                  in Practice on the same row, in the same Leitner box — the
                  "missed words" of a film are a view over its low-box rows,
                  not a second memory model.

`quick_recall`, `tough_words` and `movie_deep_dive` remain in VALID_KINDS as
DEPRECATED ALIASES for `practice`. Builds already on the App Store still send
them, and answering a shipped client with a 422 would leave Practice broken on
every phone that has not updated. `movie_deep_dive`'s `movie_id` is accepted
and ignored. (`synonym_round` was retired earlier with the synonym MCQ format
and is not aliased — it never reached a released build.)

Each composer returns a list of UserWord rows. The route layer (srs.py)
hydrates them into ReviewCard objects identically across kinds — only the
picking strategy varies here.
"""
from __future__ import annotations

import math
import os
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from prisma import Prisma
from prisma.errors import UniqueViolationError

SessionKind = Literal[
    "practice",
    "list_words",
    "list_films",
    "movie_lesson",
]

# Kinds a current client asks for.
VALID_KINDS: set[str] = {
    "practice",
    "list_words",
    "list_films",
    "movie_lesson",
}

# Retired Practice tiles, still sent by installed builds. Each maps to the
# single `practice` kind; see the module docstring for why they answer instead
# of 422-ing. Remove once the store minimum version is past the release that
# stopped sending them.
DEPRECATED_KIND_ALIASES: dict[str, str] = {
    "quick_recall":    "practice",
    "tough_words":     "practice",
    "movie_deep_dive": "practice",
}

VALID_KINDS |= set(DEPRECATED_KIND_ALIASES)

# Kinds driven by a list — they require `list_id`.
LIST_KINDS: set[str] = {"list_words", "list_films"}

# Kinds that practise exactly the words they were handed. The route never pads
# these from the registry or a film: a words list must test its own members
# and a scene test must ask the words the reader just studied — padding either
# would put vocabulary the user never chose into a session they started from
# something specific.
UNPADDED_KINDS: set[str] = {"list_words", "movie_lesson"}

# Kinds outside the free tier's one-session-per-UTC-day cap. Decided on #161
# (2026-09-01): Screening Mode is priced by energy (#168), which REPLACES the
# daily cap rather than stacking on it, so a scene test neither trips the
# `srsLastSessionStartedAt` gate nor stamps it — a free user's lesson must not
# spend their Practice session for the day. The gate itself retires with #168.
DAILY_CAP_EXEMPT_KINDS: set[str] = {"movie_lesson"}

# `UserWord.source` for a row a scene test materialised. Distinct from
# `PRACTICE_SOURCE` on purpose: Practice's padding is hidden from every
# saved-word surface (`user_owned_where_fragment`), but a word the user was
# tested on in a film IS their vocabulary now, and it should come back through
# Practice's "your words" slice if the lesson ends before the row is answered.
# Saved-words / Favourites are adapters over `movie_id IS NULL`, and these
# rows carry the film's id, so they stay out of those lists regardless.
MOVIE_LESSON_SOURCE = "movie_lesson"

# Most words one movie_lesson start may ask for. A six-card scene tests 3 + 2
# resurfaced words, the longest scene (11 cards) tests 6 + 2, and the Final
# Cut (#171) asks 10. Twenty leaves a scene runner room to fetch a whole scene
# in one call without this ever becoming a bulk-create endpoint — the point of
# lazy creation is that a film the user bounces off writes nothing.
MOVIE_LESSON_MAX_WORDS: int = 20


def canonical_kind(kind: str) -> str:
    """The kind a request actually runs as, after alias resolution."""
    return DEPRECATED_KIND_ALIASES.get(kind, kind)


# Soft target session size — same as the existing SESSION_SIZE in
# routes/srs.py. Kept here as a module constant so each composer
# can target it directly.
KIND_SESSION_SIZE: int = 10

# Cross-session cooldown: a word reviewed within this many hours is held
# back from the next session, in the slices that aren't already gated by a
# due-date filter. Stops a just-seen word — especially one you just got wrong,
# which resets to box 1 and so would otherwise re-appear immediately — from
# "stalking" you session-to-session. The recall slice doesn't need this: a
# reviewed card's srsDueAt jumps ≥1 day out, so its `srsDueAt <= now` filter
# already excludes it. Free users (one session/UTC-day) are effectively
# unaffected at the default; the gate mainly de-duplicates premium
# multi-session days. Tunable via env without a redeploy.
REVIEW_COOLDOWN_HOURS: int = int(os.environ.get("SRS_REVIEW_COOLDOWN_HOURS", "8"))

# ── Deck composition ───────────────────────────────────────────────────────
# How many of a session's cards are recalls. The user asked for recalls "every
# now and then" rather than as the main event, so at ordinary debt they are a
# seasoning: 4 cards due yields 2 recalls and 8 new-ish ones.
#
# RECALL_MAX exists because a flat cap has a nasty long-run failure. A user who
# misses a fortnight comes back to 60 due cards; at 2 recalls a session they
# would need 30 sessions to clear a backlog that is still growing, so their
# queue never drains and the SRS intervals stop meaning anything. Scaling the
# count with the debt (a quarter of it, clamped) lets a backlog actually drain
# without ever turning a session into pure review.
RECALL_MIN: int = 2
RECALL_MAX: int = 6

# How many of a session's cards come from words the user saved or listed
# themselves. Their words should show up reliably and soon after they save
# them, but a session that is nothing but the user's own backlog never teaches
# anything new, which is the point of the level-based fresh slice.
SAVED_TARGET: int = 4


def plan_deck(
    due: int,
    saved: int,
    fresh: int,
    size: int = KIND_SESSION_SIZE,
) -> tuple[int, int, int]:
    """How many cards each source contributes to one deck.

    Returns `(n_recall, n_saved, n_fresh)`, always summing to at most `size`
    and to exactly `size` whenever the three sources between them have the
    material for it.

    Pure and DB-free on purpose: this is the rule that decides what a Practice
    session *feels* like, and it should be adjustable and testable without a
    Postgres harness (see tests/test_session_kinds.py).

    Slots go unclaimed rather than wasted — a source that can't fill its share
    hands the remainder to the others, in the order recall → saved → fresh. So
    a brand-new user with nothing due and nothing saved gets ten fresh words,
    and a long-time user with no fresh stock left gets a full deck of their own
    vocabulary.
    """
    size = max(0, size)
    due, saved, fresh = max(0, due), max(0, saved), max(0, fresh)

    if due <= 0:
        n_recall = 0
    else:
        target = min(RECALL_MAX, max(RECALL_MIN, math.ceil(due / 4)))
        n_recall = min(due, target, size)

    n_saved = min(saved, SAVED_TARGET, size - n_recall)
    n_fresh = min(fresh, size - n_recall - n_saved)

    # Spill: whatever the capped sources left on the table goes to whoever
    # still has stock. Recalls take it first — an unfilled deck means the user
    # is short of material, and re-testing something they have seen beats
    # ending the session early.
    spare = size - (n_recall + n_saved + n_fresh)
    if spare > 0:
        take = min(spare, due - n_recall)
        n_recall += take
        spare -= take
    if spare > 0:
        take = min(spare, saved - n_saved)
        n_saved += take
        spare -= take
    if spare > 0:
        n_fresh += min(spare, fresh - n_fresh)

    return n_recall, n_saved, n_fresh


# ── Pure helpers ────────────────────────────────────────────────────────────

def recently_reviewed_cutoff(
    now: datetime,
    *,
    hours: int = REVIEW_COOLDOWN_HOURS,
) -> datetime:
    """Boundary timestamp for the cross-session cooldown. Rows whose
    `srsLastReviewedAt` is at/after this are "too fresh" to resurface."""
    return now - timedelta(hours=hours)


def cooldown_where_fragment(cutoff: datetime) -> dict:
    """Prisma `where` fragment selecting rows eligible after the cooldown:
    never reviewed (NULL `srsLastReviewedAt`) OR last reviewed strictly
    before `cutoff`. Spread into a composer's `where` alongside its other
    scalar filters — Prisma AND-combines the top-level keys."""
    return {
        "OR": [
            {"srsLastReviewedAt": None},
            {"srsLastReviewedAt": {"lt": cutoff}},
        ]
    }

# Rows the user did not put in their own vocabulary: Practice's own padding.
# `IS DISTINCT FROM` rather than `<>` — a plain inequality is NULL for the
# legacy rows (which is every row saved before the column existed) and SQL
# discards those, so `<>` would hide the user's entire saved vocabulary.
# See prisma/manual/2026_08_31_user_words_source.sql.
PRACTICE_SOURCE = "practice"


def user_owned_where_fragment() -> dict:
    """Prisma `where` fragment for rows the user chose to save, excluding the
    ones a Practice session introduced by padding.

    Spelled as an explicit OR with the NULL case rather than a bare `not`,
    because whether an ORM's negation includes NULLs is exactly the kind of
    thing that differs between versions — and getting it wrong here doesn't
    fail loudly, it silently empties every user's saved-words list.
    """
    return {"OR": [{"source": None}, {"source": {"not": PRACTICE_SOURCE}}]}


def normalize_lesson_words(words: Optional[list[str]]) -> list[str]:
    """The words a movie_lesson request actually asks for: stripped,
    lowercased, blanks dropped, duplicates collapsed, original order kept.

    Lowercased because every row this composer writes is keyed on the
    lowercase lemma (the deck displays `display_form`, which is the lowercase
    lemma), so a re-run that spells "Linger" differently must still find the
    row it created last time instead of writing a second one.
    """
    out: list[str] = []
    seen: set[str] = set()
    for raw in words or []:
        word = (raw or "").strip().lower()
        if not word or word in seen:
            continue
        seen.add(word)
        out.append(word)
    return out


def pick_lesson_row(rows: list, movie_id: int):
    """Which of a user's existing rows for one word a scene test should use,
    or None when the word should not be asked at all.

    A word can have several rows — one per film it was saved from, plus the
    global (movie_id NULL) marker — each carrying its own Leitner state. The
    film's own row wins, so the mastery ring #171 reads off box state stays
    coherent for that film; otherwise the row Practice would surface first
    (soonest due, then oldest). A word marked learned on ANY row is skipped:
    the learned marker hides a word everywhere else in the app, and a lesson
    should not be the one surface that keeps asking it.
    """
    if not rows:
        return None
    if any(getattr(r, "isLearned", False) for r in rows):
        return None
    own = [r for r in rows if getattr(r, "movieId", None) == movie_id]
    pool = own or list(rows)
    return min(pool, key=lambda r: (r.srsDueAt, r.id))


# ── Per-kind composers ─────────────────────────────────────────────────────
# Each composer returns a list of UserWord-shaped rows. They all guarantee:
#   • at most KIND_SESSION_SIZE rows
#   • no duplicates within a session
#   • only rows belonging to the user
# Hydration into ReviewCard / fresh-lemma padding happens in routes/srs.py.

async def compose_practice(
    db: Prisma,
    *,
    user_id: int,
    now: Optional[datetime] = None,
    size: int = KIND_SESSION_SIZE,
) -> tuple[list, list]:
    """The Practice tab's deck. Returns `(picked, reserve)`.

    `picked` is the recall + saved slices sized by `plan_deck`; the route fills
    the rest with fresh level-appropriate lemmas
    (`routes/srs.py::_pad_with_fresh_level_lemmas`). `reserve` is everything
    those two queries found but the plan had no room for — the route falls back
    to it when the registry can't supply enough fresh words, so a user who has
    exhausted the fresh pool still gets a full deck instead of a short one.

    The two slices:

    • RECALLS — `srsDueAt <= now`, ordered `srsBox ASC, srsDueAt ASC`. Box
      first, not date first: box 1 is where a word lands when you fail it, so
      ordering by box surfaces the words you are actually struggling with ahead
      of the ones that merely came around again. No cooldown needed — a
      reviewed card's due date jumps at least a day out, so the due filter has
      already excluded anything seen today.

    • YOUR WORDS — saved from the reader or Explore, or added to a list, and
      never studied (`srsLastReviewedAt IS NULL`). Filtered to rows the user
      actually chose (`user_owned_where_fragment`), so Practice's own padding
      from previous sessions can't come back through this slice and crowd out
      the words the user asked for. Newest first: a word you saved this morning
      is the one you are waiting to be quizzed on.

    Both slices are over-fetched to `size` so `plan_deck`'s spill has material
    to work with, and the saved slice excludes anything the recall slice
    already took.
    """
    when = now if now is not None else datetime.now(timezone.utc)
    cutoff = recently_reviewed_cutoff(when)

    due_rows = await db.userword.find_many(
        where={
            "userId": user_id,
            "isLearned": False,
            "srsDueAt": {"lte": when},
        },
        order=[{"srsBox": "asc"}, {"srsDueAt": "asc"}, {"id": "asc"}],
        take=size,
    )

    taken = {r.id for r in due_rows}
    saved_rows = [
        r
        for r in await db.userword.find_many(
            where={
                "userId": user_id,
                "isLearned": False,
                "srsLastReviewedAt": None,
                **user_owned_where_fragment(),
                **cooldown_where_fragment(cutoff),
            },
            order=[{"createdAt": "desc"}, {"id": "desc"}],
            take=size * 2,
        )
        if r.id not in taken
    ]

    n_recall, n_saved, _n_fresh = plan_deck(
        due=len(due_rows), saved=len(saved_rows), fresh=size, size=size,
    )
    picked = list(due_rows[:n_recall]) + list(saved_rows[:n_saved])
    reserve = list(due_rows[n_recall:]) + list(saved_rows[n_saved:])
    return picked, reserve


async def compose_list_words(
    db: Prisma,
    *,
    user_id: int,
    list_id: int,
    now: Optional[datetime] = None,
) -> list:
    """Cards drawn from a words list, due first then by list order.

    A list member with no UserWord row is legitimate — it was added from
    Explore and never studied — so once the due/existing rows run short we
    materialise rows for the unstudied members, exactly as
    `_pad_with_fresh_reel_lemmas` does for reel lemmas. Only as many as the
    session needs are created, so opening Practice on a 2000-word list does
    not write 2000 rows.
    """
    from . import lists as lists_service  # local: avoids an import cycle

    row = await lists_service.get_list_row(db, user_id, list_id)
    words = await lists_service.list_words(db, user_id, row)
    if not words:
        return []

    when = now if now is not None else datetime.now(timezone.utc)
    existing = await db.userword.find_many(
        where={
            "userId": user_id,
            "word": {"in": words},
            "isLearned": False,
        },
        order=[{"srsDueAt": "asc"}, {"id": "asc"}],
        take=KIND_SESSION_SIZE,
    )
    picked = list(existing)
    if len(picked) >= KIND_SESSION_SIZE:
        return picked

    # Top up from members that have no row yet, in list order.
    have = {r.word.lower() for r in picked}
    all_rows = await db.userword.find_many(
        where={"userId": user_id, "word": {"in": words}},
    )
    known = {r.word.lower() for r in all_rows}
    created = []
    for word in words:
        if len(picked) + len(created) >= KIND_SESSION_SIZE:
            break
        if word in have or word in known:
            continue
        try:
            created.append(await db.userword.create(data={
                "userId": user_id,
                "word": word,
                "srsDueAt": when,
            }))
        except Exception:
            # Lost a race against the partial unique index — skip it rather
            # than fail the whole session start.
            continue
    return picked + created


async def compose_list_films(
    db: Prisma,
    *,
    user_id: int,
    list_id: int,
    now: Optional[datetime] = None,
) -> list:
    """Cards drawn from the combined vocabulary of a films list.

    Returns the user's existing, not-yet-learned rows for those films; the
    route tops the queue up with fresh lemmas from the same films via
    `_pad_with_fresh_reel_lemmas(movie_ids=…)`. Without that padding a
    freshly-built films list would always be empty, since the user has no
    UserWord rows for a film they have not studied yet.
    """
    from . import lists as lists_service  # local: avoids an import cycle

    row = await lists_service.get_list_row(db, user_id, list_id)
    movie_ids = await lists_service.list_movie_ids(db, user_id, row)
    if not movie_ids:
        return []

    when = now if now is not None else datetime.now(timezone.utc)
    cutoff = recently_reviewed_cutoff(when)
    return await db.userword.find_many(
        where={
            "userId": user_id,
            "movieId": {"in": movie_ids},
            "isLearned": False,
            **cooldown_where_fragment(cutoff),
        },
        order=[{"srsDueAt": "asc"}, {"id": "asc"}],
        take=KIND_SESSION_SIZE,
    )


async def compose_movie_lesson(
    db: Prisma,
    *,
    user_id: int,
    movie_id: int,
    words: list[str],
    now: Optional[datetime] = None,
) -> list:
    """One UserWord row per word a Screening Mode scene is testing, in the
    order asked. The film and the words come from the client — the scene
    runner knows which cards the reader just studied and which misses it is
    bringing back; the server's job is only to give each word a row.

    Lazy on purpose: rows are created for the words this call tests and no
    others (precedent: `compose_list_words`). MovieDetailScreen shows ~60
    words the moment a film opens, and a row for each would put sixty
    never-studied words into the Practice queue of everyone who bounces off
    a film after one look. A word the user already has a row for — saved from
    a subtitle, padded by Practice, tested in another film — reuses that row
    (`pick_lesson_row`), so the lesson and the Practice tab agree on one
    Leitner box per word instead of keeping two opinions about it.

    The words are trusted to belong to the film, as `POST /user-words` trusts
    a saved word's `movie_id`. Checking them against `movie_lemma_mappings`
    was measured against prod and rejected: the deck is built from
    `word_classifications`, and the two tables agree on only 96% of a film's
    lemmas, so the check would refuse real deck words.
    """
    wanted = normalize_lesson_words(words)[:MOVIE_LESSON_MAX_WORDS]
    if not wanted:
        return []

    when = now if now is not None else datetime.now(timezone.utc)
    existing = await db.userword.find_many(
        where={
            "userId": user_id,
            "word": {"in": wanted, "mode": "insensitive"},
        },
    )
    by_word: dict[str, list] = {}
    for row in existing:
        by_word.setdefault(row.word.lower(), []).append(row)

    picked: list = []
    for word in wanted:
        rows = by_word.get(word)
        if rows:
            row = pick_lesson_row(rows, movie_id)
            if row is not None:
                picked.append(row)
            continue
        try:
            picked.append(await db.userword.create(data={
                "userId": user_id,
                "word": word,
                "movieId": movie_id,
                "srsDueAt": when,
                "source": MOVIE_LESSON_SOURCE,
            }))
        except UniqueViolationError:
            # Lost a race against `unique_user_word_movie` — two starts for
            # the same scene at once. Skip it rather than fail the session;
            # the retry finds the row the other request wrote. Only that
            # error: anything else (a dropped connection, a bad column) must
            # surface as a 500, not as a lesson with fewer questions.
            continue
    return picked


async def compose_for_kind(
    db: Prisma,
    *,
    kind: str,
    user_id: int,
    list_id: Optional[int] = None,
    movie_id: Optional[int] = None,
    words: Optional[list[str]] = None,
    now: Optional[datetime] = None,
) -> tuple[list, list]:
    """Dispatch helper. Returns `(picked, reserve)` for every kind.

    Only `practice` ever produces a non-empty reserve — the list kinds and
    `movie_lesson` practise a fixed set of words, so there is nothing held
    back to fall back on. The uniform shape means the route hydrates every
    kind identically.

    Deprecated Practice tiles (`quick_recall`, `tough_words`,
    `movie_deep_dive`) resolve to `practice` here rather than at the route, so
    every caller gets the aliasing for free. Raises ValueError for unknown
    kinds, for a list kind without a `list_id`, or for `movie_lesson` without
    a `movie_id` and at least one word — the route layer translates those
    into 422s.
    """
    resolved = canonical_kind(kind)
    if resolved == "practice":
        return await compose_practice(db, user_id=user_id, now=now)
    if resolved in LIST_KINDS:
        if list_id is None:
            raise ValueError(f"{resolved} requires list_id")
        if resolved == "list_words":
            rows = await compose_list_words(
                db, user_id=user_id, list_id=list_id, now=now,
            )
        else:
            rows = await compose_list_films(
                db, user_id=user_id, list_id=list_id, now=now,
            )
        return rows, []
    if resolved == "movie_lesson":
        if movie_id is None:
            raise ValueError("movie_lesson requires movie_id")
        if not normalize_lesson_words(words):
            raise ValueError("movie_lesson requires at least one word")
        rows = await compose_movie_lesson(
            db, user_id=user_id, movie_id=movie_id, words=words or [], now=now,
        )
        return rows, []
    raise ValueError(f"unknown session kind: {kind}")
