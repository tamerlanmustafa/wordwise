"""
Word Analyzer - OPTIMIZED FOR SPEED

Lightweight word analysis with aggressive caching and minimal dependencies.
This module is deprecated in favor of the CEFR classifier but kept for compatibility.
NO POS tagging for maximum speed.
"""

from typing import List, Dict, Tuple
from collections import Counter
import re

# Lazy import NLTK components only when needed
_WORDFREQ_AVAILABLE = None
_LEMMATIZER = None
_STOP_WORDS = None


def _ensure_wordfreq():
    """Lazy load wordfreq library"""
    global _WORDFREQ_AVAILABLE
    if _WORDFREQ_AVAILABLE is None:
        try:
            import wordfreq
            _WORDFREQ_AVAILABLE = True
        except ImportError:
            _WORDFREQ_AVAILABLE = False
    return _WORDFREQ_AVAILABLE


def _ensure_nltk():
    """Lazy load NLTK components"""
    global _LEMMATIZER, _STOP_WORDS

    if _LEMMATIZER is None or _STOP_WORDS is None:
        import nltk
        from nltk.stem import WordNetLemmatizer
        from nltk.corpus import stopwords

        # Download required data if missing
        try:
            nltk.data.find('tokenizers/punkt')
        except LookupError:
            nltk.download('punkt', quiet=True)

        try:
            nltk.data.find('corpora/stopwords')
        except LookupError:
            nltk.download('stopwords', quiet=True)

        try:
            nltk.data.find('corpora/wordnet')
        except LookupError:
            nltk.download('wordnet', quiet=True)

        _LEMMATIZER = WordNetLemmatizer()
        _STOP_WORDS = set(stopwords.words('english'))


class WordAnalyzer:
    """
    OPTIMIZED word analyzer with caching and minimal processing
    NO POS tagging for maximum speed

    NOTE: This class is largely deprecated. Use HybridCEFRClassifier instead.
    """

    def __init__(self):
        """Initialize analyzer with lazy-loaded components"""
        # Lazy load components only when needed
        self._frequency_cache: Dict[str, float] = {}
        self._lemma_cache: Dict[str, str] = {}

    @property
    def stop_words(self):
        """Lazy-loaded stop words"""
        _ensure_nltk()
        return _STOP_WORDS

    @property
    def lemmatizer(self):
        """Lazy-loaded lemmatizer"""
        _ensure_nltk()
        return _LEMMATIZER

    def tokenize(self, text: str) -> List[str]:
        """
        Fast tokenization with filtering

        OPTIMIZED: Uses regex instead of NLTK word_tokenize for speed
        """
        # Lowercase and extract words
        text = text.lower()

        # Extract alphanumeric tokens (fast regex)
        tokens = re.findall(r'\b[a-z]+\b', text)

        # Filter out stop words and short tokens
        tokens = [
            token for token in tokens
            if len(token) > 2 and token not in self.stop_words
        ]

        return tokens

    def lemmatize(self, word: str) -> str:
        """
        Lemmatize a word to its base form (CACHED, no POS)
        """
        if word in self._lemma_cache:
            return self._lemma_cache[word]

        lemma = self.lemmatizer.lemmatize(word)
        self._lemma_cache[word] = lemma
        return lemma

    def get_word_frequency(self, word: str, language: str = 'en') -> float:
        """
        Get word frequency using wordfreq library (CACHED)
        """
        if not _ensure_wordfreq():
            return 0.0

        # Check cache
        if word in self._frequency_cache:
            return self._frequency_cache[word]

        try:
            import wordfreq
            freq = wordfreq.word_frequency(word, language)
            self._frequency_cache[word] = freq
            return freq
        except Exception:
            self._frequency_cache[word] = 0.0
            return 0.0

    def analyze_text(self, text: str) -> Dict[str, any]:
        """
        Analyze text and return word statistics (OPTIMIZED)

        NOTE: This is a legacy method. Use CEFR classifier for better results.
        """
        tokens = self.tokenize(text)

        # Count word frequencies
        word_counts = Counter(tokens)
        total_words = len(tokens)
        unique_words = len(word_counts)

        # Get frequency data for unique words only (avoid repeated lookups)
        word_frequencies = {}
        for word, count in word_counts.items():
            freq = self.get_word_frequency(word)
            word_frequencies[word] = {
                'count': count,
                'frequency': freq,
                'percentage': (count / total_words) * 100 if total_words > 0 else 0
            }

        return {
            'total_words': total_words,
            'unique_words': unique_words,
            'word_frequencies': word_frequencies
        }

    def classify_difficulty(self, word: str) -> str:
        """
        Classify word difficulty based on frequency

        NOTE: This is a simplified version. Use HybridCEFRClassifier for accurate CEFR levels.
        """
        freq = self.get_word_frequency(word)

        if freq >= 0.01:
            return "A1"
        elif freq >= 0.001:
            return "A2"
        elif freq >= 0.0001:
            return "B1"
        elif freq >= 0.00001:
            return "B2"
        elif freq >= 0.000001:
            return "C1"
        else:
            return "C2"

    def get_most_common_words(self, text: str, n: int = 50) -> List[Tuple[str, int]]:
        """Get n most common words from text"""
        tokens = self.tokenize(text)
        word_counts = Counter(tokens)
        return word_counts.most_common(n)

    def get_least_common_words(self, text: str, n: int = 50) -> List[Tuple[str, int]]:
        """Get n least common words from text"""
        tokens = self.tokenize(text)
        word_counts = Counter(tokens)
        sorted_words = sorted(word_counts.items(), key=lambda x: x[1])
        return sorted_words[:n]
