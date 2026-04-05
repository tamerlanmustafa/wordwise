"""
Pragmatic and discourse complexity analysis.

Signals:
  1. Indirect speech density — hedging, reporting verbs, understatement markers
  2. Discourse cohesion complexity — sophistication of logical connectors
  3. Cultural reference density — named entity frequency (proxy for world knowledge)

All scores normalized to 0.0–1.0.
"""

from dataclasses import dataclass
from typing import Optional
import re
import logging

logger = logging.getLogger(__name__)

# Lazy-loaded spaCy
_nlp = None


def _get_nlp():
    global _nlp
    if _nlp is None:
        try:
            from .syntactic_analyzer import _get_nlp as _get_shared_nlp
            _nlp = _get_shared_nlp()
        except Exception:
            import spacy
            _nlp = spacy.load("en_core_web_sm")
            _nlp.max_length = 2_000_000
    return _nlp


# ── Indirect Speech & Hedging Markers ──

REPORTING_VERBS = {
    # B1 level (common)
    "said", "told", "asked", "answered", "replied", "explained",
    "mentioned", "suggested", "thought", "believed", "felt",
    # B2+ level (sophisticated)
    "claimed", "argued", "insisted", "maintained", "contended",
    "asserted", "alleged", "implied", "insinuated", "hinted",
    "acknowledged", "admitted", "conceded", "denied", "remarked",
    "observed", "noted", "pointed out", "emphasized", "stressed",
    "warned", "cautioned", "urged", "recommended", "proposed",
    "speculated", "hypothesized", "theorized", "reasoned",
}

HEDGING_MARKERS = {
    # Single words
    "perhaps", "maybe", "possibly", "probably", "presumably",
    "apparently", "seemingly", "arguably", "supposedly", "allegedly",
    "roughly", "approximately", "essentially", "virtually", "practically",
    # Multi-word hedges
    "sort of", "kind of", "more or less", "to some extent",
    "in a way", "in a sense", "as it were", "so to speak",
    "if you will", "as far as", "to a certain degree",
    "not exactly", "not entirely", "not necessarily", "not unlike",
}

UNDERSTATEMENT_PATTERNS = [
    r'\bnot\s+(exactly|entirely|quite|really|particularly|especially)\b',
    r'\bnot\s+un\w+\b',  # "not unhappy", "not unreasonable"
    r'\bhardly\s+\w+\b',
    r'\bscarcely\s+\w+\b',
    r'\brather\s+(than|good|bad|well|poor|nice)\b',
]

# ── Discourse Markers by CEFR Level ──

DISCOURSE_MARKERS = {
    "A1": {"and", "but", "so", "or", "then", "also", "too", "because"},
    "A2": {"first", "next", "finally", "after", "before", "while", "during",
           "still", "already", "yet", "just", "even"},
    "B1": {"however", "although", "therefore", "moreover", "furthermore",
           "meanwhile", "despite", "instead", "otherwise", "besides",
           "thus", "hence", "consequently", "whereas", "nevertheless",
           "in addition", "on the other hand", "as a result", "in fact",
           "for example", "for instance", "in other words", "that is"},
    "B2": {"nonetheless", "notwithstanding", "conversely", "subsequently",
           "accordingly", "alternatively", "incidentally", "admittedly",
           "undoubtedly", "inevitably", "ironically", "paradoxically",
           "in contrast", "by contrast", "on the contrary", "in particular",
           "as a matter of fact", "to put it another way", "having said that",
           "be that as it may", "all things considered", "in the final analysis"},
    "C1": {"hitherto", "henceforth", "thereby", "whereby", "insofar as",
           "inasmuch as", "irrespective of", "lest", "whence", "therein",
           "notwithstanding that", "provided that", "given that",
           "in light of", "in view of", "with regard to", "on account of",
           "by virtue of", "for the sake of", "in the event of"},
}

DISCOURSE_MARKER_WEIGHTS = {"A1": 0.0, "A2": 0.2, "B1": 0.5, "B2": 0.8, "C1": 1.0}


@dataclass
class DiscourseResult:
    """Results from pragmatic/discourse analysis."""
    indirect_speech: float       # 0.0–1.0
    cohesion_complexity: float   # 0.0–1.0
    cultural_ref_density: float  # 0.0–1.0
    composite_score: float       # 0.0–1.0
    raw: dict


def _compute_indirect_speech(text: str) -> tuple:
    """Detect indirect speech, hedging, and understatement markers."""
    text_lower = text.lower()
    sentences = [s.strip() for s in re.split(r'[.!?]+', text_lower) if s.strip()]
    num_sentences = max(1, len(sentences))

    # Count reporting verbs
    reporting_count = 0
    for verb in REPORTING_VERBS:
        reporting_count += len(re.findall(r'\b' + re.escape(verb) + r'\b', text_lower))

    # Count hedging markers
    hedge_count = 0
    for hedge in HEDGING_MARKERS:
        hedge_count += text_lower.count(hedge)

    # Count understatement patterns
    understatement_count = 0
    for pattern in UNDERSTATEMENT_PATTERNS:
        understatement_count += len(re.findall(pattern, text_lower))

    total_markers = reporting_count + hedge_count + understatement_count
    markers_per_sentence = total_markers / num_sentences

    # Normalize: 0.02 markers/sentence = 0.0, 0.15+ = 1.0
    score = max(0.0, min((markers_per_sentence - 0.02) / 0.13, 1.0))

    raw = {
        "reporting_verbs": reporting_count,
        "hedging_markers": hedge_count,
        "understatements": understatement_count,
        "total_markers": total_markers,
        "markers_per_sentence": round(markers_per_sentence, 4),
    }
    return score, raw


def _compute_cohesion_complexity(text: str) -> tuple:
    """Measure sophistication of discourse markers used."""
    text_lower = text.lower()

    level_counts = {}
    total_weighted = 0.0
    total_count = 0

    for level, markers in DISCOURSE_MARKERS.items():
        count = 0
        for marker in markers:
            if " " in marker:
                count += text_lower.count(marker)
            else:
                count += len(re.findall(r'\b' + re.escape(marker) + r'\b', text_lower))
        level_counts[level] = count
        weight = DISCOURSE_MARKER_WEIGHTS[level]
        total_weighted += count * weight
        total_count += count

    # Weighted average of marker sophistication
    if total_count > 0:
        avg_sophistication = total_weighted / total_count
    else:
        avg_sophistication = 0.0

    # Score is the average marker level (0.0 = all A1, 1.0 = all C1)
    score = min(avg_sophistication, 1.0)

    raw = {
        "level_counts": level_counts,
        "total_markers": total_count,
        "avg_sophistication": round(avg_sophistication, 4),
    }
    return score, raw


def _compute_cultural_reference_density(text: str) -> tuple:
    """Use spaCy NER to count named entities as proxy for cultural knowledge."""
    # NER needs to be enabled for this
    try:
        import spacy
        nlp = spacy.load("en_core_web_sm")  # Need NER enabled
        nlp.max_length = 2_000_000
    except Exception:
        return 0.2, {"entity_count": 0, "note": "spaCy NER unavailable"}

    doc = nlp(text[:300_000])  # Cap for performance
    sentences = list(doc.sents)
    num_sentences = max(1, len(sentences))

    # Count entities that require world knowledge
    knowledge_entities = {"PERSON", "ORG", "GPE", "EVENT", "WORK_OF_ART", "LAW", "NORP"}
    entity_count = 0
    entity_types = {}
    for ent in doc.ents:
        if ent.label_ in knowledge_entities:
            entity_count += 1
            entity_types[ent.label_] = entity_types.get(ent.label_, 0) + 1

    entities_per_sentence = entity_count / num_sentences
    # Normalize: 0.2 entities/sentence = 0.0, 1.5+ = 1.0
    score = max(0.0, min((entities_per_sentence - 0.2) / 1.3, 1.0))

    raw = {
        "entity_count": entity_count,
        "entity_types": entity_types,
        "entities_per_sentence": round(entities_per_sentence, 4),
        "num_sentences": num_sentences,
    }
    return score, raw


def analyze_discourse(text: Optional[str] = None) -> DiscourseResult:
    """
    Analyze pragmatic and discourse complexity.

    Args:
        text: Raw text to analyze.
    """
    if not text or len(text.strip()) < 20:
        return DiscourseResult(
            indirect_speech=0.1, cohesion_complexity=0.1,
            cultural_ref_density=0.1, composite_score=0.1, raw={}
        )

    # 1. Indirect speech
    indirect, indirect_raw = _compute_indirect_speech(text)

    # 2. Cohesion
    cohesion, cohesion_raw = _compute_cohesion_complexity(text)

    # 3. Cultural references
    cultural, cultural_raw = _compute_cultural_reference_density(text)

    composite = (
        0.35 * indirect +
        0.40 * cohesion +
        0.25 * cultural
    )

    raw = {
        "indirect_speech": indirect_raw,
        "cohesion": cohesion_raw,
        "cultural_references": cultural_raw,
    }

    return DiscourseResult(
        indirect_speech=round(indirect, 4),
        cohesion_complexity=round(cohesion, 4),
        cultural_ref_density=round(cultural, 4),
        composite_score=round(composite, 4),
        raw=raw,
    )
