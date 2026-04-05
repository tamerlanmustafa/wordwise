"""
Cognitive load and predictability analysis.

Signals:
  1. Word sequence surprisal — how predictable word sequences are (bigram entropy)
  2. Topic shift frequency — how often the conversation changes subject

All scores normalized to 0.0–1.0.
"""

from dataclasses import dataclass
from typing import Optional
from collections import Counter
import math
import re
import logging

logger = logging.getLogger(__name__)


@dataclass
class CognitiveResult:
    """Results from cognitive load analysis."""
    surprisal: float          # 0.0–1.0: average word predictability
    topic_shifts: float       # 0.0–1.0: frequency of topic changes
    composite_score: float    # 0.0–1.0: weighted combination
    raw: dict


def _compute_surprisal(text: str) -> tuple:
    """
    Compute average bigram surprisal (how unpredictable word sequences are).

    Uses self-referential bigram probabilities as an approximation.
    High surprisal = less predictable = harder to process.
    """
    words = re.findall(r'\b[a-z]{2,}\b', text.lower())
    if len(words) < 100:
        return 0.3, {"note": "too few words for reliable surprisal"}

    # Count unigrams and bigrams
    unigram_counts = Counter(words)
    bigrams = [(words[i], words[i + 1]) for i in range(len(words) - 1)]
    bigram_counts = Counter(bigrams)

    total_words = len(words)

    # Compute surprisal for each bigram: -log2(P(w2|w1))
    # P(w2|w1) = count(w1,w2) / count(w1)
    surprisal_values = []
    for (w1, w2), count in bigram_counts.items():
        p_w2_given_w1 = count / unigram_counts[w1]
        surprisal = -math.log2(p_w2_given_w1)
        # Weight by frequency
        surprisal_values.extend([surprisal] * count)

    if not surprisal_values:
        return 0.3, {"note": "no bigrams found"}

    avg_surprisal = sum(surprisal_values) / len(surprisal_values)

    # Normalize: surprisal 4.0 bits (predictable) = 0.0, 10.0+ bits (unpredictable) = 1.0
    score = max(0.0, min((avg_surprisal - 4.0) / 6.0, 1.0))

    raw = {
        "avg_surprisal_bits": round(avg_surprisal, 3),
        "total_words": total_words,
        "unique_bigrams": len(bigram_counts),
    }
    return score, raw


def _compute_topic_shifts(text: str, window_size: int = 5) -> tuple:
    """
    Detect topic shifts by measuring content word overlap between consecutive windows.

    Low overlap between adjacent sentence windows = topic shift.
    """
    # Split into sentences
    sentences = [s.strip() for s in re.split(r'[.!?]+', text) if s.strip()]
    if len(sentences) < window_size * 2:
        return 0.2, {"note": "too few sentences for topic shift analysis"}

    # Common function words to exclude
    stop_words = {
        "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
        "have", "has", "had", "do", "does", "did", "will", "would", "could",
        "should", "may", "might", "can", "shall", "must",
        "i", "you", "he", "she", "it", "we", "they", "me", "him", "her",
        "us", "them", "my", "your", "his", "its", "our", "their",
        "this", "that", "these", "those", "who", "what", "which", "whom",
        "in", "on", "at", "to", "for", "with", "from", "by", "of", "about",
        "not", "no", "but", "and", "or", "if", "so", "as", "up", "out",
        "just", "than", "very", "too", "also", "how", "when", "where", "why",
        "all", "each", "every", "both", "few", "more", "most", "some", "any",
        "get", "got", "go", "went", "come", "came", "make", "made", "take",
        "took", "say", "said", "know", "knew", "think", "see", "want", "look",
    }

    def get_content_words(sentence_group):
        words = set()
        for sent in sentence_group:
            tokens = re.findall(r'\b[a-z]{3,}\b', sent.lower())
            words.update(t for t in tokens if t not in stop_words)
        return words

    # Create windows
    windows = []
    for i in range(0, len(sentences) - window_size + 1, window_size):
        window = sentences[i:i + window_size]
        windows.append(get_content_words(window))

    if len(windows) < 2:
        return 0.2, {"note": "only one window"}

    # Compute overlap between consecutive windows
    shift_count = 0
    total_transitions = len(windows) - 1
    overlaps = []

    for i in range(total_transitions):
        w1 = windows[i]
        w2 = windows[i + 1]
        union = w1 | w2
        if union:
            overlap = len(w1 & w2) / len(union)
        else:
            overlap = 0
        overlaps.append(overlap)
        if overlap < 0.10:  # Low overlap = topic shift
            shift_count += 1

    shift_ratio = shift_count / total_transitions if total_transitions > 0 else 0
    avg_overlap = sum(overlaps) / len(overlaps) if overlaps else 0.5

    # Normalize: 10% shifts = 0.0, 40%+ shifts = 1.0
    score = max(0.0, min((shift_ratio - 0.10) / 0.30, 1.0))

    raw = {
        "total_windows": len(windows),
        "total_transitions": total_transitions,
        "shift_count": shift_count,
        "shift_ratio": round(shift_ratio, 4),
        "avg_overlap": round(avg_overlap, 4),
        "window_size": window_size,
    }
    return score, raw


def analyze_cognitive_load(text: Optional[str] = None) -> CognitiveResult:
    """
    Analyze cognitive load / predictability of text.

    Args:
        text: Raw text to analyze.
    """
    if not text or len(text.strip()) < 50:
        return CognitiveResult(
            surprisal=0.3, topic_shifts=0.2,
            composite_score=0.26, raw={}
        )

    # 1. Surprisal
    surprisal, surprisal_raw = _compute_surprisal(text)

    # 2. Topic shifts
    topic_shifts, topic_raw = _compute_topic_shifts(text)

    composite = (
        0.60 * surprisal +
        0.40 * topic_shifts
    )

    raw = {
        "surprisal": surprisal_raw,
        "topic_shifts": topic_raw,
    }

    return CognitiveResult(
        surprisal=round(surprisal, 4),
        topic_shifts=round(topic_shifts, 4),
        composite_score=round(composite, 4),
        raw=raw,
    )
