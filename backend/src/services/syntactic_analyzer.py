"""
Morphosyntactic complexity analysis using spaCy dependency parsing.

Signals:
  1. Clause density — avg subordinate/coordinate clauses per sentence
  2. Syntactic depth — avg max dependency tree depth per sentence
  3. Passive voice ratio — % of sentences containing passive constructions
  4. Nominalization density — frequency of abstract nouns derived from verbs/adjectives

All scores are normalized to 0.0–1.0 for integration with the difficulty scorer.
"""

from dataclasses import dataclass
from typing import Optional
import logging

logger = logging.getLogger(__name__)

# Lazy-loaded spaCy model (singleton)
_nlp = None


def _get_nlp():
    """Load spaCy model on first use. ~2s cold start, then cached."""
    global _nlp
    if _nlp is None:
        import spacy
        _nlp = spacy.load("en_core_web_sm", disable=["ner"])  # NER not needed, saves time
        _nlp.max_length = 2_000_000  # Allow long movie scripts
    return _nlp


# Dependency labels that indicate subordinate clause boundaries
SUBORDINATE_CLAUSE_DEPS = {"advcl", "relcl", "ccomp", "xcomp", "acl", "csubj", "csubjpass"}

# Suffixes that commonly form nominalizations (verb/adj → abstract noun)
NOMINALIZATION_SUFFIXES = (
    "tion", "sion", "ment", "ness", "ity", "ance", "ence",
    "ism", "ure", "age", "ery", "ory", "dom", "ship",
)

# Common false positives — words ending in nominalization suffixes but not actual nominalizations
NOMINALIZATION_EXCEPTIONS = {
    "nation", "station", "mention", "question", "fashion", "mission",
    "position", "condition", "attention", "direction", "section",
    "action", "motion", "option", "portion", "pension",
    "passion", "session", "version", "vision", "occasion",
    "impression", "permission", "expression",
    "moment", "comment", "element", "department", "apartment",
    "document", "argument", "judgment", "statement", "treatment",
    "movement", "government", "management", "agreement",
    "business", "darkness", "witness", "princess",
    "city", "party", "quality", "community", "university",
    "security", "reality", "society", "majority", "opportunity",
    "ability", "activity", "identity", "authority",
    "dance", "chance", "distance", "balance", "performance",
    "experience", "sentence", "silence", "audience", "violence",
    "presence", "evidence", "patience", "difference", "reference",
    "nature", "culture", "future", "picture", "structure",
    "creature", "adventure", "furniture", "temperature",
    "marriage", "village", "passage", "language", "average",
    "message", "package", "storage", "damage", "image",
    "country", "history", "story", "memory", "factory",
    "category", "territory", "inventory",
    "freedom", "kingdom", "wisdom",
    "relationship", "friendship", "worship",
}


@dataclass
class MorphosyntaxResult:
    """Results from morphosyntactic analysis."""
    clause_density: float        # 0.0–1.0: avg subordinate clauses per sentence, normalized
    syntactic_depth: float       # 0.0–1.0: avg max tree depth, normalized
    passive_ratio: float         # 0.0–1.0: fraction of sentences with passive voice
    nominalization_density: float  # 0.0–1.0: nominalization count / total nouns, normalized
    composite_score: float       # 0.0–1.0: weighted combination of all signals
    raw: dict                    # Raw values for debugging


def _compute_tree_depth(token) -> int:
    """Compute depth of a token in the dependency tree (distance from root)."""
    depth = 0
    current = token
    while current.head != current:
        depth += 1
        current = current.head
        if depth > 50:  # Safety: prevent infinite loops on malformed parses
            break
    return depth


def analyze_morphosyntax(text: str, max_chars: int = 500_000) -> MorphosyntaxResult:
    """
    Analyze morphosyntactic complexity of text.

    Args:
        text: Raw text to analyze (movie script, book chapter, etc.)
        max_chars: Truncate text beyond this length to keep processing time reasonable.

    Returns:
        MorphosyntaxResult with normalized scores and raw values.
    """
    if not text or len(text.strip()) < 20:
        return MorphosyntaxResult(
            clause_density=0.3, syntactic_depth=0.3,
            passive_ratio=0.1, nominalization_density=0.1,
            composite_score=0.2, raw={}
        )

    # Truncate very long texts
    if len(text) > max_chars:
        text = text[:max_chars]

    try:
        nlp = _get_nlp()
        doc = nlp(text)
    except Exception as e:
        logger.error(f"spaCy analysis failed: {e}")
        return MorphosyntaxResult(
            clause_density=0.3, syntactic_depth=0.3,
            passive_ratio=0.1, nominalization_density=0.1,
            composite_score=0.2, raw={}
        )

    sentences = list(doc.sents)
    if not sentences:
        return MorphosyntaxResult(
            clause_density=0.3, syntactic_depth=0.3,
            passive_ratio=0.1, nominalization_density=0.1,
            composite_score=0.2, raw={}
        )

    num_sentences = len(sentences)

    # ── 1. Clause Density ──
    # Count subordinate clause markers + coordinate verb clauses per sentence
    total_subordinate_clauses = 0
    total_coordinate_clauses = 0

    for sent in sentences:
        for token in sent:
            if token.dep_ in SUBORDINATE_CLAUSE_DEPS:
                total_subordinate_clauses += 1
            elif token.dep_ == "conj" and token.pos_ == "VERB":
                total_coordinate_clauses += 1

    avg_clauses_per_sentence = (total_subordinate_clauses + total_coordinate_clauses) / num_sentences
    # Normalize: 0 extra clauses = 0.0, 3+ extra clauses/sentence = 1.0
    clause_density = min(avg_clauses_per_sentence / 3.0, 1.0)

    # ── 2. Syntactic Depth ──
    # Average maximum tree depth per sentence
    total_max_depth = 0
    for sent in sentences:
        max_depth = 0
        for token in sent:
            depth = _compute_tree_depth(token)
            if depth > max_depth:
                max_depth = depth
        total_max_depth += max_depth

    avg_max_depth = total_max_depth / num_sentences
    # Normalize: depth 2 = 0.0, depth 8+ = 1.0
    syntactic_depth = max(0.0, min((avg_max_depth - 2.0) / 6.0, 1.0))

    # ── 3. Passive Voice Ratio ──
    # Count sentences containing at least one passive construction
    passive_sentence_count = 0
    for sent in sentences:
        has_passive = False
        for token in sent:
            # spaCy marks passive subjects with nsubjpass or agent
            if token.dep_ in ("nsubjpass", "auxpass", "agent"):
                has_passive = True
                break
            # Also catch "get-passives": "got fired", "get promoted"
            if token.dep_ == "aux" and token.lemma_ in ("be", "get") and token.head.tag_ == "VBN":
                has_passive = True
                break
        if has_passive:
            passive_sentence_count += 1

    passive_ratio_raw = passive_sentence_count / num_sentences
    # Normalize: 0% = 0.0, 25%+ = 1.0
    passive_ratio = min(passive_ratio_raw / 0.25, 1.0)

    # ── 4. Nominalization Density ──
    # Count nouns that are likely derived from verbs/adjectives via productive morphology
    total_nouns = 0
    nominalization_count = 0

    for token in doc:
        if token.pos_ == "NOUN":
            total_nouns += 1
            word_lower = token.text.lower()

            # Skip short words and known exceptions
            if len(word_lower) < 6:
                continue
            if word_lower in NOMINALIZATION_EXCEPTIONS:
                continue

            # Check if the noun ends with a nominalization suffix
            for suffix in NOMINALIZATION_SUFFIXES:
                if word_lower.endswith(suffix):
                    nominalization_count += 1
                    break

    nominalization_ratio = nominalization_count / total_nouns if total_nouns > 0 else 0
    # Normalize: 5% = 0.0, 25%+ = 1.0
    nominalization_density = max(0.0, min((nominalization_ratio - 0.05) / 0.20, 1.0))

    # ── Composite Score ──
    composite = (
        0.35 * clause_density +
        0.25 * syntactic_depth +
        0.20 * passive_ratio +
        0.20 * nominalization_density
    )

    raw = {
        "avg_clauses_per_sentence": round(avg_clauses_per_sentence, 3),
        "total_subordinate_clauses": total_subordinate_clauses,
        "total_coordinate_clauses": total_coordinate_clauses,
        "avg_max_tree_depth": round(avg_max_depth, 2),
        "passive_sentence_count": passive_sentence_count,
        "passive_ratio_raw": round(passive_ratio_raw, 4),
        "nominalization_count": nominalization_count,
        "total_nouns": total_nouns,
        "nominalization_ratio": round(nominalization_ratio, 4),
        "num_sentences": num_sentences,
    }

    return MorphosyntaxResult(
        clause_density=round(clause_density, 4),
        syntactic_depth=round(syntactic_depth, 4),
        passive_ratio=round(passive_ratio, 4),
        nominalization_density=round(nominalization_density, 4),
        composite_score=round(composite, 4),
        raw=raw,
    )
