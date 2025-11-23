"""
Word Analyzer - MAXIMUM SPEED OPTIMIZATION

NO heavy NLP - uses regex tokenization and NLTK lemmatizer
Global persistent caching
"""

from typing import List, Dict, Tuple
from collections import Counter
import re
from nltk.stem import WordNetLemmatizer
from nltk.corpus import stopwords
import nltk

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

_WORDFREQ_AVAILABLE = None
_GLOBAL_FREQUENCY_CACHE: Dict[str, float] = {}
_GLOBAL_LEMMA_CACHE: Dict[str, str] = {}
_LEMMATIZER = None
_STOP_WORDS = None


def _ensure_wordfreq():
    global _WORDFREQ_AVAILABLE
    if _WORDFREQ_AVAILABLE is None:
        try:
            import wordfreq
            _WORDFREQ_AVAILABLE = True
        except ImportError:
            _WORDFREQ_AVAILABLE = False
    return _WORDFREQ_AVAILABLE


def _ensure_nltk():
    global _LEMMATIZER, _STOP_WORDS
    if _LEMMATIZER is None or _STOP_WORDS is None:
        _LEMMATIZER = WordNetLemmatizer()
        _STOP_WORDS = set(stopwords.words('english'))


class WordAnalyzer:
    def __init__(self):
        _ensure_nltk()

    @property
    def stop_words(self):
        _ensure_nltk()
        return _STOP_WORDS

    @property
    def lemmatizer(self):
        _ensure_nltk()
        return _LEMMATIZER

    def tokenize(self, text: str) -> List[str]:
        text = text.lower()
        tokens = re.findall(r'\b[a-z]+\b', text)
        tokens = [
            token for token in tokens
            if len(token) > 2 and token not in self.stop_words
        ]
        return tokens

    def lemmatize(self, word: str) -> str:
        global _GLOBAL_LEMMA_CACHE
        if word in _GLOBAL_LEMMA_CACHE:
            return _GLOBAL_LEMMA_CACHE[word]
        lemma = self.lemmatizer.lemmatize(word)
        _GLOBAL_LEMMA_CACHE[word] = lemma
        return lemma

    def get_word_frequency(self, word: str, language: str = 'en') -> float:
        global _GLOBAL_FREQUENCY_CACHE
        if not _ensure_wordfreq():
            return 0.0
        if word in _GLOBAL_FREQUENCY_CACHE:
            return _GLOBAL_FREQUENCY_CACHE[word]
        try:
            import wordfreq
            freq = wordfreq.word_frequency(word, language)
            _GLOBAL_FREQUENCY_CACHE[word] = freq
            return freq
        except Exception:
            _GLOBAL_FREQUENCY_CACHE[word] = 0.0
            return 0.0

    def analyze_text(self, text: str) -> Dict[str, any]:
        tokens = self.tokenize(text)
        word_counts = Counter(tokens)
        total_words = len(tokens)
        unique_words = len(word_counts)
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
        tokens = self.tokenize(text)
        word_counts = Counter(tokens)
        return word_counts.most_common(n)

    def get_least_common_words(self, text: str, n: int = 50) -> List[Tuple[str, int]]:
        tokens = self.tokenize(text)
        word_counts = Counter(tokens)
        sorted_words = sorted(word_counts.items(), key=lambda x: x[1])
        return sorted_words[:n]
