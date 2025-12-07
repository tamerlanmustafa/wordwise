from typing import Dict, Tuple, List, Optional
from prisma.enums import difficultylevel, proficiencylevel
import statistics


class WordData:
    """Represents a classified word with confidence and frequency data."""
    def __init__(self, cefr_level: str, confidence: float, frequency_rank: int | None, word: str = ""):
        self.cefr_level = cefr_level
        self.confidence = confidence
        self.frequency_rank = frequency_rank
        self.word = word


def count_syllables(word: str) -> int:
    """Simple syllable counter based on vowel groups. Ignores proper nouns."""
    # Skip proper nouns (capitalized words)
    if word and word[0].isupper():
        return 0

    word = word.lower().strip()
    if len(word) <= 3:
        return 1

    vowels = 'aeiouy'
    syllable_count = 0
    previous_was_vowel = False

    for char in word:
        is_vowel = char in vowels
        if is_vowel and not previous_was_vowel:
            syllable_count += 1
        previous_was_vowel = is_vowel

    # Adjust for silent e
    if word.endswith('e'):
        syllable_count -= 1

    # Ensure at least 1 syllable
    return max(1, syllable_count)


def detect_phrasal_verb(word: str) -> bool:
    """Detect if word is part of phrasal verb pattern."""
    particles = ['up', 'down', 'in', 'out', 'on', 'off', 'away', 'back', 'over', 'through']
    return word.lower() in particles


def compute_lexical_diversity(words: List[WordData]) -> float:
    """Calculate Herdan's C (lexical diversity)."""
    if not words:
        return 0.0

    unique_words = len(set(w.word.lower() for w in words if w.word))
    total_words = len(words)

    if total_words <= 1:
        return 0.0

    # Herdan's C = log(unique) / log(total)
    import math
    try:
        return math.log(unique_words) / math.log(total_words)
    except (ValueError, ZeroDivisionError):
        return 0.0


def compute_median_cefr_level(words: List[WordData]) -> float:
    """Compute median CEFR level on unique words."""
    CEFR_NUMERIC = {'A1': 1, 'A2': 2, 'B1': 3, 'B2': 4, 'C1': 5, 'C2': 6}

    # Get unique words
    unique_word_levels = {}
    for w in words:
        if w.word:
            key = w.word.lower()
            if key not in unique_word_levels:
                unique_word_levels[key] = CEFR_NUMERIC.get(w.cefr_level, 1)

    if not unique_word_levels:
        return 1.0

    numeric_levels = list(unique_word_levels.values())
    return statistics.median(numeric_levels)


def compute_cefr_spread(level_counts: Dict[str, int]) -> int:
    """Compute spread (max - min) of CEFR levels."""
    CEFR_NUMERIC = {'A1': 1, 'A2': 2, 'B1': 3, 'B2': 4, 'C1': 5, 'C2': 6}

    present_levels = [CEFR_NUMERIC[lvl] for lvl, count in level_counts.items() if count > 0]
    if not present_levels:
        return 0

    return max(present_levels) - min(present_levels)


def compute_difficulty_advanced(words: List[WordData], genres: Optional[List[str]] = None) -> Tuple[difficultylevel, int, Dict[str, float]]:
    """
    Refined multi-signal difficulty computation with genre normalization.

    Signals:
    - Complex word ratio (weighted by level)
    - Lexical diversity (Herdan's C)
    - Average syllables per word (ignoring proper nouns)
    - CEFR weighted gap score
    - Phrasal verb density (reduced weight)
    - Median CEFR level (unique words only)
    - Repetition ratio (unique/total)
    - CEFR spread (max - min level)
    - Genre normalization

    Returns difficulty_level, score (0-100), and breakdown percentages.
    """
    if not words:
        return difficultylevel.BEGINNER, 0, {}

    # CEFR gap weights
    CEFR_GAP_WEIGHTS = {
        'A1': 0,
        'A2': 1.0,
        'B1': 1.4,
        'B2': 2.0,
        'C1': 3.0,
        'C2': 4.0
    }

    # Count words by level
    level_counts = {'A1': 0, 'A2': 0, 'B1': 0, 'B2': 0, 'C1': 0, 'C2': 0}
    total_syllables = 0
    phrasal_verb_count = 0
    unique_words_set = set()

    for word in words:
        level = word.cefr_level
        level_counts[level] = level_counts.get(level, 0) + 1

        if word.word:
            unique_words_set.add(word.word.lower())
            syllables = count_syllables(word.word)
            if syllables > 0:  # Only count non-proper nouns
                total_syllables += syllables
            if detect_phrasal_verb(word.word):
                phrasal_verb_count += 1

    total_words = len(words)
    unique_word_count = len(unique_words_set)

    # Calculate true CEFR percentages from full vocabulary
    pct_A1 = level_counts.get('A1', 0) / total_words if total_words > 0 else 0
    pct_A2 = level_counts.get('A2', 0) / total_words if total_words > 0 else 0
    pct_B1 = level_counts.get('B1', 0) / total_words if total_words > 0 else 0
    pct_B2 = level_counts.get('B2', 0) / total_words if total_words > 0 else 0
    pct_C1 = level_counts.get('C1', 0) / total_words if total_words > 0 else 0
    pct_C2 = level_counts.get('C2', 0) / total_words if total_words > 0 else 0

    # Normalize percentages to sum to 1.0
    total_pct = pct_A1 + pct_A2 + pct_B1 + pct_B2 + pct_C1 + pct_C2
    if total_pct > 0:
        pct_A1 /= total_pct
        pct_A2 /= total_pct
        pct_B1 /= total_pct
        pct_B2 /= total_pct
        pct_C1 /= total_pct
        pct_C2 /= total_pct

    # 1. Complex word ratio (A2+ percentage) - 30%
    complex_words = sum(level_counts.get(lvl, 0) for lvl in ['A2', 'B1', 'B2', 'C1', 'C2'])

    # Weight by level using real percentages: B1 > A2, B2 > B1, etc.
    weighted_complex = (
        pct_A2 * 1.0 +
        pct_B1 * 1.2 +
        pct_B2 * 1.5 +
        pct_C1 * 2.0 +
        pct_C2 * 2.5
    )

    # 2. Lexical diversity - 8%
    lexical_diversity = compute_lexical_diversity(words)

    # 3. Average syllables per word - 7%
    avg_syllables = total_syllables / total_words if total_words > 0 else 0
    # Normalize to 0-1 range (assume 1-4 syllables typical)
    syllable_score = min(avg_syllables / 4.0, 1.0)

    # 4. CEFR weighted gap score - 20% (using real percentages)
    cefr_gap_score = (
        pct_A2 * CEFR_GAP_WEIGHTS['A2'] +
        pct_B1 * CEFR_GAP_WEIGHTS['B1'] +
        pct_B2 * CEFR_GAP_WEIGHTS['B2'] +
        pct_C1 * CEFR_GAP_WEIGHTS['C1'] +
        pct_C2 * CEFR_GAP_WEIGHTS['C2']
    )
    # Normalize to 0-1 (max weight is 4.0)
    cefr_gap_score = min(cefr_gap_score / 4.0, 1.0)

    # Advanced-level safety threshold: if C1+C2 < 1%, reduce their weight drastically
    pct_advanced = pct_C1 + pct_C2
    if pct_advanced < 0.01:  # Less than 1%
        cefr_gap_score *= 0.3  # Reduce impact of rare advanced words

    # 5. Phrasal verb density - 4% (reduced from 10%)
    idiom_density = phrasal_verb_count / total_words if total_words > 0 else 0

    # 6. Sentence complexity - 13% (using weighted complex ratio as proxy)
    sentence_complexity = weighted_complex

    # 7. Median CEFR level (unique words only) - adds 0-30 points
    median_cefr = compute_median_cefr_level(words)
    median_component = median_cefr * 5  # 1-6 scale * 5 = 5-30

    # 8. Repetition ratio (unique/total) - higher = more complex
    repetition_ratio = unique_word_count / total_words if total_words > 0 else 0
    repetition_component = repetition_ratio * 10  # 0-10 points

    # 9. CEFR spread (max - min level)
    spread = compute_cefr_spread(level_counts)
    spread_component = spread * 3  # 0-15 points

    # Rebalanced difficulty formula
    difficulty_score = (
        0.30 * weighted_complex +
        0.08 * lexical_diversity +
        0.07 * syllable_score +
        0.20 * cefr_gap_score +
        0.04 * idiom_density +
        0.13 * sentence_complexity +
        0.10 * (spread_component / 15.0) +  # Normalize spread to 0-1
        0.05 * (median_component / 30.0) +  # Normalize median to 0-1
        0.03 * repetition_component  # Already 0-1 range
    )

    # Genre normalization (apply after base score)
    genre_multiplier = 1.0
    if genres:
        genres_lower = [g.lower() for g in genres]

        # Reduce difficulty for family/kids content
        if any(g in genres_lower for g in ['family', 'animation', 'kids', 'comedy']):
            genre_multiplier = 0.75
        # Increase for complex genres
        elif any(g in genres_lower for g in ['mystery', 'sci-fi', 'science fiction', 'political', 'thriller', 'crime']):
            genre_multiplier = 1.15

    difficulty_score *= genre_multiplier

    # Clamp negative values at 0 before scaling
    difficulty_score = max(0.0, difficulty_score)

    # Map to 0-100 scale
    score = int(difficulty_score * 100)
    score = max(0, min(100, score))

    # Updated thresholds (adjusted to prevent kids movies from over-scoring)
    if score < 22:
        level = difficultylevel.ELEMENTARY
    elif score < 35:
        level = difficultylevel.ELEMENTARY  # Still A2 range
    elif score < 50:
        level = difficultylevel.INTERMEDIATE
    elif score < 65:
        level = difficultylevel.INTERMEDIATE  # Still B2 range
    elif score < 80:
        level = difficultylevel.ADVANCED
    else:
        level = difficultylevel.PROFICIENT

    # Calculate breakdown percentages
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
