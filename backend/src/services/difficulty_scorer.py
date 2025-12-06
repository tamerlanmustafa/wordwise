from typing import Dict, Tuple, List
from prisma.enums import difficultylevel, proficiencylevel


class WordData:
    """Represents a classified word with confidence and frequency data."""
    def __init__(self, cefr_level: str, confidence: float, frequency_rank: int | None):
        self.cefr_level = cefr_level
        self.confidence = confidence
        self.frequency_rank = frequency_rank


def compute_difficulty_advanced(words: List[WordData]) -> Tuple[difficultylevel, int, Dict[str, float]]:
    """
    Compute movie difficulty using confidence-weighted CEFR levels and frequency rarity.

    Algorithm:
    1. Assign base weights to CEFR levels (A1=1 through C2=6)
    2. Apply confidence weighting to each word's contribution
    3. Add frequency rarity adjustment for uncommon words
    4. Calculate weighted average and map to difficulty level

    Args:
        words: List of WordData objects with CEFR level, confidence, and frequency rank

    Returns:
        Tuple of (difficulty_level, score_0_100, breakdown_percentages)
    """
    if not words:
        return difficultylevel.BEGINNER, 0, {}

    # CEFR level weights
    LEVEL_WEIGHTS = {
        'A1': 1.0,
        'A2': 2.0,
        'B1': 3.0,
        'B2': 4.0,
        'C1': 5.0,
        'C2': 6.0
    }

    # Frequency rarity threshold - words ranked above this get difficulty boost
    RARE_WORD_THRESHOLD = 5000
    RARITY_BOOST = 0.1

    total_weighted_score = 0.0
    total_weight = 0.0
    level_counts = {level: 0 for level in LEVEL_WEIGHTS.keys()}

    for word in words:
        base_weight = LEVEL_WEIGHTS.get(word.cefr_level, 3.0)

        # Apply frequency rarity adjustment
        if word.frequency_rank and word.frequency_rank > RARE_WORD_THRESHOLD:
            base_weight += RARITY_BOOST

        # Weight by confidence
        weighted_contribution = base_weight * word.confidence

        total_weighted_score += weighted_contribution
        total_weight += word.confidence
        level_counts[word.cefr_level] = level_counts.get(word.cefr_level, 0) + 1

    # Calculate average difficulty score (1-6 scale)
    avg_difficulty = total_weighted_score / total_weight if total_weight > 0 else 3.0

    # Map to 0-100 scale
    score = int(((avg_difficulty - 1.0) / 5.0) * 100)
    score = max(0, min(100, score))  # Clamp to 0-100

    # Map score to difficulty level
    if score < 20:
        level = difficultylevel.ELEMENTARY
    elif score < 40:
        level = difficultylevel.INTERMEDIATE
    elif score < 60:
        level = difficultylevel.ADVANCED
    else:
        level = difficultylevel.PROFICIENT

    # Calculate breakdown percentages
    total_words = len(words)
    breakdown = {k: v / total_words for k, v in level_counts.items() if v > 0}

    return level, score, breakdown


def compute_difficulty(cefr_distribution: Dict[str, int]) -> Tuple[difficultylevel, int, Dict[str, int]]:
    """
    Legacy difficulty computation using only CEFR distribution counts.
    Kept for backward compatibility.
    """
    total = sum(cefr_distribution.values())
    if total == 0:
        return difficultylevel.BEGINNER, 0, cefr_distribution

    percentages = {k: (v / total) * 100 for k, v in cefr_distribution.items()}

    a1_pct = percentages.get("A1", 0)
    a2_pct = percentages.get("A2", 0)
    b1_pct = percentages.get("B1", 0)
    b2_pct = percentages.get("B2", 0)
    c1_pct = percentages.get("C1", 0)
    c2_pct = percentages.get("C2", 0)

    weighted_sum = (
        a1_pct * 10 +
        a2_pct * 25 +
        b1_pct * 45 +
        b2_pct * 65 +
        c1_pct * 85 +
        c2_pct * 100
    )
    score = int(weighted_sum / 100 * 100)

    if (a1_pct + a2_pct) > 60:
        level = difficultylevel.ELEMENTARY
    elif b1_pct > 30 or ((a2_pct + b1_pct) > 50):
        level = difficultylevel.INTERMEDIATE
    elif b2_pct > 25:
        level = difficultylevel.ADVANCED
    elif (c1_pct + c2_pct) > 20:
        level = difficultylevel.PROFICIENT
    else:
        level = difficultylevel.INTERMEDIATE

    return level, score, cefr_distribution
