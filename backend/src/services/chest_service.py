"""
v0.6 variable-reward chest, awarded once per completed SRS session.

The chest is the visible payoff for the daily habit — Skinner-style
variable reward to keep dopamine engaged. Server-side selection avoids
client tamper; the response shape is small enough that the chest reveal
animation can run immediately on receipt.

Reward pool (weights tunable):
  • xp_small   (50%) — +25 XP credited to UserQuizStats
  • xp_large   (15%) — +100 XP credited to UserQuizStats
  • freeze     (20%) — +1 streak freeze. Rerolls to xp_small when the
                       user already holds MAX_FREEZES_HELD.
  • cosmetic   (15%) — Named placeholder cosmetic ("Director's Cut Frame"
                       etc.). v1 just displays the label in the chest
                       reveal — no persistent collection (deferred to W10
                       milestone unlocks which will own the cosmetic store).
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Optional

from prisma import Prisma

from .streak_service import (
    MAX_FREEZES_HELD,
    count_held_freezes,
    grant_freeze,
)

# Reward amounts. Round numbers, easy to tune.
XP_SMALL_AMOUNT: int = 25
XP_LARGE_AMOUNT: int = 100

# Cosmetic pool — placeholder names. Names map 1:1 to a frontend style
# variant (`apps/mobile/src/components/journey/ChestReveal.tsx`).
COSMETIC_POOL: list[str] = [
    "Director's Cut Frame",
    "Cinéma Vérité Border",
    "Vintage Sprocket",
    "Studio Lot Backdrop",
    "Gold Reel Stamp",
]

# (weight, kind) tuples. Weights sum to 100 for readability; the picker
# normalizes anyway so they could be anything positive.
CHEST_WEIGHTS: list[tuple[int, str]] = [
    (50, "xp_small"),
    (15, "xp_large"),
    (20, "freeze"),
    (15, "cosmetic"),
]


@dataclass
class ChestReward:
    kind: str
    label: str
    payload: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {"kind": self.kind, "label": self.label, "payload": self.payload}


# ── Pure picker ─────────────────────────────────────────────────────────────

def pick_chest_reward(
    *,
    freezes_held: int,
    rng: Optional[random.Random] = None,
) -> ChestReward:
    """Pick one chest reward.

    `freezes_held` lets us pre-empt rolling a freeze the user can't store
    (avoids a wasted reveal). When the would-be-freeze is rerolled we
    fall through to xp_small — a small consolation rather than a
    re-roll into another premium type.
    """
    r = rng or random.Random()
    total = sum(w for w, _ in CHEST_WEIGHTS)
    pick = r.randrange(total)
    cursor = 0
    chosen = "xp_small"
    for weight, kind in CHEST_WEIGHTS:
        cursor += weight
        if pick < cursor:
            chosen = kind
            break

    if chosen == "freeze" and freezes_held >= MAX_FREEZES_HELD:
        chosen = "xp_small"

    if chosen == "xp_small":
        return ChestReward(
            kind="xp_small",
            label=f"+{XP_SMALL_AMOUNT} XP",
            payload={"xp": XP_SMALL_AMOUNT},
        )
    if chosen == "xp_large":
        return ChestReward(
            kind="xp_large",
            label=f"+{XP_LARGE_AMOUNT} XP",
            payload={"xp": XP_LARGE_AMOUNT},
        )
    if chosen == "freeze":
        return ChestReward(
            kind="freeze",
            label="Streak freeze",
            payload={"freezes": 1},
        )
    if chosen == "cosmetic":
        cosmetic_name = r.choice(COSMETIC_POOL)
        return ChestReward(
            kind="cosmetic",
            label=cosmetic_name,
            payload={"cosmetic_name": cosmetic_name},
        )
    # Defensive fallback — never reached given the table above.
    return ChestReward(kind="xp_small", label=f"+{XP_SMALL_AMOUNT} XP",
                       payload={"xp": XP_SMALL_AMOUNT})


# ── DB-touching apply ───────────────────────────────────────────────────────

async def apply_chest_reward(
    db: Prisma,
    *,
    user_id: int,
    reward: ChestReward,
) -> None:
    """Run the side effects for a picked reward.

    xp_*    → increment UserQuizStats.xp (creates the row if missing).
    freeze  → credit one freeze via streak_service.
    cosmetic → no-op in v1 (display-only — milestone unlocks in W10
              will own persistent cosmetic ownership).
    """
    if reward.kind in {"xp_small", "xp_large"}:
        xp = int(reward.payload.get("xp", 0))
        if xp <= 0:
            return
        stats = await db.userquizstats.find_unique(where={"userId": user_id})
        if stats is None:
            await db.userquizstats.create(data={
                "userId": user_id,
                "totalStars": 0,
                "totalSessions": 0,
                "avgAccuracy": 0.0,
                "xp": xp,
            })
        else:
            await db.userquizstats.update(
                where={"userId": user_id},
                data={"xp": stats.xp + xp},
            )
        return
    if reward.kind == "freeze":
        await grant_freeze(db, user_id=user_id, via="repair_grant")  # chest grant
        return
    # cosmetic → no persistent state in v1
    return


async def award_session_chest(
    db: Prisma,
    *,
    user_id: int,
    rng: Optional[random.Random] = None,
) -> ChestReward:
    """End-to-end entry point used by /srs/session/complete: pick a
    reward (informed by current freeze inventory), apply it, return it
    so the client can animate the reveal."""
    held = await count_held_freezes(db, user_id)
    reward = pick_chest_reward(freezes_held=held, rng=rng)
    await apply_chest_reward(db, user_id=user_id, reward=reward)
    return reward
