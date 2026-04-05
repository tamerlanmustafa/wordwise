"""
Lexical sophistication analysis.

Signals:
  1. Collocation complexity — density of strong word pairings (high PMI bigrams)
  2. Multi-word expression (MWE) density — idioms, phrasal verbs, fixed expressions
  3. Rare morphological forms — uncommon inflections, productive derivations

All scores normalized to 0.0–1.0.
"""

from dataclasses import dataclass
from typing import List, Optional
from collections import Counter
import math
import re
import logging

logger = logging.getLogger(__name__)


# ── MWE / Idiom Database (CEFR-tagged) ──
# Phrasal verbs and idioms organized by CEFR level
MWE_DATABASE = {
    # A2-B1: common phrasal verbs (low weight)
    "A2": {
        "look for", "look at", "look after", "pick up", "put on", "take off",
        "turn on", "turn off", "give up", "go on", "come back", "get up",
        "sit down", "stand up", "come in", "go out", "find out", "make up",
        "set up", "work out", "bring up", "carry on", "point out",
        "wake up", "show up", "hold on", "calm down", "hang out",
    },
    # B1-B2: less obvious phrasal verbs (medium weight)
    "B1": {
        "break down", "break up", "break out", "break in", "break through",
        "come across", "come up with", "cut off", "drop off", "fall apart",
        "figure out", "get along", "get away", "get over", "get rid of",
        "give in", "go through", "keep up", "let down", "look forward to",
        "look into", "look up to", "make out", "pass away", "pull off",
        "put off", "put up with", "run into", "run out of", "sort out",
        "take after", "take over", "throw away", "turn down", "turn out",
        "work out", "back up", "blow up", "bring about", "call off",
        "check in", "check out", "end up", "fill in", "hand in",
    },
    # B2-C1: sophisticated expressions (high weight)
    "B2": {
        "account for", "boil down to", "brush up on", "bump into",
        "carry out", "come to terms with", "crack down on", "dawn on",
        "do away with", "draw up", "fall through", "fend for",
        "get away with", "give rise to", "go along with", "iron out",
        "lay off", "live up to", "make do with", "narrow down",
        "opt out", "phase out", "play down", "pull through",
        "rule out", "set back", "single out", "spell out",
        "stand for", "step down", "take into account", "turn a blind eye",
        "ward off", "weed out", "wind up", "zero in on",
    },
    # C1-C2: advanced/literary idioms (highest weight)
    "C1": {
        "beat around the bush", "bite the bullet", "burn bridges",
        "by and large", "cut corners", "down the line",
        "few and far between", "fly off the handle", "get cold feet",
        "go the extra mile", "have a bone to pick", "hit the nail on the head",
        "in the long run", "jump the gun", "keep tabs on",
        "leave no stone unturned", "miss the boat", "nip in the bud",
        "on the fence", "out of the blue", "pull strings",
        "read between the lines", "ring a bell", "see eye to eye",
        "take with a grain of salt", "the last straw", "think outside the box",
        "throw in the towel", "turn over a new leaf", "under the weather",
        "up in the air", "water under the bridge",
        "a far cry from", "at the drop of a hat", "behind the scenes",
        "call it a day", "down to earth", "get the ball rolling",
        "in a nutshell", "keep at bay", "lose track of",
        "make ends meet", "on thin ice", "play it by ear",
    },
}

# CEFR weights for MWE scoring
MWE_LEVEL_WEIGHTS = {"A2": 0.3, "B1": 0.6, "B2": 1.0, "C1": 1.5}

# Flatten for quick lookup
ALL_MWES = {}
for level, expressions in MWE_DATABASE.items():
    for expr in expressions:
        ALL_MWES[expr] = level

# ── Rare Irregular Forms ──
# Uncommon irregular past tenses / participles that trip up learners
RARE_IRREGULAR_FORMS = {
    "wrought", "bidden", "slain", "smitten", "strewn", "stricken",
    "beset", "clad", "shorn", "hewn", "riven", "cloven",
    "begotten", "forsaken", "partaken", "undergone", "withheld",
    "overridden", "beholden", "overwrought", "bereft", "fraught",
    "distraught", "overwrought", "besought", "betrothed",
    "foregone", "misgiven", "outbidden", "outworn",
    "sunken", "molten", "proven", "shrunken", "drunken",
    "trodden", "downtrodden", "swollen", "misshapen",
}


@dataclass
class LexicalResult:
    """Results from lexical sophistication analysis."""
    collocation_complexity: float   # 0.0–1.0
    mwe_density: float              # 0.0–1.0
    rare_morphology: float          # 0.0–1.0
    composite_score: float          # 0.0–1.0
    raw: dict


def _compute_collocation_complexity(text: str) -> tuple:
    """
    Compute collocation strength using Pointwise Mutual Information (PMI).
    Uses in-text bigram frequencies as an approximation.
    """
    words = re.findall(r'\b[a-z]{2,}\b', text.lower())
    if len(words) < 50:
        return 0.2, {"bigram_count": 0, "strong_collocations": 0}

    # Count unigrams and bigrams
    unigram_counts = Counter(words)
    bigrams = [(words[i], words[i + 1]) for i in range(len(words) - 1)]
    bigram_counts = Counter(bigrams)

    total_words = len(words)
    total_bigrams = len(bigrams)

    # Compute PMI for each bigram
    strong_collocations = 0
    min_count = 3  # Only consider bigrams appearing 3+ times

    for (w1, w2), count in bigram_counts.items():
        if count < min_count:
            continue

        p_bigram = count / total_bigrams
        p_w1 = unigram_counts[w1] / total_words
        p_w2 = unigram_counts[w2] / total_words

        if p_w1 > 0 and p_w2 > 0:
            pmi = math.log2(p_bigram / (p_w1 * p_w2))
            if pmi > 3.0:  # Strong collocation threshold
                strong_collocations += 1

    unique_bigrams = len(bigram_counts)
    collocation_ratio = strong_collocations / unique_bigrams if unique_bigrams > 0 else 0

    # Normalize: 1% strong = 0.0, 5%+ = 1.0
    score = max(0.0, min((collocation_ratio - 0.01) / 0.04, 1.0))

    raw = {
        "total_bigrams": total_bigrams,
        "unique_bigrams": unique_bigrams,
        "strong_collocations": strong_collocations,
        "collocation_ratio": round(collocation_ratio, 4),
    }
    return score, raw


def _compute_mwe_density(text: str) -> tuple:
    """Detect multi-word expressions and compute weighted density."""
    text_lower = text.lower()
    sentences = re.split(r'[.!?]+', text_lower)
    num_sentences = max(1, len([s for s in sentences if s.strip()]))

    found_mwes = []
    weighted_score = 0.0

    for expr, level in ALL_MWES.items():
        # Count occurrences (non-overlapping)
        count = text_lower.count(expr)
        if count > 0:
            weight = MWE_LEVEL_WEIGHTS.get(level, 1.0)
            found_mwes.append({"expression": expr, "level": level, "count": count})
            weighted_score += count * weight

    # Normalize by sentence count
    mwe_per_sentence = weighted_score / num_sentences

    # Normalize: 0.0 MWEs/sentence = 0.0, 0.3+ weighted MWEs/sentence = 1.0
    score = min(mwe_per_sentence / 0.30, 1.0)

    raw = {
        "found_mwes": len(found_mwes),
        "total_mwe_occurrences": sum(m["count"] for m in found_mwes),
        "weighted_mwe_score": round(weighted_score, 2),
        "num_sentences": num_sentences,
        "mwe_per_sentence": round(mwe_per_sentence, 4),
        "top_mwes": sorted(found_mwes, key=lambda x: x["count"], reverse=True)[:10],
    }
    return score, raw


def _compute_rare_morphology(words: List[str]) -> tuple:
    """Detect rare irregular forms and productive derivations."""
    if not words:
        return 0.0, {"rare_forms_found": []}

    word_set = set(w.lower() for w in words)
    rare_found = word_set & RARE_IRREGULAR_FORMS

    # Also detect productive prefixation/suffixation patterns
    productive_count = 0
    productive_examples = []
    for w in word_set:
        if len(w) < 8:
            continue
        # Double prefix: un-re-, dis-re-, over-un-
        if re.match(r'^(un|re|dis|over|mis|out|under)(un|re|dis|over|mis|out|under)', w):
            productive_count += 1
            productive_examples.append(w)
        # Long suffix chains: -ation-al, -ment-al-ly
        elif re.search(r'(tion|ment|ness|ity)(al|ly|ous|ive|ful)$', w):
            productive_count += 1
            productive_examples.append(w)

    total_rare = len(rare_found) + productive_count
    total_unique = len(word_set) if word_set else 1

    rare_ratio = total_rare / total_unique
    # Normalize: 0.5% = 0.0, 3%+ = 1.0
    score = max(0.0, min((rare_ratio - 0.005) / 0.025, 1.0))

    raw = {
        "rare_irregular_forms": sorted(rare_found),
        "productive_derivations": productive_examples[:10],
        "total_rare": total_rare,
        "total_unique_words": total_unique,
        "rare_ratio": round(rare_ratio, 5),
    }
    return score, raw


def analyze_lexical_sophistication(
    text: Optional[str] = None,
    word_list: Optional[List[str]] = None,
) -> LexicalResult:
    """
    Analyze lexical sophistication of text.

    Args:
        text: Raw text for collocation and MWE analysis.
        word_list: Unique content words for morphology analysis.
    """
    if not text and not word_list:
        return LexicalResult(
            collocation_complexity=0.2, mwe_density=0.2,
            rare_morphology=0.1, composite_score=0.17, raw={}
        )

    # 1. Collocation complexity
    if text:
        collocation, collocation_raw = _compute_collocation_complexity(text)
    else:
        collocation, collocation_raw = 0.2, {}

    # 2. MWE density
    if text:
        mwe, mwe_raw = _compute_mwe_density(text)
    else:
        mwe, mwe_raw = 0.2, {}

    # 3. Rare morphology
    if word_list:
        rare_morph, morph_raw = _compute_rare_morphology(word_list)
    elif text:
        words = list(set(re.findall(r'\b[a-z]{3,}\b', text.lower())))
        rare_morph, morph_raw = _compute_rare_morphology(words)
    else:
        rare_morph, morph_raw = 0.1, {}

    composite = (
        0.40 * collocation +
        0.35 * mwe +
        0.25 * rare_morph
    )

    raw = {
        "collocation": collocation_raw,
        "mwe": mwe_raw,
        "morphology": morph_raw,
    }

    return LexicalResult(
        collocation_complexity=round(collocation, 4),
        mwe_density=round(mwe, 4),
        rare_morphology=round(rare_morph, 4),
        composite_score=round(composite, 4),
        raw=raw,
    )
