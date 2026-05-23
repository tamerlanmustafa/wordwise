"""
v0.7.2 — per-tile SRS queue composers for the Practice tab.

Each "practice tile" maps to a different way of selecting today's 10
cards. The daily-cap gate (`srs_last_session_started_at` + UTC rollover)
still applies — the user picks exactly ONE tile per day, and that
selection is recorded on `User.srsLastSessionKind` for the UI to render
the right "done today" state.

Available kinds (`SessionKind`):
  • quick_recall    — current default mix. Due-today cards + 1–2 fresh
                      from next unstudied reel movie. Always available.
  • synonym_round   — 10 cards filtered to `srsBox >= 3`. Pulls from the
                      user's "I know this" deck. Unlocks at streak 3.
  • tough_words     — Weighted toward `srsBox == 1` + recent misses. The
                      "bring back what failed" mode. Unlocks at streak 5.
  • movie_deep_dive — 10 cards from a specific reel movie (caller passes
                      `movie_id`). Unlocks at streak 7.

Each composer returns a list of UserWord rows. The route layer (srs.py)
hydrates them into ReviewCard objects identically across kinds — only
the picking strategy varies here.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional

from prisma import Prisma

SessionKind = Literal[
    "quick_recall",
    "synonym_round",
    "tough_words",
    "movie_deep_dive",
]

VALID_KINDS: set[str] = {
    "quick_recall",
    "synonym_round",
    "tough_words",
    "movie_deep_dive",
}

# Streak thresholds at which each kind unlocks. Quick recall is the
# baseline (0); the rest space out across the critical first 2 weeks.
KIND_UNLOCK_THRESHOLDS: dict[str, int] = {
    "quick_recall":    0,
    "synonym_round":   3,
    "tough_words":     5,
    "movie_deep_dive": 7,
}

# Soft target session size — same as the existing SESSION_SIZE in
# routes/srs.py. Kept here as a module constant so each composer
# can target it directly.
KIND_SESSION_SIZE: int = 10


# ── Pure helpers ────────────────────────────────────────────────────────────

def is_kind_unlocked(kind: str, current_streak: int) -> bool:
    """True iff the user's streak meets the threshold for this kind.

    Unknown kinds return False — defensive against typos / removed kinds
    that might still appear in stale client builds.
    """
    threshold = KIND_UNLOCK_THRESHOLDS.get(kind)
    if threshold is None:
        return False
    return current_streak >= threshold


# ── Per-kind composers ─────────────────────────────────────────────────────
# Each composer returns a list of UserWord-shaped rows. They all guarantee:
#   • at most KIND_SESSION_SIZE rows
#   • no duplicates within a session
#   • only rows belonging to the user
# Hydration into ReviewCard / fresh-lemma padding happens in routes/srs.py.

async def compose_quick_recall(
    db: Prisma,
    *,
    user_id: int,
    now: Optional[datetime] = None,
) -> list:
    """Default mix: due-today cards, oldest first, capped at SESSION_SIZE.
    Padding with fresh reel lemmas remains the responsibility of the
    route handler — same shape as the v0.6 default."""
    when = now if now is not None else datetime.now(timezone.utc)
    return await db.userword.find_many(
        where={"userId": user_id, "srsDueAt": {"lte": when}},
        order=[{"srsDueAt": "asc"}, {"id": "asc"}],
        take=KIND_SESSION_SIZE,
    )


async def compose_synonym_round(
    db: Prisma,
    *,
    user_id: int,
) -> list:
    """Box-3-and-up cards only. The synonym MCQ flow (built in P5 W4)
    is the higher-confidence card type, so we restrict the pool to
    words the user has demonstrably retained at least twice.

    Sort: most-overdue first, then by box descending so the user's most
    advanced words get reinforced more often than their borderline ones."""
    return await db.userword.find_many(
        where={"userId": user_id, "srsBox": {"gte": 3}},
        order=[{"srsDueAt": "asc"}, {"srsBox": "desc"}, {"id": "asc"}],
        take=KIND_SESSION_SIZE,
    )


async def compose_tough_words(
    db: Prisma,
    *,
    user_id: int,
) -> list:
    """Words that are currently in box 1 — either freshly learned or
    recently reset by a failed review. The "bring back what failed"
    mode that surfaces struggle words deliberately.

    Sort: oldest `srsLastReviewedAt` first so words the user hasn't
    re-tried in a while bubble up. Falls back to `srsDueAt` for rows
    that have never been reviewed yet."""
    return await db.userword.find_many(
        where={"userId": user_id, "srsBox": 1},
        order=[
            {"srsLastReviewedAt": "asc"},
            {"srsDueAt": "asc"},
            {"id": "asc"},
        ],
        take=KIND_SESSION_SIZE,
    )


async def compose_movie_deep_dive(
    db: Prisma,
    *,
    user_id: int,
    movie_id: int,
) -> list:
    """10 cards from a single movie's vocabulary. Pulls UserWord rows
    keyed to `movie_id`, oldest-due first. The caller is responsible for
    padding with fresh lemmas from that same movie when the user has
    fewer than SESSION_SIZE rows tied to it — see
    `routes/srs.py::_pad_with_fresh_reel_lemmas` for the existing pattern
    (which accepts a `restrict_movie_id` parameter we add in the route)."""
    return await db.userword.find_many(
        where={"userId": user_id, "movieId": movie_id},
        order=[{"srsDueAt": "asc"}, {"id": "asc"}],
        take=KIND_SESSION_SIZE,
    )


async def compose_for_kind(
    db: Prisma,
    *,
    kind: str,
    user_id: int,
    movie_id: Optional[int] = None,
    now: Optional[datetime] = None,
) -> list:
    """Dispatch helper. Raises ValueError for unknown kinds or for
    movie_deep_dive without a movie_id — the route layer should
    translate those into 400/422 responses."""
    if kind == "quick_recall":
        return await compose_quick_recall(db, user_id=user_id, now=now)
    if kind == "synonym_round":
        return await compose_synonym_round(db, user_id=user_id)
    if kind == "tough_words":
        return await compose_tough_words(db, user_id=user_id)
    if kind == "movie_deep_dive":
        if movie_id is None:
            raise ValueError("movie_deep_dive requires movie_id")
        return await compose_movie_deep_dive(db, user_id=user_id, movie_id=movie_id)
    raise ValueError(f"unknown session kind: {kind}")
