"""
Semantic and conceptual complexity analysis.

Signals:
  1. Abstractness — average concreteness of content words (inverted)
  2. Polysemy load — average WordNet sense count per content word
  3. Semantic density — content word ratio per sentence
  4. Referential complexity — pronoun-to-explicit-referent ratio

All scores are normalized to 0.0–1.0 for integration with the difficulty scorer.
"""

from dataclasses import dataclass
from typing import List, Optional
import logging
import re

logger = logging.getLogger(__name__)

# Lazy-loaded resources
_wordnet = None
_nlp = None


def _get_wordnet():
    global _wordnet
    if _wordnet is None:
        from nltk.corpus import wordnet
        _wordnet = wordnet
    return _wordnet


def _get_nlp():
    """Share spaCy model with syntactic_analyzer if already loaded."""
    global _nlp
    if _nlp is None:
        try:
            from .syntactic_analyzer import _get_nlp as _get_shared_nlp
            _nlp = _get_shared_nlp()
        except Exception:
            import spacy
            _nlp = spacy.load("en_core_web_sm", disable=["ner"])
            _nlp.max_length = 2_000_000
    return _nlp


# ── Concreteness Ratings (Brysbaert et al. 2014 subset) ──
# Scale: 1.0 = fully abstract, 5.0 = fully concrete
# Curated subset of ~500 high-impact words spanning the concreteness spectrum
# These cover the most frequent content words in movie scripts
CONCRETENESS_RATINGS = {
    # Very concrete (4.5-5.0)
    "car": 5.0, "door": 5.0, "gun": 5.0, "hand": 5.0, "house": 5.0,
    "water": 5.0, "blood": 4.9, "dog": 5.0, "chair": 5.0, "phone": 4.9,
    "money": 4.9, "book": 5.0, "fire": 4.9, "road": 4.9, "tree": 5.0,
    "food": 4.8, "face": 4.9, "eye": 5.0, "body": 4.8, "window": 5.0,
    "table": 5.0, "bed": 5.0, "knife": 5.0, "bottle": 5.0, "ship": 5.0,
    "plane": 4.9, "bomb": 4.8, "wall": 5.0, "floor": 5.0, "baby": 5.0,
    "horse": 5.0, "mountain": 4.9, "river": 4.9, "stone": 5.0, "gold": 4.8,
    "paper": 4.9, "rain": 4.8, "snow": 4.9, "bridge": 4.9, "coffee": 4.9,
    "dress": 4.9, "hat": 5.0, "shoe": 5.0, "box": 5.0, "bag": 5.0,
    "clock": 5.0, "camera": 5.0, "computer": 4.9, "ball": 5.0, "ring": 4.9,
    # Concrete (3.5-4.5)
    "street": 4.5, "city": 4.3, "school": 4.4, "hospital": 4.5, "church": 4.5,
    "office": 4.3, "building": 4.5, "room": 4.4, "garden": 4.5, "farm": 4.4,
    "prison": 4.3, "army": 4.0, "crowd": 4.1, "family": 3.9, "team": 3.8,
    "country": 3.7, "world": 3.5, "earth": 4.0, "sun": 4.5, "star": 4.2,
    "storm": 4.1, "wind": 4.0, "voice": 3.8, "sound": 3.7, "light": 3.9,
    "color": 3.8, "music": 3.7, "movie": 4.0, "game": 3.8, "party": 3.7,
    "fight": 3.6, "war": 3.5, "weapon": 4.2, "bullet": 4.8, "soldier": 4.3,
    "doctor": 4.2, "nurse": 4.3, "teacher": 4.1, "student": 4.0, "child": 4.5,
    "mother": 4.2, "father": 4.2, "brother": 4.2, "sister": 4.2, "friend": 3.6,
    "king": 3.9, "queen": 3.9, "president": 3.8, "police": 4.0, "judge": 3.8,
    # Mid-range (2.5-3.5)
    "work": 3.2, "job": 3.1, "business": 3.0, "company": 3.1, "market": 3.3,
    "power": 2.8, "energy": 2.9, "force": 2.8, "speed": 3.0, "heat": 3.2,
    "system": 2.5, "process": 2.3, "plan": 2.5, "program": 2.7, "project": 2.8,
    "problem": 2.3, "question": 2.5, "answer": 2.5, "idea": 1.8, "thought": 1.9,
    "mind": 2.2, "brain": 4.2, "heart": 4.0, "soul": 1.7, "spirit": 1.8,
    "life": 2.5, "death": 2.9, "birth": 3.2, "age": 2.5, "time": 2.3,
    "day": 2.7, "night": 2.8, "morning": 2.7, "evening": 2.7, "year": 2.3,
    "place": 2.8, "home": 3.5, "side": 2.7, "part": 2.5, "point": 2.5,
    "end": 2.3, "beginning": 2.2, "story": 2.5, "history": 2.3, "news": 2.8,
    "law": 2.3, "rule": 2.2, "order": 2.4, "case": 2.5, "fact": 2.0,
    # Abstract (1.5-2.5)
    "love": 2.3, "hate": 2.1, "fear": 2.2, "hope": 1.9, "dream": 2.3,
    "anger": 2.2, "pain": 2.8, "pleasure": 2.3, "happiness": 1.8, "sadness": 1.9,
    "truth": 1.6, "lie": 2.0, "secret": 2.0, "trust": 1.6, "faith": 1.6,
    "belief": 1.5, "knowledge": 1.8, "wisdom": 1.5, "intelligence": 1.8,
    "chance": 1.8, "luck": 1.7, "fate": 1.6, "destiny": 1.5, "choice": 1.8,
    "freedom": 1.6, "peace": 1.8, "justice": 1.5, "mercy": 1.6, "honor": 1.6,
    "duty": 1.8, "responsibility": 1.4, "right": 1.8, "wrong": 1.7, "good": 1.7,
    "evil": 1.7, "sin": 1.6, "guilt": 1.7, "shame": 1.8, "pride": 1.8,
    "success": 1.7, "failure": 1.7, "victory": 1.9, "defeat": 1.9,
    "danger": 2.0, "risk": 1.7, "safety": 1.9, "security": 1.8, "protection": 2.0,
    "reason": 1.6, "purpose": 1.5, "meaning": 1.4, "value": 1.7, "worth": 1.6,
    # Very abstract (1.0-1.5)
    "democracy": 1.3, "freedom": 1.6, "liberty": 1.4, "equality": 1.3,
    "ideology": 1.2, "philosophy": 1.3, "theory": 1.4, "concept": 1.3,
    "principle": 1.3, "authority": 1.5, "sovereignty": 1.2, "legitimacy": 1.2,
    "morality": 1.2, "ethics": 1.2, "virtue": 1.3, "integrity": 1.3,
    "consciousness": 1.3, "existence": 1.3, "reality": 1.4, "perception": 1.4,
    "intuition": 1.3, "imagination": 1.5, "creativity": 1.4, "inspiration": 1.5,
    "ambition": 1.4, "determination": 1.4, "motivation": 1.3, "aspiration": 1.3,
    "consequence": 1.4, "implication": 1.2, "significance": 1.3,
    "complexity": 1.2, "simplicity": 1.3, "ambiguity": 1.2,
    # Financial/domain abstract words
    "mortgage": 2.5, "equity": 1.8, "bond": 2.8, "derivative": 1.5,
    "collateral": 2.0, "leverage": 1.7, "securities": 2.0, "portfolio": 2.2,
    "inflation": 1.6, "recession": 1.5, "deficit": 1.5, "liability": 1.5,
    "volatility": 1.3, "speculation": 1.5, "arbitrage": 1.3,
}


@dataclass
class SemanticResult:
    """Results from semantic complexity analysis."""
    abstractness: float           # 0.0–1.0: how abstract the vocabulary is
    polysemy_load: float          # 0.0–1.0: avg senses per word, normalized
    semantic_density: float       # 0.0–1.0: content word ratio per sentence
    referential_complexity: float # 0.0–1.0: pronoun vs explicit referent ratio
    composite_score: float        # 0.0–1.0: weighted combination
    raw: dict                     # Raw values for debugging


def _compute_abstractness(words: list) -> tuple:
    """Compute average abstractness from content words."""
    ratings = []
    looked_up = 0
    for w in words:
        w_lower = w.lower()
        if w_lower in CONCRETENESS_RATINGS:
            ratings.append(CONCRETENESS_RATINGS[w_lower])
            looked_up += 1

    if not ratings:
        return 0.3, 0, 3.0  # default mid-range

    avg_concreteness = sum(ratings) / len(ratings)
    # Invert: high concreteness = low abstractness
    # Scale: concreteness 5.0 → abstractness 0.0, concreteness 1.0 → abstractness 1.0
    abstractness = max(0.0, min(1.0, (5.0 - avg_concreteness) / 4.0))
    return abstractness, looked_up, avg_concreteness


def _compute_polysemy(words: list) -> tuple:
    """Compute average polysemy (WordNet sense count) for content words."""
    wn = _get_wordnet()
    sense_counts = []

    for w in words:
        synsets = wn.synsets(w.lower())
        if synsets:
            sense_counts.append(len(synsets))

    if not sense_counts:
        return 0.3, 0, 4.0  # default

    avg_senses = sum(sense_counts) / len(sense_counts)
    # Normalize: 2 senses avg = 0.0, 12+ = 1.0
    polysemy = max(0.0, min((avg_senses - 2.0) / 10.0, 1.0))
    return polysemy, len(sense_counts), avg_senses


def _compute_semantic_density_and_referential(text: str) -> tuple:
    """Compute semantic density and referential complexity using spaCy."""
    nlp = _get_nlp()
    doc = nlp(text[:500_000])  # Cap text length

    sentences = list(doc.sents)
    if not sentences:
        return 0.3, 0.3, {}, {}

    # Semantic density: content words / total words per sentence
    content_pos = {"NOUN", "VERB", "ADJ", "ADV"}
    density_scores = []
    for sent in sentences:
        total = len([t for t in sent if not t.is_punct and not t.is_space])
        content = len([t for t in sent if t.pos_ in content_pos])
        if total > 0:
            density_scores.append(content / total)

    avg_density = sum(density_scores) / len(density_scores) if density_scores else 0.4
    # Normalize: 0.40 (normal speech) = 0.0, 0.65+ (dense academic) = 1.0
    semantic_density = max(0.0, min((avg_density - 0.40) / 0.25, 1.0))

    # Referential complexity: pronoun / (pronoun + explicit noun) ratio
    pronoun_count = 0
    noun_count = 0
    for token in doc:
        if token.pos_ == "PRON":
            pronoun_count += 1
        elif token.pos_ in ("NOUN", "PROPN"):
            noun_count += 1

    total_referents = pronoun_count + noun_count
    if total_referents > 0:
        referential_ratio = pronoun_count / total_referents
    else:
        referential_ratio = 0.3

    # Normalize: 0.30 = 0.0 (many explicit nouns), 0.60+ = 1.0 (heavy pronoun use)
    referential_complexity = max(0.0, min((referential_ratio - 0.30) / 0.30, 1.0))

    density_raw = {
        "avg_content_word_ratio": round(avg_density, 4),
        "sentences_analyzed": len(density_scores),
    }
    ref_raw = {
        "pronoun_count": pronoun_count,
        "noun_count": noun_count,
        "referential_ratio": round(referential_ratio, 4),
    }

    return semantic_density, referential_complexity, density_raw, ref_raw


def analyze_semantics(
    text: Optional[str] = None,
    word_list: Optional[List[str]] = None,
) -> SemanticResult:
    """
    Analyze semantic/conceptual complexity.

    Args:
        text: Raw text for density and referential analysis (optional).
        word_list: List of content words for abstractness and polysemy (optional).
                   If not provided, words are extracted from text via spaCy.
    """
    if not text and not word_list:
        return SemanticResult(
            abstractness=0.3, polysemy_load=0.3, semantic_density=0.3,
            referential_complexity=0.3, composite_score=0.3, raw={}
        )

    # Extract content words from text if word_list not provided
    if not word_list and text:
        nlp = _get_nlp()
        doc = nlp(text[:200_000])
        content_pos = {"NOUN", "VERB", "ADJ", "ADV"}
        word_list = list(set(t.lemma_.lower() for t in doc if t.pos_ in content_pos and len(t.text) > 2))

    if not word_list:
        word_list = []

    # 1. Abstractness
    abstractness, abstract_looked_up, avg_concreteness = _compute_abstractness(word_list)

    # 2. Polysemy
    polysemy, polysemy_looked_up, avg_senses = _compute_polysemy(word_list)

    # 3 & 4. Semantic density and referential complexity
    if text:
        semantic_density, referential_complexity, density_raw, ref_raw = (
            _compute_semantic_density_and_referential(text)
        )
    else:
        semantic_density = 0.3
        referential_complexity = 0.3
        density_raw = {}
        ref_raw = {}

    # Composite
    composite = (
        0.30 * abstractness +
        0.25 * polysemy +
        0.25 * semantic_density +
        0.20 * referential_complexity
    )

    raw = {
        "abstractness_lookup_count": abstract_looked_up,
        "avg_concreteness": round(avg_concreteness, 3) if isinstance(avg_concreteness, float) else avg_concreteness,
        "polysemy_lookup_count": polysemy_looked_up,
        "avg_sense_count": round(avg_senses, 2) if isinstance(avg_senses, float) else avg_senses,
        **density_raw,
        **ref_raw,
    }

    return SemanticResult(
        abstractness=round(abstractness, 4),
        polysemy_load=round(polysemy, 4),
        semantic_density=round(semantic_density, 4),
        referential_complexity=round(referential_complexity, 4),
        composite_score=round(composite, 4),
        raw=raw,
    )
