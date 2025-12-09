from typing import Dict, Tuple, List, Optional
from prisma.enums import difficultylevel, proficiencylevel
import statistics
import re
import math


class WordData:
    """Represents a classified word with confidence and frequency data."""
    def __init__(self, cefr_level: str, confidence: float, frequency_rank: int | None, word: str = "", zipf_score: float | None = None):
        self.cefr_level = cefr_level
        self.confidence = confidence
        self.frequency_rank = frequency_rank
        self.word = word
        self.zipf_score = zipf_score  # Zipf frequency (0-7 scale, higher = more common)


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


def count_sentences(text: str) -> int:
    """Count sentences in text using common sentence terminators."""
    # Match sentence-ending punctuation followed by space/end
    sentences = re.split(r'[.!?]+(?:\s|$)', text)
    # Filter empty strings
    return max(1, len([s for s in sentences if s.strip()]))


def compute_flesch_kincaid_grade(text: str, words: List[WordData]) -> float:
    """
    Calculate Flesch-Kincaid Grade Level.

    Formula: 0.39 * (words/sentences) + 11.8 * (syllables/words) - 15.59

    Returns US grade level (0-18+). Higher = more difficult.
    """
    if not text or not words:
        return 0.0

    total_words = len(words)
    total_sentences = count_sentences(text)
    total_syllables = sum(count_syllables(w.word) for w in words if w.word)

    if total_words == 0 or total_sentences == 0:
        return 0.0

    words_per_sentence = total_words / total_sentences
    syllables_per_word = total_syllables / total_words

    grade = 0.39 * words_per_sentence + 11.8 * syllables_per_word - 15.59
    return max(0.0, grade)  # Can't be negative


def compute_flesch_reading_ease(text: str, words: List[WordData]) -> float:
    """
    Calculate Flesch Reading Ease score.

    Formula: 206.835 - 1.015 * (words/sentences) - 84.6 * (syllables/words)

    Returns score 0-100. Higher = easier to read.
    - 90-100: Very easy (5th grade)
    - 80-90: Easy (6th grade)
    - 70-80: Fairly easy (7th grade)
    - 60-70: Standard (8th-9th grade)
    - 50-60: Fairly difficult (10th-12th grade)
    - 30-50: Difficult (college)
    - 0-30: Very difficult (college graduate)
    """
    if not text or not words:
        return 100.0  # Empty = easiest

    total_words = len(words)
    total_sentences = count_sentences(text)
    total_syllables = sum(count_syllables(w.word) for w in words if w.word)

    if total_words == 0 or total_sentences == 0:
        return 100.0

    words_per_sentence = total_words / total_sentences
    syllables_per_word = total_syllables / total_words

    score = 206.835 - 1.015 * words_per_sentence - 84.6 * syllables_per_word
    return max(0.0, min(100.0, score))  # Clamp to 0-100


def compute_average_zipf(words: List[WordData]) -> float:
    """
    Compute average Zipf score for vocabulary rarity assessment.

    Zipf scale: 0-7 (higher = more common)
    - 7.0: Ultra-common (the, be, to)
    - 5.0-6.0: Common everyday words
    - 3.0-4.0: Less common words
    - 1.0-2.0: Rare words
    - 0.0: Very rare / not in corpus
    """
    zipf_scores = [w.zipf_score for w in words if w.zipf_score is not None]
    if not zipf_scores:
        return 4.0  # Default to intermediate

    return sum(zipf_scores) / len(zipf_scores)


def compute_lexical_diversity(words: List[WordData]) -> float:
    """Calculate Herdan's C (lexical diversity)."""
    if not words:
        return 0.0

    unique_words = len(set(w.word.lower() for w in words if w.word))
    total_words = len(words)

    if total_words <= 1:
        return 0.0

    # Herdan's C = log(unique) / log(total)
    try:
        return math.log(unique_words) / math.log(total_words)
    except (ValueError, ZeroDivisionError):
        return 0.0


def compute_type_token_ratio(words: List[WordData]) -> float:
    """
    Calculate Type-Token Ratio (TTR).

    TTR = unique words / total words

    Simple measure of lexical diversity.
    - Higher TTR = more diverse vocabulary
    - Lower TTR = more repetitive vocabulary

    Note: TTR is affected by text length; longer texts tend to have lower TTR.
    """
    if not words:
        return 0.0

    unique_words = len(set(w.word.lower() for w in words if w.word))
    total_words = len(words)

    if total_words == 0:
        return 0.0

    return unique_words / total_words


def compute_root_ttr(words: List[WordData]) -> float:
    """
    Calculate Root TTR (Guiraud's Index).

    Root TTR = unique words / sqrt(total words)

    More stable than simple TTR for varying text lengths.
    """
    if not words:
        return 0.0

    unique_words = len(set(w.word.lower() for w in words if w.word))
    total_words = len(words)

    if total_words == 0:
        return 0.0

    return unique_words / math.sqrt(total_words)


def compute_log_ttr(words: List[WordData]) -> float:
    """
    Calculate Log TTR (Herdan's C).

    Log TTR = log(unique) / log(total)

    Most stable for varying text lengths.
    """
    return compute_lexical_diversity(words)


def compute_uber_index(words: List[WordData]) -> float:
    """
    Calculate Uber Index.

    Uber = log(total)^2 / (log(total) - log(unique))

    Measures lexical richness independent of text length.
    """
    if not words:
        return 0.0

    unique_words = len(set(w.word.lower() for w in words if w.word))
    total_words = len(words)

    if total_words <= 1 or unique_words == 0:
        return 0.0

    try:
        log_total = math.log(total_words)
        log_unique = math.log(unique_words)
        denominator = log_total - log_unique

        if denominator <= 0:
            return float('inf')  # All words are unique

        return (log_total ** 2) / denominator
    except (ValueError, ZeroDivisionError):
        return 0.0


def compute_comprehensive_lexical_diversity(words: List[WordData]) -> Dict[str, float]:
    """
    Compute comprehensive lexical diversity metrics.

    Returns multiple measures to give a complete picture of vocabulary richness:
    - ttr: Type-Token Ratio (simple ratio)
    - root_ttr: Guiraud's Index (root-based)
    - log_ttr: Herdan's C (log-based, most stable)
    - uber_index: Uber Index (advanced metric)
    - unique_words: Count of unique words
    - total_words: Total word count
    - repetition_ratio: 1 - TTR (how repetitive the text is)
    """
    if not words:
        return {
            'ttr': 0.0,
            'root_ttr': 0.0,
            'log_ttr': 0.0,
            'uber_index': 0.0,
            'unique_words': 0,
            'total_words': 0,
            'repetition_ratio': 0.0
        }

    unique_count = len(set(w.word.lower() for w in words if w.word))
    total_count = len(words)
    ttr = compute_type_token_ratio(words)

    return {
        'ttr': round(ttr, 4),
        'root_ttr': round(compute_root_ttr(words), 4),
        'log_ttr': round(compute_log_ttr(words), 4),
        'uber_index': round(compute_uber_index(words), 4),
        'unique_words': unique_count,
        'total_words': total_count,
        'repetition_ratio': round(1 - ttr, 4) if ttr > 0 else 0.0
    }


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


# Genre difficulty multipliers based on TMDB genres
# These are empirically tuned based on typical vocabulary in each genre
GENRE_DIFFICULTY_WEIGHTS = {
    # Easiest genres (kids/family content) - 0.70-0.80 multiplier
    'animation': 0.75,
    'family': 0.75,
    'kids': 0.70,
    'children': 0.70,

    # Easy-medium genres (accessible entertainment) - 0.85-0.95 multiplier
    'comedy': 0.90,
    'romance': 0.90,
    'action': 0.92,
    'adventure': 0.88,
    'fantasy': 0.85,  # Often simpler language despite fantastical content
    'music': 0.88,
    'musical': 0.88,

    # Medium genres (standard difficulty) - 0.95-1.05 multiplier
    'horror': 0.98,
    'thriller': 1.02,
    'crime': 1.05,
    'mystery': 1.05,
    'drama': 1.00,

    # Complex genres (sophisticated vocabulary) - 1.05-1.15 multiplier
    'science fiction': 1.10,
    'sci-fi': 1.10,
    'documentary': 1.12,
    'history': 1.10,
    'war': 1.08,
    'western': 1.05,
    'biography': 1.08,

    # Most complex (academic/specialized vocabulary) - 1.10-1.20 multiplier
    'political': 1.15,
    'film noir': 1.12,
    'tv movie': 1.00,  # Neutral
}


def compute_genre_multiplier(genres: List[str]) -> float:
    """
    Compute a difficulty multiplier based on movie genres.

    Combines multiple genre weights using a weighted average where
    more specific genres (kids, sci-fi) take precedence over general ones.

    Args:
        genres: List of genre strings (e.g., ['Animation', 'Family', 'Adventure'])

    Returns:
        Multiplier (0.70 - 1.20) to apply to difficulty score
    """
    if not genres:
        return 1.0

    genres_lower = [g.lower().strip() for g in genres]

    # Priority check: Kids content ALWAYS dominates
    kids_genres = ['animation', 'family', 'kids', 'children']
    if any(g in genres_lower for g in kids_genres):
        # Find the lowest (easiest) multiplier among kids genres
        kids_weights = [GENRE_DIFFICULTY_WEIGHTS.get(g, 1.0) for g in genres_lower if g in kids_genres]
        return min(kids_weights) if kids_weights else 0.75

    # Collect all matching genre weights
    weights = []
    for genre in genres_lower:
        if genre in GENRE_DIFFICULTY_WEIGHTS:
            weights.append(GENRE_DIFFICULTY_WEIGHTS[genre])

    if not weights:
        return 1.0  # No recognized genres

    # For multiple genres, use a weighted average biased toward extremes
    # This ensures complex genres aren't diluted by neutral ones
    if len(weights) == 1:
        return weights[0]

    # Sort to identify extreme values
    sorted_weights = sorted(weights)

    # Weighted average: give more weight to the most extreme value
    # (whether it's easy or hard)
    if sorted_weights[-1] > 1.0:
        # Harder content: bias toward the hardest genre
        return sorted_weights[-1] * 0.7 + (sum(sorted_weights[:-1]) / max(1, len(sorted_weights) - 1)) * 0.3
    else:
        # Easier content: bias toward the easiest genre
        return sorted_weights[0] * 0.7 + (sum(sorted_weights[1:]) / max(1, len(sorted_weights) - 1)) * 0.3


def compute_cefr_spread(level_counts: Dict[str, int], total_words: int) -> int:
    """
    Compute effective CEFR spread, ignoring tiny tail noise.

    If C2 < 1% of words, treat max as C1.
    If C1+C2 < 2%, treat max as B2.
    This prevents rare outliers from inflating spread.
    """
    CEFR_NUMERIC = {'A1': 1, 'A2': 2, 'B1': 3, 'B2': 4, 'C1': 5, 'C2': 6}

    if total_words == 0:
        return 0

    # Calculate percentages
    pct_C2 = level_counts.get('C2', 0) / total_words
    pct_C1 = level_counts.get('C1', 0) / total_words
    pct_advanced = pct_C1 + pct_C2

    # Find present levels
    present_levels = [CEFR_NUMERIC[lvl] for lvl, count in level_counts.items() if count > 0]
    if not present_levels:
        return 0

    # Determine effective max level (ignore noise)
    raw_max = max(present_levels)
    effective_max = raw_max

    if pct_C2 < 0.01:  # C2 < 1%
        effective_max = min(effective_max, CEFR_NUMERIC['C1'])

    if pct_advanced < 0.02:  # C1+C2 < 2%
        effective_max = min(effective_max, CEFR_NUMERIC['B2'])

    min_level = min(present_levels)
    return effective_max - min_level


def compute_difficulty_advanced(
    words: List[WordData],
    genres: Optional[List[str]] = None,
    text: Optional[str] = None
) -> Tuple[difficultylevel, int, Dict[str, float]]:
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
    - Average Zipf score (vocabulary rarity)
    - Flesch Reading Ease (if text provided)
    - Genre normalization

    Args:
        words: List of WordData objects with CEFR classifications
        genres: Optional list of movie genres (e.g., ['Animation', 'Family'])
        text: Optional raw text for readability metrics

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

    # 4. CEFR weighted gap score with adjusted B2 weight
    # B2 is upper-intermediate, NOT advanced - reduced from 2.0 → 1.2
    CEFR_GAP_WEIGHTS_ADJUSTED = {
        'A1': 0, 'A2': 1.0, 'B1': 1.4, 'B2': 1.2, 'C1': 3.0, 'C2': 4.0
    }
    cefr_gap_score = (
        pct_A2 * CEFR_GAP_WEIGHTS_ADJUSTED['A2'] +
        pct_B1 * CEFR_GAP_WEIGHTS_ADJUSTED['B1'] +
        pct_B2 * CEFR_GAP_WEIGHTS_ADJUSTED['B2'] +
        pct_C1 * CEFR_GAP_WEIGHTS_ADJUSTED['C1'] +
        pct_C2 * CEFR_GAP_WEIGHTS_ADJUSTED['C2']
    )
    # Normalize to 0-1 (max weight is 4.0)
    cefr_gap_score = min(cefr_gap_score / 4.0, 1.0)

    # Advanced-level safety threshold: if C1+C2 < 2%, reduce their weight drastically
    pct_advanced = pct_C1 + pct_C2
    if pct_advanced < 0.02:  # Less than 2%
        cefr_gap_score *= 0.25  # Reduce impact of rare advanced words

    # 5. Phrasal verb density - 5%
    idiom_density = phrasal_verb_count / total_words if total_words > 0 else 0

    # 6. Median CEFR level (unique words only) - normalized to 0-1
    median_cefr = compute_median_cefr_level(words)
    median_score = (median_cefr - 1.0) / 5.0  # Map 1-6 to 0-1

    # 7. Repetition ratio (unique/total) - higher = more complex vocabulary
    repetition_ratio = unique_word_count / total_words if total_words > 0 else 0

    # 8. CEFR spread (max - min level) with noise filtering - normalized to 0-1
    spread = compute_cefr_spread(level_counts, total_words)
    spread_score = spread / 5.0  # Max spread is 5 (C2 - A1)

    # 9. Average Zipf score (vocabulary rarity) - normalized to 0-1
    # Zipf 7 = very common (score 0), Zipf 0 = very rare (score 1)
    avg_zipf = compute_average_zipf(words)
    zipf_rarity_score = max(0.0, min(1.0, (7.0 - avg_zipf) / 7.0))

    # 10. Flesch Reading Ease (if text provided) - normalized to 0-1
    # FRE 100 = easiest (score 0), FRE 0 = hardest (score 1)
    readability_score = 0.5  # Default middle value
    if text:
        fre = compute_flesch_reading_ease(text, words)
        readability_score = max(0.0, min(1.0, (100.0 - fre) / 100.0))

    # Final weights (sum = 100%)
    # Weights redistributed to include Zipf and readability:
    #   - weighted_complex:   30% (core vocabulary complexity - most important)
    #   - cefr_gap_score:     18% (CEFR distribution spread)
    #   - median_score:       12% (median CEFR level)
    #   - zipf_rarity_score:  10% (vocabulary rarity via Zipf)
    #   - lexical_diversity:   8% (vocabulary richness)
    #   - readability_score:   7% (Flesch reading ease)
    #   - spread_score:        6% (CEFR level range)
    #   - syllable_score:      4% (word length proxy)
    #   - idiom_density:       3% (phrasal complexity)
    #   - repetition_ratio:    2% (lexical variation)
    difficulty_score = (
        0.30 * weighted_complex +           # Core vocab complexity
        0.18 * cefr_gap_score +             # CEFR distribution spread
        0.12 * median_score +               # Median CEFR level
        0.10 * zipf_rarity_score +          # Vocabulary rarity (Zipf)
        0.08 * lexical_diversity +          # Vocabulary richness
        0.07 * readability_score +          # Flesch reading ease
        0.06 * spread_score +               # Level range
        0.04 * syllable_score +             # Word length proxy
        0.03 * idiom_density +              # Phrasal complexity
        0.02 * repetition_ratio             # Lexical variation
    )

    # CRITICAL: Global CEFR vocabulary safety rule
    # No movie can be C1/C2 without meaningful advanced vocabulary
    if pct_advanced < 0.01:  # Less than 1% C1+C2
        difficulty_score = min(difficulty_score, 0.55)  # Cap at upper B2

    # Vocabulary-based band clamping (prevents stylistic metrics from overriding vocab)
    if pct_advanced > 0.07:  # 7%+ C1/C2
        base_band = "C1+"
    elif pct_B2 > 0.08:  # 8%+ B2
        base_band = "B"
    else:
        base_band = "A"

    # Enforce band boundaries BEFORE genre adjustment
    if base_band == "A":
        difficulty_score = min(difficulty_score, 0.40)  # Max A2
    elif base_band == "B":
        difficulty_score = max(0.35, min(difficulty_score, 0.70))  # B1-B2 range
    # C1+ band has no upper clamp

    # Clamp negative values at 0 before scaling
    difficulty_score = max(0.0, difficulty_score)

    # Map to 0-100 scale
    score = int(difficulty_score * 100)
    score = max(0, min(100, score))

    # Apply genre adjustment AFTER mapping to 0-100 scale
    # This ensures genre affects final score, not intermediate calculations
    if genres:
        genre_multiplier = compute_genre_multiplier(genres)
        score = int(score * genre_multiplier)
        score = max(0, min(100, score))

    # Overhauled thresholds optimized for realistic classification
    if score < 25:
        level = difficultylevel.ELEMENTARY  # A1
    elif score < 40:
        level = difficultylevel.ELEMENTARY  # A2
    elif score < 55:
        level = difficultylevel.INTERMEDIATE  # B1
    elif score < 70:
        level = difficultylevel.INTERMEDIATE  # B2
    elif score < 85:
        level = difficultylevel.ADVANCED  # C1
    else:
        level = difficultylevel.PROFICIENT  # C2

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
