"""
Word normalization pipeline: dialect → standard English, foreign word filtering,
compound word decomposition. Runs BEFORE CEFR classification.

Handles three classes of misclassification:
  1. Dialect/nonstandard spellings: backstabbin → backstabbing, gonna → going to
  2. Non-English words: gabagool, finocchio, parlare → excluded
  3. Compound inventions: racecars → race + cars, whitewalls → white + walls
"""

from dataclasses import dataclass
from typing import Optional, Callable
import re
import logging

logger = logging.getLogger(__name__)


@dataclass
class NormalizationResult:
    original: str
    normalized: str
    normalization_type: str  # "dialect_ing" | "contraction" | "repeated_letters" | "compound" | "foreign" | "none"
    is_foreign: bool
    confidence: float
    language: Optional[str] = None  # "it", "es", "fr" if foreign detected


# ── Informal Contractions ──
# Maps nonstandard contractions to their base word for CEFR lookup.
# The base word is what gets classified — the contraction inherits its level.
INFORMAL_CONTRACTIONS = {
    "wanna": "want",     "gonna": "go",       "gotta": "get",
    "kinda": "kind",     "sorta": "sort",      "outta": "out",
    "dunno": "know",     "lemme": "let",       "gimme": "give",
    "coulda": "could",   "woulda": "would",    "shoulda": "should",
    "musta": "must",     "oughta": "ought",    "hafta": "have",
    "tryna": "try",      "finna": "fix",       "boutta": "about",
    "ya": "you",         "yer": "your",        "fer": "for",
    "em": "them",        "ol": "old",          "wit": "with",
    "ta": "to",          "til": "until",       "bout": "about",
    "cos": "because",    "coz": "because",     "cuz": "because",
    "tho": "though",     "thru": "through",    "nite": "night",
    "lite": "light",     "luv": "love",        "bro": "brother",
    "sis": "sister",     "gramps": "grandfather", "gramp": "grandfather",
    "grandpap": "grandfather", "granpap": "grandfather",
    # Common -in words that are always contractions of -ing
    "doin": "doing",     "goin": "going",       "comin": "coming",
    "nothin": "nothing", "somethin": "something", "anythin": "anything",
    "everythin": "everything", "mornin": "morning", "evenin": "evening",
    "runnin": "running", "lookin": "looking",   "talkin": "talking",
    "thinkin": "thinking", "gettin": "getting",  "sittin": "sitting",
    "hittin": "hitting", "puttin": "putting",   "lettin": "letting",
    "cuttin": "cutting", "settin": "setting",   "shuttin": "shutting",
    "killin": "killing", "fillin": "filling",   "pullin": "pulling",
    "tellin": "telling", "sellin": "selling",   "fallin": "falling",
    "callin": "calling", "holdin": "holding",   "buildin": "building",
    "feelin": "feeling", "dealin": "dealing",   "stealin": "stealing",
    "leavin": "leaving", "livin": "living",     "givin": "giving",
    "drivin": "driving", "writin": "writing",   "ridin": "riding",
    "hidin": "hiding",   "losin": "losing",     "movin": "moving",
    "provin": "proving", "makin": "making",     "takin": "taking",
    "shakin": "shaking", "wakin": "waking",     "bakin": "baking",
    "comin": "coming",   "havin": "having",     "sayin": "saying",
    "playin": "playing", "stayin": "staying",   "payin": "paying",
    "layin": "laying",   "prayin": "praying",
}

# Words that end in -in but are NOT contractions of -ing
# These must NOT be normalized (they are legitimate words)
FALSE_ING_WORDS = {
    "cabin", "satin", "basin", "raisin", "villain", "captain",
    "mountain", "fountain", "curtain", "certain", "margin",
    "origin", "virgin", "toxin", "resin", "basin", "javelin",
    "goblin", "gremlin", "merlin", "berlin", "insulin", "aspirin",
    "muffin", "coffin", "dolphin", "penguin", "sequin", "violin",
    "mandolin", "trampolin", "bulletin", "gelatin", "protein",
    "vitamin", "atin", "latin", "robin", "kevin", "admin",
    "login", "plugin", "kin", "pin", "tin", "fin", "bin",
    "win", "sin", "din", "gin", "inn", "min", "spin", "thin",
    "skin", "grin", "twin", "chin", "shin", "begin", "within",
    "coin", "join", "rain", "main", "pain", "gain", "train",
    "brain", "plain", "chain", "Spain", "again", "remain",
    "explain", "maintain", "contain", "obtain", "sustain",
    "complain", "constrain", "restrain", "entertain",
}

# ── Non-English Character Patterns ──
# Trigrams that are very rare in English but common in other languages
NON_ENGLISH_TRIGRAMS = {
    # Italian
    "zzo", "zzi", "zza", "gno", "gna", "gli", "cci", "cch",
    "cce", "ccia", "gio", "gia", "giu", "uol", "aol",
    # Spanish
    "ñ",
    # German
    "sch", "tsch",
    # Slavic
    "czk", "szc", "prz", "trz",
}

# Characters that almost never appear in English words
NON_ENGLISH_CHARS = re.compile(r'[àáâãäåèéêëìíîïòóôõöùúûüýñçžšđðþ]')

# ── English Loanwords ──
# Foreign-origin words that ARE standard English vocabulary
ENGLISH_LOANWORDS = {
    # Italian food (internationally known)
    "pizza", "pasta", "espresso", "cappuccino", "latte", "gelato",
    "risotto", "bruschetta", "tiramisu", "panini", "salami", "pepperoni",
    "mozzarella", "ricotta", "prosciutto", "gnocchi", "lasagna", "ravioli",
    "spaghetti", "macaroni", "parmesan", "pesto", "minestrone",
    "broccoli", "zucchini", "arugula", "ciabatta", "focaccia",
    # Italian culture
    "piano", "soprano", "alto", "tempo", "maestro", "virtuoso",
    "opera", "aria", "concerto", "sonata", "allegro", "forte",
    "graffiti", "paparazzi", "piazza", "villa", "balcony", "fiasco",
    "volcano", "malaria", "influenza", "quarantine", "ghetto",
    "stiletto", "casino", "motto", "manifesto",
    # Italian mafia terms (culturally relevant for English learners)
    "mafia", "vendetta", "consigliere",
    # Japanese (entered English)
    "karate", "judo", "tsunami", "emoji", "anime", "manga",
    "sushi", "tofu", "sake", "kimono", "origami", "typhoon",
    "tycoon", "karaoke", "samurai", "ninja", "sumo", "sensei",
    "ramen", "wasabi", "teriyaki", "tempura", "edamame",
    # French (common in English)
    "ballet", "cafe", "champagne", "chauffeur", "cliche",
    "entrepreneur", "fiance", "fiancee", "genre", "naive", "plateau",
    "restaurant", "resume", "boutique", "bureau", "chateau",
    "cuisine", "debut", "depot", "detour", "elite", "ensemble",
    "facade", "faux", "gourmet", "limousine", "lingerie",
    "memoir", "menu", "montage", "premiere", "rendezvous",
    "sabotage", "silhouette", "souvenir", "surveillance", "technique",
    # German
    "kindergarten", "wanderlust", "zeitgeist", "angst", "kitsch",
    "doppelganger", "poltergeist", "rucksack", "strudel", "pretzel",
    "diesel", "blitz", "flak", "uber",
    # Spanish
    "fiesta", "siesta", "plaza", "tornado", "mosquito",
    "canyon", "ranch", "rodeo", "lasso", "bronco",
    "guerrilla", "embargo", "cargo", "tornado", "patio",
    # Hindi/Urdu
    "jungle", "loot", "thug", "avatar", "guru", "yoga",
    "karma", "nirvana", "mantra", "shampoo", "pajama",
    # Arabic
    "algebra", "algorithm", "alcohol", "zero", "cipher",
    "magazine", "assassin", "admiral", "cotton", "sofa",
    # Other
    "ketchup", "kowtow", "typhoon", "boomerang",
}

# ── Expanded Foreign Words ──
# Additions to the existing FOREIGN_WORDS_FILTER in cefr_classifier.py
# These are words found in real movie C2 lists that should be excluded
ADDITIONAL_FOREIGN_WORDS = {
    # Italian (found in Cars, Godfather)
    "dicono", "fantastico", "fantastici", "parlare", "parlando",
    "piace", "riprenda", "stati", "stoppo", "lappo", "boomobile",
    "finocchio", "gabagool", "infàmia", "infamia", "paisan",
    "prosciut", "vafangoolyou", "notjustice",
    # Spanish
    "ése", "ese",
    # Hebrew/Yiddish
    "mishpocheh",
    # Generic movie gibberish / character names treated as words
    "kch",
}


def _is_likely_english(word: str) -> bool:
    """Check if a word has typical English orthographic patterns."""
    w = word.lower()

    # Must have at least one vowel
    if not re.search(r'[aeiouy]', w):
        return False

    # Vowel ratio: English words are typically 30-55% vowels
    vowel_count = sum(1 for c in w if c in 'aeiouy')
    ratio = vowel_count / len(w) if w else 0
    if ratio < 0.15 or ratio > 0.75:
        return False

    # Non-ASCII accent characters (è, ñ, ü, etc.) → likely foreign
    if NON_ENGLISH_CHARS.search(w):
        return False

    return True


def _has_foreign_trigrams(word: str) -> bool:
    """Check if word contains character trigrams uncommon in English."""
    w = word.lower()
    for tri in NON_ENGLISH_TRIGRAMS:
        if len(tri) == 1:
            if tri in w:
                return True
        elif tri in w:
            return True
    return False


def _normalize_repeated_letters(word: str) -> Optional[str]:
    """
    Collapse excessive letter repetition: goooood → good, heeelp → help.
    Only normalizes 3+ consecutive identical chars down to 1 or 2.
    Returns None if no change.
    """
    # Try collapsing to double letters first, then single
    collapsed_double = re.sub(r'(.)\1{2,}', r'\1\1', word)
    if collapsed_double != word:
        return collapsed_double

    return None


def _normalize_dialect_ing(word: str) -> Optional[str]:
    """
    Normalize dropped-g dialect: backstabbin → backstabbing.
    Only applies to words 4+ chars that end in a consonant + 'in'.
    Returns None if no normalization applies or if word is a false positive.
    """
    w = word.lower()

    # Skip known false positives
    if w in FALSE_ING_WORDS:
        return None

    # Must end in -in (not -ain, -oin, -ein, -uin which are real endings)
    if not w.endswith("in") or len(w) < 4:
        return None

    # The letter before "in" should be a consonant (backstabb-in, runnin, etc.)
    # But also handle vowel+in patterns like "doin", "goin"
    char_before = w[-3] if len(w) >= 3 else ""

    # Skip if it ends with common non-contraction patterns
    # -ain (rain, brain), -oin (coin, join), -ein (protein)
    if len(w) >= 3 and w[-3:] in ("ain", "oin", "ein", "uin"):
        return None

    # Try adding 'g' to make standard -ing form
    candidate = w + "g"

    return candidate


def _try_compound_split(word: str, is_known_word: Callable[[str], bool]) -> Optional[list]:
    """
    Try to split a compound word into known English components.
    Returns list of components if successful, None otherwise.

    Example: racecars → [race, cars], whitewalls → [white, walls]
    """
    w = word.lower()
    if len(w) < 6:  # Too short to be a compound
        return None

    best_split = None
    best_score = 0

    for i in range(3, len(w) - 2):  # Min 3 chars per component
        left, right = w[:i], w[i:]
        if is_known_word(left) and is_known_word(right):
            # Prefer splits with longer components (more likely correct)
            score = min(len(left), len(right))
            if score > best_score:
                best_score = score
                best_split = [left, right]

    return best_split


def normalize_word(
    word: str,
    is_known_english: Callable[[str], bool],
    get_zipf: Optional[Callable[[str], float]] = None,
) -> NormalizationResult:
    """
    Full normalization pipeline for a single word.

    Args:
        word: The word to normalize.
        is_known_english: Function that returns True if a word exists in any
                         English dictionary/wordlist (CEFR, NLTK, wordfreq).
        get_zipf: Optional function returning Zipf frequency (0-7 scale).

    Returns:
        NormalizationResult with normalized form and metadata.
    """
    w = word.lower()
    no_change = NormalizationResult(
        original=word, normalized=word,
        normalization_type="none", is_foreign=False, confidence=1.0
    )

    # ── Step 1: Check static contraction map ──
    if w in INFORMAL_CONTRACTIONS:
        base = INFORMAL_CONTRACTIONS[w]
        return NormalizationResult(
            original=word, normalized=base,
            normalization_type="contraction", is_foreign=False, confidence=0.90
        )

    # If the word is already known, skip normalization
    if is_known_english(w):
        return no_change

    # ── Step 2: Check if foreign word ──
    if w in ADDITIONAL_FOREIGN_WORDS:
        return NormalizationResult(
            original=word, normalized=word,
            normalization_type="foreign", is_foreign=True, confidence=0.95
        )

    # Non-ASCII characters → likely foreign
    if NON_ENGLISH_CHARS.search(w) and w not in ENGLISH_LOANWORDS:
        return NormalizationResult(
            original=word, normalized=word,
            normalization_type="foreign", is_foreign=True, confidence=0.85
        )

    # ── Step 3: Dialect -in → -ing normalization ──
    candidate = _normalize_dialect_ing(w)
    if candidate and is_known_english(candidate):
        return NormalizationResult(
            original=word, normalized=candidate,
            normalization_type="dialect_ing", is_foreign=False, confidence=0.85
        )
    # Also try lemmatizing the -ing form (backstabbing → backstab)
    if candidate:
        # The -ing form might not be in the dictionary directly,
        # but the base verb might be. The lemmatizer will handle this
        # downstream, so we just need to check if the -ing form or its
        # root exists.
        # Try removing -ing to get base verb
        if candidate.endswith("ing") and len(candidate) > 4:
            base = candidate[:-3]
            # Handle doubled consonant: running → runn → run
            if len(base) >= 2 and base[-1] == base[-2]:
                base_short = base[:-1]
                if is_known_english(base_short):
                    return NormalizationResult(
                        original=word, normalized=candidate,
                        normalization_type="dialect_ing", is_foreign=False, confidence=0.80
                    )
            if is_known_english(base):
                return NormalizationResult(
                    original=word, normalized=candidate,
                    normalization_type="dialect_ing", is_foreign=False, confidence=0.80
                )
            # Handle silent-e verbs: racin → racing → rac (fail) → race (check)
            base_e = base + "e"
            if is_known_english(base_e):
                return NormalizationResult(
                    original=word, normalized=candidate,
                    normalization_type="dialect_ing", is_foreign=False, confidence=0.80
                )

    # ── Step 4: Repeated letter collapse ──
    collapsed = _normalize_repeated_letters(w)
    if collapsed and collapsed != w and is_known_english(collapsed):
        return NormalizationResult(
            original=word, normalized=collapsed,
            normalization_type="repeated_letters", is_foreign=False, confidence=0.80
        )
    # Try single-letter collapse too
    if collapsed and collapsed != w:
        single_collapsed = re.sub(r'(.)\1+', r'\1', w)
        if single_collapsed != w and is_known_english(single_collapsed):
            return NormalizationResult(
                original=word, normalized=single_collapsed,
                normalization_type="repeated_letters", is_foreign=False, confidence=0.75
            )

    # ── Step 5: Compound word splitting ──
    components = _try_compound_split(w, is_known_english)
    if components:
        # Use the harder component's word for classification
        # We return the full compound but mark it as compound
        return NormalizationResult(
            original=word, normalized=components[-1],  # classify by last component
            normalization_type="compound",
            is_foreign=False, confidence=0.70
        )

    # ── Step 6: Foreign word heuristics (last resort) ──
    # If word is unknown AND has foreign character patterns AND has zero frequency
    if not _is_likely_english(w):
        return NormalizationResult(
            original=word, normalized=word,
            normalization_type="foreign", is_foreign=True, confidence=0.70
        )

    if _has_foreign_trigrams(w) and get_zipf:
        zipf = get_zipf(w)
        if zipf == 0.0:
            return NormalizationResult(
                original=word, normalized=word,
                normalization_type="foreign", is_foreign=True, confidence=0.60
            )

    # ── No normalization applied ──
    return no_change


def normalize_batch(
    words: list,
    is_known_english: Callable[[str], bool],
    get_zipf: Optional[Callable[[str], float]] = None,
) -> list:
    """
    Normalize a batch of words. Returns list of NormalizationResults.

    Args:
        words: List of word strings to normalize.
        is_known_english: Function that returns True if a word is known English.
        get_zipf: Optional Zipf frequency lookup function.
    """
    # Cache results for duplicate words
    cache = {}
    results = []

    for word in words:
        w = word.lower()
        if w in cache:
            results.append(cache[w])
            continue

        result = normalize_word(word, is_known_english, get_zipf)
        cache[w] = result
        results.append(result)

    # Log summary
    total = len(results)
    foreign_count = sum(1 for r in results if r.is_foreign)
    normalized_count = sum(1 for r in results if r.normalization_type != "none" and not r.is_foreign)

    if foreign_count > 0 or normalized_count > 0:
        logger.info(
            f"Word normalization: {normalized_count} normalized, "
            f"{foreign_count} foreign excluded (out of {total} words)"
        )

    return results
