# Slang, Dialect & Non-English Word Normalization Plan

## Problem Statement

The CEFR classifier misclassifies three categories of words as C1/C2:

1. **Nonstandard spellings / dialect** — Words like *backstabbin*, *racin*, *yappin* are informal contractions of standard English words (*backstabbing*, *racing*, *yapping*). They have near-zero corpus frequency, so the Zipf-based fallback assigns them C2 (confidence: 0.35).

2. **Made-up compound words** — Movie-specific inventions like *gentlecars*, *boomobile*, *racecars* that aren't in any dictionary.

3. **Non-English words** — *gabagool*, *finocchio*, *infàmia* (Italian in The Godfather), *dicono*, *parlare* (Italian in Cars). The existing `FOREIGN_WORDS_FILTER` is a static set of ~200 common words and misses movie-specific foreign vocabulary.

### Root Cause in the Pipeline

```
Word "backstabbin" enters classify_word()
  → Not in KIDS_SIMPLE_VOCAB           (skip)
  → Not in INFORMAL_SIMPLE_VOCAB       (skip)
  → Not a proper noun                  (skip)
  → Not in any CEFR dictionary         (skip)
  → Zipf frequency: 0.0 (not in wordfreq corpus)
  → Frequency fallback: Zipf < 2.0 → C2 (confidence: 0.35)  ← WRONG
```

The fix must happen **before** `classify_word()` — normalize the word to its standard form so dictionary lookup succeeds.

---

## Architecture Overview

```
Script Text
    ↓
[EXISTING] Script Parser → cleaned text
    ↓
[EXISTING] aggressive_preclean() → lowercase tokens
    ↓
[EXISTING] is_valid_token() → filter invalid tokens
    ↓
┌─────────────────────────────────────────────┐
│  NEW STAGE: Word Normalization & Filtering  │
│                                             │
│  1. Language detection → exclude non-English │
│  2. Dialect normalization → standard forms   │
│  3. Compound word splitting                  │
│  4. Tag normalized words with metadata       │
└─────────────────────────────────────────────┘
    ↓
[EXISTING] _get_lemma_fast() → lemmatization
    ↓
[EXISTING] classify_word() → CEFR level
    ↓
[EXISTING] Difficulty scoring (uses filtered set)
```

---

## Phase 1: Dialect & Nonstandard Spelling Normalization

**Goal:** Map informal spellings to their standard base forms before CEFR lookup.

### 1.1 Regex-Based Normalization Rules

These rules run in order. Each produces a candidate normalized form; if the normalized form exists in a CEFR dictionary or has Zipf ≥ 3.0, accept the normalization.

| # | Pattern | Example | Normalized | Rule |
|---|---------|---------|------------|------|
| 1 | `-in` (dropping final g) | backstabbin → backstabbing | `re.sub(r"(\w{3,})in$", r"\1ing", word)` | Most common dialect spelling |
| 2 | `-in'` (apostrophe variant) | runnin' → running | `re.sub(r"(\w{3,})in'$", r"\1ing", word)` | Literary dialect |
| 3 | `-n'` on verbs | goin' → going | Covered by rule 2 | |
| 4 | `-em` (them) | get'em → get them | Split into two words | Contraction |
| 5 | `-er` → `-a` (dropped r) | brotha → brother | `re.sub(r"(\w{3,})a$", r"\1er", word)` | AAVE/dialect — validate against dictionary |
| 6 | Repeated letters | goooood → good | `re.sub(r"(.)\1{2,}", r"\1\1", word)`, then `r"\1"` | Emphasis spelling |
| 7 | `d-` prefix dropping | 'cause → because | Map known contractions | Informal speech |
| 8 | Double consonant before -in | runnin → running, sittin → sitting | Restore -ning/-ting | Verify base verb exists |
| 9 | `'s` possessive/contraction | that's → that | Already handled by tokenizer | |
| 10 | `wanna/gonna/gotta` | wanna → want to | Static mapping | Common contractions |

### 1.2 Implementation: `normalize_nonstandard()` function

```python
def normalize_nonstandard(word: str, dictionary_lookup: Callable) -> tuple[str, str | None]:
    """
    Attempt to normalize a nonstandard/dialect spelling to standard English.
    
    Returns:
        (normalized_word, normalization_type) — type is None if no normalization applied.
    """
```

**Validation requirement:** Every normalization MUST be validated — the normalized form must exist in at least one of:
- The CEFR wordlist (comprehensive_cefr.json)
- The NLTK WordNet lemma database
- wordfreq with Zipf ≥ 3.0

This prevents false normalizations (e.g., "cabin" should NOT become "cabing").

### 1.3 Static Contraction Map

For contractions that can't be handled by regex:

```python
INFORMAL_CONTRACTIONS = {
    "wanna": "want",     "gonna": "go",       "gotta": "get",
    "kinda": "kind",     "sorta": "sort",      "outta": "out",
    "dunno": "know",     "lemme": "let",       "gimme": "give",
    "coulda": "could",   "woulda": "would",    "shoulda": "should",
    "musta": "must",     "oughta": "ought",    "hafta": "have",
    "tryna": "try",      "finna": "will",      "boutta": "about",
    "ain't": "is",       "y'all": "you",       "ma'am": "madam",
    "em": "them",        "ol": "old",          "fer": "for",
    "yer": "your",       "ta": "to",           "wit": "with",
    "doin": "doing",     "goin": "going",      "comin": "coming",
    "nothin": "nothing", "somethin": "something", "anythin": "anything",
    "everythin": "everything",
}
```

### 1.4 CEFR Level Assignment for Normalized Words

When a word is successfully normalized:
- Look up the **normalized form** in the CEFR dictionary
- Use that CEFR level for classification
- If the normalized form is A1-B1, classify the original word at the **same level** (it's the same concept, just spelled informally)
- If the normalized form is B2+, classify at **one level lower** (informal register = simpler context)
- Set confidence to 0.80 (normalized match, not exact match)
- Tag the word with `source: "NORMALIZED"` for debugging

---

## Phase 2: Non-English Word Detection & Filtering

**Goal:** Detect and exclude words from other languages that appear in English-language movie scripts.

### 2.1 Multi-Layer Detection Strategy

#### Layer 1: Expanded Static Filter (immediate)

Expand `FOREIGN_WORDS_FILTER` from ~200 to ~500 words, organized by language and movie genre:

```python
FOREIGN_WORDS_FILTER = {
    # Italian — organized by category
    "greetings": {"ciao", "buongiorno", "arrivederci", ...},
    "food": {"gabagool", "capicola", "prosciutto", "antipasto", ...},
    "mafia_slang": {"paisan", "goombah", "finocchio", "infamia", ...},
    "profanity": {"stronzo", "cazzo", "vaffanculo", ...},
    "common": {"si", "no", "bene", "grazie", "prego", ...},
    # ... other languages
}
```

**Data source:** Scrape the C2 word lists from classified movies in the database. Any C2 word that:
- Contains non-ASCII characters (à, é, ñ, ü, etc.)
- Appears in only 1 movie
- Has zero Zipf frequency in English

→ is a strong candidate for the foreign word filter.

#### Layer 2: Character-Based Heuristics (immediate)

```python
def is_likely_foreign(word: str) -> bool:
    """Quick heuristics for non-English words."""
    # Non-ASCII accented characters uncommon in English
    if re.search(r'[àáâãäåèéêëìíîïòóôõöùúûüñçžšđ]', word):
        return True
    # Character trigrams rare in English
    foreign_trigrams = {'sch', 'tch', 'ght'}  # careful — some are English
    non_english_trigrams = {'zzo', 'gno', 'gli', 'cci', 'cch', 'zzi', 'uol', 'aol'}
    if any(tri in word.lower() for tri in non_english_trigrams):
        return True
    return False
```

#### Layer 3: Dictionary-Based Detection (recommended)

Use `enchant` or `nltk.corpus.words` to verify a word exists in English:

```python
import enchant
english_dict = enchant.Dict("en_US")

def is_english_word(word: str) -> bool:
    """Check if word exists in English dictionary."""
    return english_dict.check(word) or english_dict.check(word.capitalize())
```

**Fallback (no enchant):** Check against the union of:
- CEFR wordlists (comprehensive_cefr.json + efllex.json + NGSL)
- NLTK words corpus (`nltk.corpus.words.words()`)
- wordfreq Zipf > 0 for "en"

A word with **zero** presence in all English sources AND zero Zipf frequency is almost certainly foreign.

#### Layer 4: `langdetect` / `langid` for Longer Sequences (optional)

For movie scripts with heavy code-switching (e.g., bilingual dialogue):

```python
from langdetect import detect_langs

def detect_sentence_language(sentence: str) -> str:
    """Detect primary language of a sentence."""
    results = detect_langs(sentence)
    return results[0].lang  # 'en', 'it', 'es', etc.
```

Mark entire sentences as non-English if confidence > 0.7 for a non-English language. All words in that sentence are excluded from CEFR classification.

### 2.2 Handling Detected Foreign Words

| Action | When | Result |
|--------|------|--------|
| **Exclude** | Word is clearly foreign (accent marks, foreign dictionary match, zero English frequency) | Remove from word list entirely — does not count toward CEFR distribution or difficulty score |
| **Tag** | Word might be foreign (heuristic match only, no dictionary confirmation) | Keep in word list but tag as `language: "unknown"`, exclude from difficulty scoring |
| **Keep** | English loanword that's entered common usage (e.g., "pasta", "karate", "kindergarten") | Classify normally — these ARE English vocabulary learners should know |

### 2.3 Loanword Whitelist

Some foreign-origin words are legitimate English vocabulary:

```python
ENGLISH_LOANWORDS = {
    # Italian food (internationally known)
    "pizza", "pasta", "espresso", "cappuccino", "latte", "gelato",
    "risotto", "bruschetta", "tiramisu", "panini",
    # Japanese (entered English)
    "karate", "judo", "tsunami", "emoji", "anime", "manga",
    "sushi", "tofu", "sake", "kimono", "origami",
    # French (common in English)
    "ballet", "cafe", "champagne", "chauffeur", "cliche",
    "entrepreneur", "fiancee", "genre", "naive", "plateau",
    # German
    "kindergarten", "wanderlust", "zeitgeist", "angst", "kitsch",
    # Spanish
    "fiesta", "siesta", "plaza", "tornado", "mosquito",
}
```

Words in this set bypass foreign word filtering and classify normally.

---

## Phase 3: Compound Word Decomposition

**Goal:** Handle movie-specific invented compound words like *gentlecars*, *racecars*, *whitewalls*.

### 3.1 Compound Splitting Strategy

```python
def try_split_compound(word: str, dictionary: set) -> list[str] | None:
    """
    Try to split a compound word into known English words.
    Returns component words if successful, None otherwise.
    
    Example: "racecars" → ["race", "cars"]
             "gentlecars" → ["gentle", "cars"]
             "whitewalls" → ["white", "walls"]
    """
    # Try all split points
    for i in range(3, len(word) - 2):  # min 3 chars per component
        left, right = word[:i], word[i:]
        if left in dictionary and right in dictionary:
            return [left, right]
        # Try with lemmatization
        left_lemma = lemmatize(left)
        right_lemma = lemmatize(right)
        if left_lemma in dictionary and right_lemma in dictionary:
            return [left_lemma, right_lemma]
    return None
```

### 3.2 CEFR Assignment for Compounds

When a compound splits successfully:
- CEFR level = **max** of component levels (the harder component determines difficulty)
- Example: "racecars" = max(race=A1, cars=A1) = **A1**
- Example: "whitewalls" = max(white=A1, walls=A1) = **A1**
- Confidence: 0.70 (compound decomposition)

### 3.3 Suffix-Based Decomposition

Some compounds have recognizable suffixes:

```python
COMPOUND_SUFFIXES = {
    "mobile": True,   # boomobile → boom + mobile
    "man": True,      # buttonmen → button + men (irregular)
    "men": True,
    "like": True,     # catlike → cat + like
    "wise": True,
    "proof": True,
    "free": True,
    "less": True,
    "ful": True,
}
```

---

## Phase 4: Integration with Existing Pipeline

### 4.1 New Module: `word_normalizer.py`

Create `/backend/src/services/word_normalizer.py`:

```python
"""
Word normalization pipeline: dialect → standard English, foreign word filtering,
compound decomposition. Runs BEFORE CEFR classification.
"""

@dataclass
class NormalizationResult:
    original: str           # "backstabbin"
    normalized: str         # "backstabbing"  
    normalization_type: str # "dialect_ing" | "contraction" | "compound" | "foreign" | "none"
    is_foreign: bool        # True → exclude from CEFR scoring
    confidence: float       # How confident we are in the normalization
    language: str | None    # "it", "es", "fr" if foreign detected

def normalize_word(word: str) -> NormalizationResult:
    """Full normalization pipeline for a single word."""
    
def normalize_batch(words: list[str]) -> list[NormalizationResult]:
    """Batch normalization with caching."""
```

### 4.2 Integration Point in `classify_text()`

Insert normalization between tokenization and lemmatization in `cefr_classifier.py:1426-1441`:

```python
# CURRENT (line 1426-1441):
cleaned_text = self.aggressive_preclean(text)
words = cleaned_text.split()
valid_words = [w for w in words if is_valid_token(w)]
unique_words = list(set(valid_words))

# NEW — insert after valid_words, before unique_words:
from .word_normalizer import normalize_batch

norm_results = normalize_batch(valid_words)

# Separate English words from foreign words
english_words = []
foreign_words = []
normalization_map = {}  # original → normalized

for result in norm_results:
    if result.is_foreign:
        foreign_words.append(result.original)
        continue
    if result.normalized != result.original:
        normalization_map[result.original] = result.normalized
    english_words.append(result.normalized)

# Replace valid_words with normalized English-only words
valid_words = english_words
unique_words = list(set(valid_words))

# Log stats
logger.info(f"Normalization: {len(normalization_map)} words normalized, "
            f"{len(foreign_words)} foreign words excluded")
```

### 4.3 Downstream Impact

Once normalization runs before classification:

| Component | Effect |
|-----------|--------|
| **CEFR classification** | Normalized words hit dictionary lookups → correct levels |
| **Difficulty scorer** | Foreign words excluded → cleaner CEFR distribution |
| **Word count / unique words** | Slightly lower (foreign words removed) |
| **Idiom detection** | No change (operates on raw text) |
| **Morphosyntax analysis** | No change (operates on raw text via spaCy) |
| **Sentence length buckets** | No change (sentence-level, not word-level) |

### 4.4 Database Schema

No schema changes required. Normalized words are stored with their **normalized form** as the `word` field and the **normalized lemma** as the `lemma` field. The original spelling is not persisted (it's a display artifact, not linguistically meaningful).

Optional future enhancement: add a `normalization_applied` boolean column to `word_classifications` for debugging.

---

## Phase 5: Frequency-Based Safety Net

**Goal:** Catch remaining misclassifications that slip through all other filters.

### 5.1 The "Unknown Word" Problem

Currently, words not found in any dictionary AND with zero Zipf frequency get classified as C2. This is the single largest source of misclassification.

**New rule:** Any word classified as C2 with confidence < 0.5 should be re-evaluated:

```python
# In classify_word(), after all classification stages:
if result.cefr_level == CEFRLevel.C2 and result.confidence < 0.5:
    # Check if it looks like a real English word
    if not _looks_like_english(word):
        result = NormalizationResult(is_foreign=True)  # exclude
    elif _is_possible_compound(word):
        # Try compound splitting
        components = try_split_compound(word)
        if components:
            result.cefr_level = max_cefr_of(components)
    elif _is_possible_dialect(word):
        # Try dialect normalization
        normalized = normalize_nonstandard(word)
        if normalized:
            result = classify_word(normalized)
    else:
        # Unknown word, not foreign, not dialect, not compound
        # Downgrade to B2 instead of C2 (benefit of the doubt)
        result.cefr_level = CEFRLevel.B2
        result.confidence = 0.25
```

### 5.2 English Word Shape Heuristics

```python
def _looks_like_english(word: str) -> bool:
    """Check if a word has typical English orthographic patterns."""
    w = word.lower()
    
    # Must have at least one vowel
    if not re.search(r'[aeiouy]', w):
        return False
    
    # No triple consonants that don't occur in English
    impossible_clusters = ['bck', 'dgh', 'fgh', 'gkl', 'jkl', 'qxy', 'vwx', 'zxq']
    if any(cl in w for cl in impossible_clusters):
        return False
    
    # Vowel-to-consonant ratio should be reasonable (English ~40% vowels)
    vowel_count = sum(1 for c in w if c in 'aeiouy')
    if vowel_count / len(w) < 0.15 or vowel_count / len(w) > 0.70:
        return False
    
    return True
```

---

## Phase 6: Dynamic Blacklist & Learning

### 6.1 Per-Movie Foreign Word Cache

After classification, log which words were detected as foreign per movie:

```python
# Store in movie_scripts metadata (JSON column)
processing_metadata = {
    "foreign_words_excluded": ["gabagool", "finocchio", "paisan", ...],
    "words_normalized": {"backstabbin": "backstabbing", "racin": "racing", ...},
    "normalization_stats": {
        "dialect_ing": 15,
        "contraction": 3,
        "compound_split": 2,
        "foreign_excluded": 8,
    }
}
```

### 6.2 Admin Review Queue (optional, future)

Words classified with low confidence or flagged by heuristics can be queued for manual review:

```sql
CREATE TABLE word_review_queue (
    id SERIAL PRIMARY KEY,
    word VARCHAR NOT NULL,
    movie_id INT REFERENCES movies(id),
    original_level VARCHAR(2),      -- What the classifier assigned
    suggested_level VARCHAR(2),     -- What the heuristic suggests
    normalization_type VARCHAR(50), -- "dialect_ing", "foreign", etc.
    status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 6.3 Feedback Loop

When users report a word as incorrectly classified (via `word_reports` table):
- If 3+ users report the same word → auto-add to appropriate filter/mapping
- Track which normalization rules produce the most corrections

---

## Implementation Checklist

### P0 — Core Normalization (fixes the immediate problem)

- [ ] Create `backend/src/services/word_normalizer.py` with `NormalizationResult` dataclass
- [ ] Implement `-in` → `-ing` regex normalization with dictionary validation
- [ ] Implement static `INFORMAL_CONTRACTIONS` map (wanna, gonna, gotta, etc.)
- [ ] Implement repeated-letter collapse (goooood → good)
- [ ] Add validation: only accept normalization if normalized form exists in CEFR wordlist OR has Zipf ≥ 3.0
- [ ] Integrate `normalize_batch()` into `classify_text()` at line 1427, before deduplication
- [ ] Add unit tests: backstabbin→backstabbing(A2), racin→racing(A1), yappin→yapping(B1)

### P1 — Foreign Word Filtering (fixes non-English contamination)

- [ ] Expand `FOREIGN_WORDS_FILTER` with movie-specific Italian, Spanish words from DB audit
- [ ] Add `is_likely_foreign()` character-based heuristic (accent marks, non-English trigrams)
- [ ] Add `ENGLISH_LOANWORDS` whitelist (pizza, karate, ballet, etc.)
- [ ] Add English dictionary check: word must exist in CEFR wordlists OR NLTK words OR wordfreq Zipf > 0
- [ ] Integrate foreign detection into `is_valid_token()` or normalization pipeline
- [ ] Test: gabagool=excluded, finocchio=excluded, pizza=kept, pasta=kept

### P2 — Compound Word Handling

- [ ] Implement `try_split_compound()` with dictionary-validated split points
- [ ] Add `COMPOUND_SUFFIXES` list for guided splitting
- [ ] CEFR assignment: max(component levels)
- [ ] Test: racecars→A1, whitewalls→A1, gentlecars→A1, boomobile→excluded(made-up)

### P3 — Safety Net & Low-Confidence C2 Revaluation

- [ ] Add `_looks_like_english()` orthographic heuristic
- [ ] Re-evaluate C2 words with confidence < 0.5: try normalization → compound split → downgrade to B2
- [ ] Remove or refine the existing "impossible C2 spike" logic (lines 1448-1489) — the new normalization pipeline should prevent the spike from occurring in the first place

### P4 — Logging, Metadata & Observability

- [ ] Log normalization stats per movie in `processing_metadata` JSON column
- [ ] Add `normalization_type` to classification output for debugging
- [ ] Create a one-time backfill script to reclassify existing movies with the new pipeline

### P5 — Optional Enhancements

- [ ] Sentence-level language detection with `langdetect` for bilingual scripts
- [ ] Admin review queue for low-confidence words
- [ ] User-report feedback loop (auto-add to filters after 3+ reports)
- [ ] Dynamic per-movie foreign word blacklist generated during classification

---

## Recommended Libraries & Datasets

| Resource | Purpose | Install |
|----------|---------|---------|
| `wordfreq` | Zipf frequency scores (already in use) | `pip install wordfreq` |
| `nltk` + WordNet | Lemmatization, word existence check (already in use) | `pip install nltk` |
| `pyenchant` | Fast English dictionary lookup | `pip install pyenchant` |
| `langdetect` | Sentence-level language identification | `pip install langdetect` |
| `langid` | Alternative language ID (faster, less accurate) | `pip install langid` |
| NLTK `words` corpus | 236K English word list | `nltk.download('words')` |
| Wiktionary dump | Comprehensive multilingual word database | Free download |
| Unicode CLDR | Language-specific character patterns | Built into Python `unicodedata` |

---

## Expected Impact

### Before (current state — Cars movie):
```
C2 words (53): backstabbin, bitin, feedin, racin, winnin, yappin,
               boomobile, gentlecars, racecars, dicono, fantastico,
               parlare, piace, ...
```

### After (with normalization pipeline):
```
C2 words (3-5): unequivocally, precisional, ...  (genuinely rare English)

Normalized (→ correct level):
  backstabbin → backstabbing (A2)
  racin → racing (A1)
  yappin → yapping (B1)
  winnin → winning (A1)

Excluded (foreign):
  dicono, fantastico, parlare, piace, stati (Italian)
  parlando, riprenda, stoppo, lappo (Italian)

Excluded (made-up):
  boomobile, gentlecars, shrimpie, precisional (not real English)
```

### Difficulty Score Impact:
- **Cars**: C2 count drops from 53 to ~5 → CEFR distribution becomes cleaner → difficulty score may decrease slightly (more accurately reflecting a kids movie)
- **Lincoln**: C2 count stays at ~40-50 (most are genuinely rare English words) → score stays at 70 (C1)
- **The Godfather**: C2 drops from 12 to ~2 (most were Italian) → score stays around 36-39 (B1)
