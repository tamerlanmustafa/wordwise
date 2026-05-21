"""
v0.6 W10 — cinema-named streak milestones.

Pure helpers for mapping streak length → unlock key, plus the apply-on-rollup
DB helper that adds newly-crossed unlocks to `users.unlocked_cosmetics`.

Milestone keys are cinema-named so the celebration copy can be specific
rather than the generic "you hit 30 days!" — see the table below. The
cosmetic itself (sprocket color, film-stock variant, etc.) is deferred
to v1.1 art; v1 ships the unlock modal + persistent inventory only.
"""
from __future__ import annotations

import json
from typing import Iterable, Optional

from prisma import Json, Prisma

# (threshold_days, slug, display_name). Ordered ascending so we can
# iterate cleanly to compute "all crossed" sets. Names are deliberate —
# changing them means re-running grandfathering for users who already
# hold the old slug.
MILESTONES: list[tuple[int, str, str]] = [
    (7,   "opening_weekend",       "Opening Weekend"),
    (30,  "box_office",            "Box Office"),
    (100, "cult_classic",          "Cult Classic"),
    (365, "criterion_collection",  "Criterion Collection"),
]


# ── Pure helpers ────────────────────────────────────────────────────────────

def crossed_milestones(prev_streak: int, new_streak: int) -> list[str]:
    """Return milestone slugs newly crossed by this bump.

    `prev_streak < threshold <= new_streak` for each returned slug. A
    bump that jumps multiple thresholds at once (e.g. backfill, repair)
    returns all of them in ascending order.
    """
    if new_streak <= prev_streak:
        return []
    return [
        slug
        for (threshold, slug, _name) in MILESTONES
        if prev_streak < threshold <= new_streak
    ]


def all_unlocks_for_streak(streak: int) -> list[str]:
    """All milestone slugs the user has earned at this streak (cumulative).

    Useful for backfilling existing users on first /daily/state read."""
    return [slug for (threshold, slug, _name) in MILESTONES if streak >= threshold]


def display_name_for(slug: str) -> Optional[str]:
    for (_threshold, s, name) in MILESTONES:
        if s == slug:
            return name
    return None


def parse_unlocked(raw: object) -> list[str]:
    """Coerce whatever Prisma hands back for `unlocked_cosmetics` into
    a list of slug strings. The Json column can come back as a list, a
    JSON string, or None — be tolerant."""
    if raw is None:
        return []
    if isinstance(raw, list):
        return [s for s in raw if isinstance(s, str)]
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except (ValueError, TypeError):
            return []
        return parse_unlocked(parsed)
    return []


# ── DB-touching helper ──────────────────────────────────────────────────────

async def apply_milestone_unlocks(
    db: Prisma,
    *,
    user_id: int,
    prev_streak: int,
    new_streak: int,
    current_unlocked: Iterable[str],
) -> list[str]:
    """Add any newly-crossed milestones to `users.unlocked_cosmetics`.

    Returns the list of slugs that were actually NEW to this user (i.e.
    crossed and not already in their inventory). Empty when nothing
    crossed or everything was already owned. The caller can pipe this
    into the response so the frontend can fire the unlock modal.

    Idempotent: if the streak bumps past the same milestone twice (e.g.
    a repair flow resets and re-crosses), the second pass returns [].
    """
    newly_crossed = crossed_milestones(prev_streak, new_streak)
    if not newly_crossed:
        return []
    owned = set(current_unlocked)
    truly_new = [slug for slug in newly_crossed if slug not in owned]
    if not truly_new:
        return []
    next_owned = list(owned) + truly_new
    # Prisma Json columns must be wrapped — bare lists serialize as
    # "datetime.date not serializable" or similar opaque errors.
    await db.user.update(
        where={"id": user_id},
        data={"unlockedCosmetics": Json(next_owned)},
    )
    return truly_new
