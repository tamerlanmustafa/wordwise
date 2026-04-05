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


# Domain-specific vocabulary lists
# Words that signal specialized knowledge required for comprehension
DOMAIN_VOCABULARY = {
    "finance": {
        "mortgage", "equity", "bond", "derivative", "collateral", "leverage",
        "securities", "subprime", "hedge", "portfolio", "dividend", "recession",
        "inflation", "deficit", "asset", "liability", "interest", "yield",
        "capital", "stock", "share", "commodity", "broker", "trader",
        "bankruptcy", "foreclosure", "audit", "fiscal", "monetary", "subsidy",
        "depreciation", "amortization", "liquidity", "solvency", "valuation",
        "acquisition", "merger", "ipo", "revenue", "profit", "margin",
        "volatility", "speculation", "arbitrage", "underwriting", "premium",
        "debenture", "fiduciary", "collateralized", "securitize", "tranche",
        "swap", "option", "futures", "index", "benchmark", "maturity",
        "coupon", "principal", "creditor", "debtor", "insolvency",
        "deregulation", "bailout", "stimulus", "quantitative", "austerity",
    },
    "legal": {
        "plaintiff", "defendant", "verdict", "jurisdiction", "statute",
        "litigation", "amendment", "constitution", "prosecution", "testimony",
        "allegation", "indictment", "acquittal", "conviction", "sentencing",
        "parole", "probation", "injunction", "subpoena", "affidavit",
        "deposition", "arbitration", "mediation", "tort", "felony",
        "misdemeanor", "warrant", "custody", "bail", "plea", "appeal",
        "precedent", "jurisprudence", "legislation", "regulatory",
        "compliance", "liability", "negligence", "malpractice", "sovereign",
        "extradition", "clemency", "tribunal", "adjudicate",
    },
    "medical": {
        "diagnosis", "symptom", "chronic", "prescription", "malignant",
        "benign", "prognosis", "pathology", "syndrome", "therapy",
        "pharmaceutical", "clinical", "surgical", "anesthesia", "biopsy",
        "chemotherapy", "radiation", "transplant", "infectious", "immune",
        "antibody", "vaccine", "epidemic", "pandemic", "quarantine",
        "contagious", "tumor", "lesion", "inflammation", "hemorrhage",
        "cardiac", "pulmonary", "neurological", "psychiatric", "trauma",
        "rehabilitation", "palliative", "remission", "relapse", "dosage",
        "contraindication", "autopsy", "organ", "tissue", "cellular",
    },
    "military": {
        "battalion", "artillery", "reconnaissance", "deployment", "casualties",
        "infantry", "cavalry", "ammunition", "barracks", "garrison",
        "fortification", "siege", "offensive", "defensive", "flank",
        "regiment", "brigade", "division", "platoon", "squadron",
        "lieutenant", "colonel", "sergeant", "admiral", "commanding",
        "intelligence", "surveillance", "missile", "warhead", "nuclear",
        "strategic", "tactical", "guerrilla", "insurgent", "ceasefire",
        "armistice", "occupation", "liberation", "conscription", "draft",
        "tribunal", "martial", "counterintelligence", "espionage",
    },
    "science": {
        "hypothesis", "molecular", "quantum", "synthesis", "catalyst",
        "organism", "species", "evolution", "genome", "chromosome",
        "mutation", "protein", "enzyme", "metabolism", "photosynthesis",
        "ecosystem", "biodiversity", "conservation", "extinction",
        "theoretical", "empirical", "variable", "correlation", "statistical",
        "particle", "electron", "neutron", "radioactive", "isotope",
        "thermodynamic", "velocity", "acceleration", "gravitational",
        "electromagnetic", "spectrum", "wavelength", "frequency",
        "phenomenon", "paradigm", "methodology", "peer", "journal",
    },
    "politics": {
        "democracy", "authoritarian", "totalitarian", "ideology", "propaganda",
        "geopolitical", "diplomacy", "sanction", "embargo", "sovereignty",
        "imperialism", "colonialism", "nationalism", "bureaucracy",
        "bipartisan", "filibuster", "referendum", "constituency",
        "incumbent", "opposition", "coalition", "caucus", "lobby",
        "campaign", "electoral", "ballot", "delegate", "veto",
        "ratification", "executive", "legislative", "judicial",
        "corruption", "transparency", "accountability", "reform",
        "revolution", "coup", "regime", "dictatorship", "oligarchy",
    },
    "technology": {
        "algorithm", "encryption", "bandwidth", "server", "database",
        "protocol", "firmware", "malware", "cybersecurity", "firewall",
        "authentication", "cryptocurrency", "blockchain", "neural",
        "artificial", "autonomous", "robotics", "nanotechnology",
        "biotechnology", "semiconductor", "processor", "interface",
        "virtualization", "infrastructure", "scalability", "latency",
        "debugging", "repository", "deployment", "iteration",
        "optimization", "simulation", "telemetry", "biometric",
    },
}

# Flatten all domain words for quick lookup
ALL_DOMAIN_WORDS = set()
for domain_words in DOMAIN_VOCABULARY.values():
    ALL_DOMAIN_WORDS.update(domain_words)


def compute_domain_density(words: List['WordData']) -> tuple[float, dict[str, float]]:
    """
    Compute domain-specific vocabulary density.

    Returns:
        - total_density: fraction of unique words that are domain-specific (0.0-1.0)
        - domain_breakdown: density per domain
    """
    unique_words = set(w.word.lower() for w in words if w.word)
    if not unique_words:
        return 0.0, {}

    domain_hits: dict[str, int] = {}
    total_hits = 0

    for domain, vocab in DOMAIN_VOCABULARY.items():
        hits = unique_words & vocab
        if hits:
            domain_hits[domain] = len(hits)
            total_hits += len(hits)

    total_density = total_hits / len(unique_words)
    domain_breakdown = {d: c / len(unique_words) for d, c in domain_hits.items()}

    return total_density, domain_breakdown


def split_sentences(text: str) -> List[str]:
    """Split text into sentences, filtering empty ones."""
    parts = re.split(r'[.!?]+(?:\s|$)', text)
    return [s.strip() for s in parts if s.strip()]


def count_sentences(text: str) -> int:
    """Count sentences in text using common sentence terminators."""
    return max(1, len(split_sentences(text)))


def compute_sentence_length_buckets(text: str) -> dict:
    """
    Categorize sentences by word count into CEFR-aligned difficulty buckets.

    Buckets (based on CEFR reading descriptors):
      - short:  ≤10 words  (A1-A2 level sentences)
      - medium: 11-15 words (B1 level)
      - long:   16-20 words (B2 level)
      - complex: 21+ words  (C1+ level)

    Returns dict with counts and percentages per bucket.
    """
    sentences = split_sentences(text)
    if not sentences:
        return {"short": 0, "medium": 0, "long": 0, "complex": 0,
                "pct_short": 0.0, "pct_medium": 0.0, "pct_long": 0.0, "pct_complex": 0.0,
                "total": 0}

    short = medium = long = complex_count = 0
    for sent in sentences:
        word_count = len(sent.split())
        if word_count <= 10:
            short += 1
        elif word_count <= 15:
            medium += 1
        elif word_count <= 20:
            long += 1
        else:
            complex_count += 1

    total = len(sentences)
    return {
        "short": short, "medium": medium, "long": long, "complex": complex_count,
        "pct_short": short / total,
        "pct_medium": medium / total,
        "pct_long": long / total,
        "pct_complex": complex_count / total,
        "total": total,
    }


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

    # Filter out likely misclassified words (slang contractions, non-English, gibberish)
    # These inflate C1/C2 counts in casual/kids movies
    def is_suspect_advanced(w: str, level: str) -> bool:
        """Check if a C1/C2 classification is likely wrong."""
        if level not in ('C1', 'C2'):
            return False
        wl = w.lower()
        # Slang contractions: "cheatin", "cruisin", "drivin"
        if wl.endswith("in") and len(wl) > 4 and wl[-3] not in 'aeiou':
            return True
        # Very short gibberish
        if len(wl) <= 2:
            return True
        # Words with no vowels (not real English)
        if not any(c in wl for c in 'aeiouy'):
            return True
        return False

    # Count words by level (with filtering)
    level_counts = {'A1': 0, 'A2': 0, 'B1': 0, 'B2': 0, 'C1': 0, 'C2': 0}
    total_syllables = 0
    phrasal_verb_count = 0
    unique_words_set = set()

    for word in words:
        level = word.cefr_level
        if word.word and is_suspect_advanced(word.word, level):
            level = 'B1'  # Downgrade suspect C1/C2 to B1

        level_counts[level] = level_counts.get(level, 0) + 1

        if word.word:
            unique_words_set.add(word.word.lower())
            syllables = count_syllables(word.word)
            if syllables > 0:
                total_syllables += syllables
            if detect_phrasal_verb(word.word):
                phrasal_verb_count += 1

    total_words = len(words)
    unique_word_count = len(unique_words_set)

    # CONTENT WORD PERCENTAGES: Exclude A1 function words from denominator.
    # Every movie has ~40% A1 words (the, is, he, she, a, etc.) — they don't
    # differentiate difficulty. Score based on A2+ content word distribution.
    content_words = total_words - level_counts.get('A1', 0)
    if content_words <= 0:
        content_words = total_words  # fallback

    # Content word distribution (A2+ only)
    cpct_A2 = level_counts.get('A2', 0) / content_words
    cpct_B1 = level_counts.get('B1', 0) / content_words
    cpct_B2 = level_counts.get('B2', 0) / content_words
    cpct_C1 = level_counts.get('C1', 0) / content_words
    cpct_C2 = level_counts.get('C2', 0) / content_words

    # Full distribution (for breakdown output and band clamping)
    pct_A1 = level_counts.get('A1', 0) / total_words if total_words > 0 else 0
    pct_B2 = level_counts.get('B2', 0) / total_words if total_words > 0 else 0
    pct_C1 = level_counts.get('C1', 0) / total_words if total_words > 0 else 0
    pct_C2 = level_counts.get('C2', 0) / total_words if total_words > 0 else 0

    # 1. Content word complexity — weighted B1+ ratio among non-A1 words
    # Higher B2/C1/C2 concentration = harder movie
    weighted_complex = (
        cpct_A2 * 0.3 +   # A2 is easy, low weight
        cpct_B1 * 1.0 +   # B1 starts to matter
        cpct_B2 * 2.0 +   # B2 is genuinely challenging
        cpct_C1 * 3.5 +   # C1 is advanced
        cpct_C2 * 4.5     # C2 is expert-level
    )
    # Normalize: max possible is ~4.5 (all C2), typical range 0.5-2.0
    weighted_complex = min(weighted_complex / 2.5, 1.0)

    # 2. Lexical diversity
    lexical_diversity = compute_lexical_diversity(words)

    # 3. Average syllables per word
    avg_syllables = total_syllables / total_words if total_words > 0 else 0
    syllable_score = min(avg_syllables / 4.0, 1.0)

    # 4. Hard word concentration: what % of content words are B2+?
    # This is the single most important metric for a language learner
    hard_pct = cpct_B2 + cpct_C1 + cpct_C2
    # Normalize: 10% B2+ content words = low (0.2), 30%+ = high (1.0)
    hard_word_score = min(hard_pct / 0.35, 1.0)

    # 5. Phrasal verb density
    idiom_density = phrasal_verb_count / total_words if total_words > 0 else 0

    # 6. Median CEFR level (unique words only)
    median_cefr = compute_median_cefr_level(words)
    median_score = (median_cefr - 1.0) / 5.0

    # 7. Repetition ratio
    repetition_ratio = unique_word_count / total_words if total_words > 0 else 0

    # 8. CEFR spread
    spread = compute_cefr_spread(level_counts, total_words)
    spread_score = spread / 5.0

    # 9. Average Zipf score
    avg_zipf = compute_average_zipf(words)
    zipf_rarity_score = max(0.0, min(1.0, (7.0 - avg_zipf) / 7.0))

    # 10. Flesch Reading Ease
    readability_score = 0.5
    if text:
        fre = compute_flesch_reading_ease(text, words)
        readability_score = max(0.0, min(1.0, (100.0 - fre) / 100.0))

    # 11. Sentence length complexity (bucket approach)
    # Instead of a flat average, measure what % of sentences are hard (16+ words)
    # A movie with many long sentences is harder even if average is "medium"
    sentence_length_score = 0.3  # Default
    if text:
        buckets = compute_sentence_length_buckets(text)
        # Score = weighted sum of hard sentence percentages
        # B2-length (16-20 words) sentences count, C1+ (21+) count more
        sentence_length_score = (
            buckets["pct_long"] * 0.5 +      # 16-20 word sentences
            buckets["pct_complex"] * 1.0      # 21+ word sentences
        )
        # Normalize: 0% hard = 0.0, 40%+ hard sentences = 1.0
        sentence_length_score = min(sentence_length_score / 0.40, 1.0)

    # 12. Domain vocabulary density
    domain_density, _domain_breakdown = compute_domain_density(words)

    # 13-17. Advanced linguistic analysis (if text available)
    morphosyntax_score = 0.3  # Default
    semantic_score = 0.3
    lexical_soph_score = 0.2
    discourse_score = 0.1
    cognitive_score = 0.3

    if text:
        try:
            from .syntactic_analyzer import analyze_morphosyntax
            morpho_result = analyze_morphosyntax(text)
            morphosyntax_score = morpho_result.composite_score
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Morphosyntax analysis failed: {e}")

        try:
            from .semantic_analyzer import analyze_semantics
            word_strs = list(set(w.word.lower() for w in words if w.word))
            semantic_result = analyze_semantics(text=text, word_list=word_strs)
            semantic_score = semantic_result.composite_score
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Semantic analysis failed: {e}")

        try:
            from .lexical_analyzer import analyze_lexical_sophistication
            word_strs = list(set(w.word.lower() for w in words if w.word))
            lexical_result = analyze_lexical_sophistication(text=text, word_list=word_strs)
            lexical_soph_score = lexical_result.composite_score
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Lexical analysis failed: {e}")

        try:
            from .discourse_analyzer import analyze_discourse
            discourse_result = analyze_discourse(text=text)
            discourse_score = discourse_result.composite_score
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Discourse analysis failed: {e}")

        try:
            from .cognitive_analyzer import analyze_cognitive_load
            cognitive_result = analyze_cognitive_load(text=text)
            cognitive_score = cognitive_result.composite_score
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Cognitive analysis failed: {e}")

    # Final weights (sum = 100%)
    # ── Vocabulary complexity (35%) ──
    #   - weighted_complex:      18% (content word CEFR distribution)
    #   - hard_word_score:       17% (B2+ concentration)
    # ── Lexical sophistication (7%) ──
    #   - lexical_soph_score:     7% (collocations, MWEs, rare morphology)
    # ── Syntactic complexity (8%) ──
    #   - morphosyntax_score:     8% (clause density, tree depth, passive, nominalizations)
    # ── Readability & structure (10%) ──
    #   - readability_score:      5% (Flesch reading ease)
    #   - sentence_length_score:  5% (sentence length buckets)
    # ── Frequency & diversity (10%) ──
    #   - zipf_rarity_score:      5% (vocabulary rarity)
    #   - lexical_diversity:      3% (vocabulary richness)
    #   - repetition_ratio:       2% (unique/total ratio)
    # ── Semantic complexity (7%) ──
    #   - semantic_score:         7% (abstractness, polysemy, density, referential)
    # ── Pragmatic & discourse (5%) ──
    #   - discourse_score:        5% (indirect speech, cohesion, cultural refs)
    # ── Cognitive load (3%) ──
    #   - cognitive_score:        3% (surprisal, topic shifts)
    # ── Other (15%) ──
    #   - median_score:           5% (median CEFR level)
    #   - spread_score:           3% (CEFR level range)
    #   - syllable_score:         2% (word length proxy)
    #   - idiom_density:          2% (phrasal verb density — original signal)

    difficulty_score = (
        # Vocabulary complexity (35%)
        0.18 * weighted_complex +
        0.17 * hard_word_score +
        # Lexical sophistication (7%)
        0.07 * lexical_soph_score +
        # Syntactic complexity (8%)
        0.08 * morphosyntax_score +
        # Readability & structure (10%)
        0.05 * readability_score +
        0.05 * sentence_length_score +
        # Frequency & diversity (10%)
        0.06 * zipf_rarity_score +
        0.04 * lexical_diversity +
        0.02 * repetition_ratio +
        # Semantic complexity (7%)
        0.07 * semantic_score +
        # Pragmatic & discourse (5%)
        0.05 * discourse_score +
        # Cognitive load (3%)
        0.03 * cognitive_score +
        # Other (15%)
        0.06 * median_score +
        0.03 * spread_score +
        0.02 * syllable_score +
        0.02 * idiom_density
        # Total: 18+17+7+8+5+5+6+4+2+7+5+3+6+3+2+2 = 100%
    )

    # DOMAIN MULTIPLIER: Applied on top, not additive.
    # Domain jargon makes the whole movie harder, not just one signal.
    # 0% domain = 1.0x (no change), 1.5%+ domain = up to 1.25x boost
    if domain_density > 0.005:  # More than 0.5% domain words
        domain_multiplier = 1.0 + min(domain_density / 0.02, 0.25)
        difficulty_score *= domain_multiplier

    # Vocabulary-based band clamping
    pct_advanced = pct_C1 + pct_C2
    if pct_advanced > 0.07:
        base_band = "C1+"
    elif pct_B2 > 0.08:
        base_band = "B"
    else:
        base_band = "A"

    if base_band == "A" and domain_density < 0.005:
        difficulty_score = min(difficulty_score, 0.35)
    elif base_band == "B":
        difficulty_score = max(0.35, min(difficulty_score, 0.65))

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

    # CEFR thresholds: 0-20 A1, 20-35 A2, 35-50 B1, 50-65 B2, 65-80 C1, 80-100 C2
    if score < 20:
        level = difficultylevel.ELEMENTARY  # A1
    elif score < 35:
        level = difficultylevel.ELEMENTARY  # A2
    elif score < 50:
        level = difficultylevel.INTERMEDIATE  # B1
    elif score < 65:
        level = difficultylevel.INTERMEDIATE  # B2
    elif score < 80:
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
