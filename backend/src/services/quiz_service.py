"""
Pure logic for the quiz feature. Kept free of DB / network calls so the
card-selection and scoring rules are unit-testable without a Postgres
harness.

The router in routes/quiz.py composes these helpers with Prisma + the
translation service.
"""
from __future__ import annotations

import random
from dataclasses import dataclass
from typing import List, Optional

CARDS_PER_SESSION = 10
TYPE_RATIO = 0.7  # ~70% typed-translation cards, ~30% self-rate

# XP economy — round numbers, tune later.
XP_PER_CORRECT = 10
XP_PER_SELF_RATE = 5  # participation credit; self-rating is honest effort
XP_THREE_STAR_BONUS = 50
XP_TWO_STAR_BONUS = 20


@dataclass(frozen=True)
class CardSpec:
    """What the client renders. For 'type' cards the client shows `word` and
    the user types its translation in their native language — the client
    scores the typed answer against `translation` and sets is_correct when
    submitting."""
    word: str
    card_type: str  # "type" | "self_rate"
    translation: Optional[str]


def pick_card_types(total: int = CARDS_PER_SESSION, *, rng: Optional[random.Random] = None) -> List[str]:
    """
    Produce the interleaved card-type sequence for a session. Deterministic
    via injected rng for tests. Typed cards are ~70% of the deck, self-rate
    ~30%, shuffled. Guarantees at least one of each type when total >= 3 so
    the user sees the variety.
    """
    r = rng or random.Random()
    n_type = round(total * TYPE_RATIO)
    n_self = total - n_type
    if total >= 3:
        n_type = max(1, min(total - 1, n_type))
        n_self = total - n_type
    deck = ["type"] * n_type + ["self_rate"] * n_self
    r.shuffle(deck)
    return deck


def compute_stars(correct_count: int, total_scored: int) -> int:
    """
    Stars are derived only from typed cards (total_scored). Self-rate cards
    are excluded from the denominator because they have no "correct"
    answer. A session with zero typed cards scores 1 star for completion —
    prevents zero-star frustration on an honest self-rate-only session.
    """
    if total_scored == 0:
        return 1
    accuracy = correct_count / total_scored
    if accuracy >= 0.90:
        return 3
    if accuracy >= 0.70:
        return 2
    if accuracy >= 0.50:
        return 1
    return 0


def compute_xp(correct_count: int, self_rate_count: int, stars: int) -> int:
    """
    XP for a single session. Round numbers, easy to tune. Self-rating earns
    half the points of a correct typed card — rewards honest engagement
    without letting users farm XP by tapping "know" on everything.
    """
    xp = correct_count * XP_PER_CORRECT + self_rate_count * XP_PER_SELF_RATE
    if stars == 3:
        xp += XP_THREE_STAR_BONUS
    elif stars == 2:
        xp += XP_TWO_STAR_BONUS
    return xp


def is_unit_unlocked(
    level: str,
    level_order: List[str],
    attempted_levels: set[str],
) -> bool:
    """
    Free-play gating: level N is unlocked iff level N-1 has been attempted
    (not mastered). First level is always unlocked.
    """
    if level not in level_order:
        return False
    idx = level_order.index(level)
    if idx == 0:
        return True
    return level_order[idx - 1] in attempted_levels
