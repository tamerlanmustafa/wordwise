from typing import List, Dict, Tuple
from collections import Counter
import wordfreq
from nltk.tokenize import word_tokenize
from nltk.corpus import stopwords
from nltk.stem import WordNetLemmatizer
from nltk import pos_tag

try:
    nltk.data.find('tokenizers/punkt')
except LookupError:
    import nltk
    nltk.download('punkt')

try:
    nltk.data.find('corpora/stopwords')
except LookupError:
    import nltk
    nltk.download('stopwords')

try:
    nltk.data.find('corpora/wordnet')
except LookupError:
    import nltk
    nltk.download('wordnet')

try:
    nltk.data.find('taggers/averaged_perceptron_tagger')
except LookupError:
    import nltk
    nltk.download('averaged_perceptron_tagger')


class WordAnalyzer:
    """Analyze words for frequency and difficulty"""
    
    def __init__(self):
        self.stop_words = set(stopwords.words('english'))
        self.lemmatizer = WordNetLemmatizer()
    
    def tokenize(self, text: str) -> List[str]:
        """Tokenize text into words"""
        tokens = word_tokenize(text.lower())
        # Remove stop words and non-alphabetic tokens
        tokens = [token for token in tokens if token.isalpha() and token not in self.stop_words]
        return tokens
    
    def lemmatize(self, word: str) -> str:
        """Lemmatize a word to its base form"""
        return self.lemmatizer.lemmatize(word)
    
    def get_word_frequency(self, word: str, language: str = 'en') -> float:
        """Get word frequency using wordfreq library"""
        try:
            freq = wordfreq.word_frequency(word, language)
            return freq
        except:
            return 0.0
    
    def analyze_text(self, text: str) -> Dict[str, any]:
        """Analyze text and return word statistics"""
        tokens = self.tokenize(text)
        
        # Count word frequencies
        word_counts = Counter(tokens)
        total_words = len(tokens)
        unique_words = len(word_counts)
        
        # Get frequency data for each word
        word_frequencies = {}
        for word, count in word_counts.items():
            freq = self.get_word_frequency(word)
            word_frequencies[word] = {
                'count': count,
                'frequency': freq,
                'percentage': (count / total_words) * 100
            }
        
        return {
            'total_words': total_words,
            'unique_words': unique_words,
            'word_frequencies': word_frequencies
        }
    
    def classify_difficulty(self, word: str) -> str:
        """Classify word difficulty based on frequency"""
        freq = self.get_word_frequency(word)
        
        if freq >= 0.01:  # Very common words
            return "A1"
        elif freq >= 0.001:  # Common words
            return "A2"
        elif freq >= 0.0001:  # Less common words
            return "B1"
        elif freq >= 0.00001:  # Uncommon words
            return "B2"
        elif freq >= 0.000001:  # Rare words
            return "C1"
        else:  # Very rare words
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
        # Sort by frequency (ascending) and take first n
        sorted_words = sorted(word_counts.items(), key=lambda x: x[1])
        return sorted_words[:n]


