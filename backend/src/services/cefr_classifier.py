"""
Hybrid CEFR Difficulty Classifier - MAXIMUM SPEED OPTIMIZATION

NO spaCy - uses NLTK WordNetLemmatizer for maximum speed
Global persistent caching across all requests
Aggressive pre-cleaning before tokenization
POS-aware lemmatization using lightweight dictionary
"""

import logging
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
from enum import Enum
import json
from pathlib import Path
import re
from nltk.stem import WordNetLemmatizer
from nltk.corpus import wordnet
import nltk

logger = logging.getLogger(__name__)

# Download NLTK data if needed
try:
    nltk.data.find('corpora/wordnet')
except LookupError:
    nltk.download('wordnet', quiet=True)

try:
    nltk.data.find('corpora/omw-1.4')
except LookupError:
    nltk.download('omw-1.4', quiet=True)

# GLOBAL PERSISTENT CACHES (shared across all requests)
_GLOBAL_LEMMA_CACHE: Dict[str, str] = {}
_GLOBAL_CEFR_CACHE: Dict[str, 'WordClassification'] = {}
_GLOBAL_FREQUENCY_CACHE: Dict[str, Optional[int]] = {}

# Load POS dictionary once at module level
_POS_DICT: Optional[Dict[str, str]] = None

def _load_pos_dictionary() -> Dict[str, str]:
    """Load POS dictionary once on first access"""
    global _POS_DICT
    if _POS_DICT is None:
        try:
            from ..data.pos_dictionary import POS_DICTIONARY
            _POS_DICT = POS_DICTIONARY
            logger.info(f"Loaded POS dictionary with {len(_POS_DICT)} entries")
        except Exception as e:
            logger.warning(f"Failed to load POS dictionary: {e}")
            _POS_DICT = {}
    return _POS_DICT


class CEFRLevel(str, Enum):
    A1 = "A1"
    A2 = "A2"
    B1 = "B1"
    B2 = "B2"
    C1 = "C1"
    C2 = "C2"
    UNKNOWN = "UNKNOWN"


class ClassificationSource(str, Enum):
    OXFORD_3000 = "oxford_3000"
    OXFORD_5000 = "oxford_5000"
    EFLLEX = "efllex"
    EVP = "evp"
    FREQUENCY_BACKOFF = "frequency_backoff"
    EMBEDDING_CLASSIFIER = "embedding_classifier"
    FALLBACK = "fallback"


@dataclass
class WordClassification:
    word: str
    lemma: str
    pos: str
    cefr_level: CEFRLevel
    confidence: float
    source: ClassificationSource
    frequency_rank: Optional[int] = None
    is_multi_word: bool = False
    alternatives: Optional[List[Tuple[CEFRLevel, float]]] = None


def is_valid_token(token: str) -> bool:
    if not token or len(token) < 2:
        return False
    if not any(c.isalpha() for c in token):
        return False
    if token.isdigit():
        return False
    punct_count = sum(1 for c in token if c in ".,!?;:-–—()[]{}\"'")
    if punct_count > len(token) // 2:
        return False
    if any(ord(c) > 127 for c in token):
        if not all(ord(c) < 256 or c in "''""" for c in token):
            return False
    return True


class HybridCEFRClassifier:
    def __init__(
        self,
        data_dir: Path,
        use_embedding_classifier: bool = False,
        spacy_model: str = "en_core_web_sm"
    ):
        self.data_dir = Path(data_dir)
        self.use_embedding_classifier = use_embedding_classifier

        logger.info("Initializing NLTK lemmatizer (no spaCy)")
        self.lemmatizer = WordNetLemmatizer()

        self.cefr_wordlist: Dict[str, Tuple[CEFRLevel, ClassificationSource]] = {}
        self.multi_word_expressions: Dict[str, Tuple[CEFRLevel, ClassificationSource]] = {}
        self.frequency_thresholds = {
            CEFRLevel.A1: (0, 1000),
            CEFRLevel.A2: (1000, 2000),
            CEFRLevel.B1: (2000, 5000),
            CEFRLevel.B2: (5000, 10000),
            CEFRLevel.C1: (10000, 20000),
            CEFRLevel.C2: (20000, float('inf'))
        }

        self._load_cefr_wordlists()
        self._load_frequency_data()

        if self.use_embedding_classifier:
            logger.warning("Embedding classifier enabled - will slow down classification!")
            self._load_embedding_classifier()

    def _load_cefr_wordlists(self):
        logger.info("Loading CEFR wordlists...")
        oxford_path = self.data_dir / "oxford_3000_5000.json"
        if oxford_path.exists():
            self._load_oxford_wordlist(oxford_path)
        efllex_path = self.data_dir / "efllex.json"
        if efllex_path.exists():
            self._load_efllex_wordlist(efllex_path)
        evp_path = self.data_dir / "evp.json"
        if evp_path.exists():
            self._load_evp_wordlist(evp_path)
        logger.info(f"Loaded {len(self.cefr_wordlist)} CEFR entries, {len(self.multi_word_expressions)} MWEs")

    def _load_oxford_wordlist(self, path: Path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            for entry in data:
                word = entry.get('word', '').lower().strip()
                level = entry.get('cefr_level', '').upper()
                if not word or not level:
                    continue
                try:
                    cefr_level = CEFRLevel(level)
                except ValueError:
                    continue
                lemma = self._get_lemma_simple(word)
                if lemma not in self.cefr_wordlist:
                    self.cefr_wordlist[lemma] = (cefr_level, ClassificationSource.OXFORD_3000)
                if ' ' in word:
                    self.multi_word_expressions[word] = (cefr_level, ClassificationSource.OXFORD_3000)
        except Exception as e:
            logger.error(f"Error loading Oxford wordlist: {e}")

    def _load_efllex_wordlist(self, path: Path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            for entry in data:
                word = entry.get('word', '').lower().strip()
                level = entry.get('cefr', '').upper()
                if not word or not level:
                    continue
                try:
                    cefr_level = CEFRLevel(level)
                except ValueError:
                    continue
                lemma = self._get_lemma_simple(word)
                if lemma not in self.cefr_wordlist:
                    self.cefr_wordlist[lemma] = (cefr_level, ClassificationSource.EFLLEX)
        except Exception as e:
            logger.error(f"Error loading EFLLex wordlist: {e}")

    def _load_evp_wordlist(self, path: Path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            for entry in data:
                word = entry.get('word', '').lower().strip()
                level = entry.get('level', '').upper()
                if not word or not level:
                    continue
                try:
                    cefr_level = CEFRLevel(level)
                except ValueError:
                    continue
                lemma = self._get_lemma_simple(word)
                if lemma not in self.cefr_wordlist:
                    self.cefr_wordlist[lemma] = (cefr_level, ClassificationSource.EVP)
        except Exception as e:
            logger.error(f"Error loading EVP wordlist: {e}")

    def _load_frequency_data(self):
        try:
            import wordfreq
            self.has_wordfreq = True
            logger.info("wordfreq library available")
        except ImportError:
            logger.warning("wordfreq library not available")
            self.has_wordfreq = False

    def _load_embedding_classifier(self):
        logger.warning("Loading embedding classifier...")
        try:
            from sentence_transformers import SentenceTransformer
            import joblib
            model_path = self.data_dir / "sentence_transformer"
            if model_path.exists():
                self.sentence_model = SentenceTransformer(str(model_path))
            else:
                self.sentence_model = SentenceTransformer('all-MiniLM-L6-v2')
                self.sentence_model.save(str(model_path))
            classifier_path = self.data_dir / "cefr_classifier.joblib"
            if classifier_path.exists():
                self.embedding_classifier = joblib.load(classifier_path)
                logger.info("Loaded pre-trained embedding classifier")
            else:
                logger.warning("No pre-trained classifier found")
                self.embedding_classifier = None
            self.has_embedding_classifier = True
        except ImportError as e:
            logger.warning(f"Embedding classifier dependencies not available: {e}")
            self.has_embedding_classifier = False

    @staticmethod
    def normalize_text(text: str) -> str:
        text = text.lower()
        text = text.replace("'", "'").replace("'", "'")
        text = text.replace(""", '"').replace(""", '"')
        text = re.sub(r'[—–−]', ' ', text)
        text = re.sub(r"[^\w\s']", ' ', text)
        text = re.sub(r'\s+', ' ', text).strip()
        return text

    @staticmethod
    def aggressive_preclean(text: str) -> str:
        text = text.lower()
        # Normalize smart quotes to standard apostrophe
        text = text.replace("'", "'").replace("'", "'")
        text = text.replace(""", '"').replace(""", '"')
        # Remove punctuation EXCEPT apostrophes within words
        text = re.sub(r"[^\w\s']", ' ', text)
        # Remove standalone apostrophes (not part of word)
        text = re.sub(r"\s'\s", ' ', text)
        text = re.sub(r"^\s*'\s*", '', text)
        # Remove digits
        text = re.sub(r'\d+', '', text)
        text = re.sub(r'\s+', ' ', text).strip()
        return text

    def _get_lemma_simple(self, word: str) -> str:
        """Simple lemmatization without POS (used during initialization)"""
        return self.lemmatizer.lemmatize(word.lower())

    def _get_lemma_fast(self, word: str) -> str:
        """
        Fast lemmatization with POS dictionary lookup

        Process:
        1. Check global cache
        2. Lookup word in POS dictionary
        3. If found, use appropriate POS tag for lemmatization
        4. If not found, try noun lemmatization (for plurals)
        5. Handle irregular plural nouns
        """
        global _GLOBAL_LEMMA_CACHE

        word_lower = word.lower()

        # Check cache first
        if word_lower in _GLOBAL_LEMMA_CACHE:
            return _GLOBAL_LEMMA_CACHE[word_lower]

        # Irregular plural nouns that need special handling
        irregular_plurals = {
            'children': 'child',
            'people': 'person',
            'men': 'man',
            'women': 'woman',
            'feet': 'foot',
            'teeth': 'tooth',
            'geese': 'goose',
            'mice': 'mouse',
            'oxen': 'ox',
            'sheep': 'sheep',
            'deer': 'deer',
            'fish': 'fish'
        }

        # Check irregular plurals
        if word_lower in irregular_plurals:
            lemma = irregular_plurals[word_lower]
            _GLOBAL_LEMMA_CACHE[word_lower] = lemma
            return lemma

        # Get POS dictionary
        pos_dict = _load_pos_dictionary()

        # Lookup POS tag
        pos_tag = pos_dict.get(word_lower)

        # Lemmatize with POS if available
        if pos_tag:
            # Map our simple tags to WordNet POS constants
            wordnet_pos = {
                'n': wordnet.NOUN,
                'v': wordnet.VERB,
                'a': wordnet.ADJ,
                'r': wordnet.ADV
            }.get(pos_tag, wordnet.NOUN)

            lemma = self.lemmatizer.lemmatize(word_lower, pos=wordnet_pos)
        else:
            # Fallback to noun-based lemmatization for plurals
            lemma = self.lemmatizer.lemmatize(word_lower, pos=wordnet.NOUN)

            # If lemmatization didn't change anything and word ends with 's' or 'es',
            # it might be a plural noun not in our dictionary
            if lemma == word_lower and (word_lower.endswith('s') and len(word_lower) > 2):
                # Try to remove common plural endings
                if word_lower.endswith('ies') and len(word_lower) > 4:
                    # stories -> story, cherries -> cherry
                    potential_lemma = word_lower[:-3] + 'y'
                    _GLOBAL_LEMMA_CACHE[word_lower] = potential_lemma
                    return potential_lemma
                elif word_lower.endswith('es') and len(word_lower) > 3:
                    # Check if it's a real plural (watches -> watch, boxes -> box)
                    potential_lemma = self.lemmatizer.lemmatize(word_lower[:-2], pos=wordnet.NOUN)
                    if potential_lemma != word_lower[:-2]:
                        _GLOBAL_LEMMA_CACHE[word_lower] = potential_lemma
                        return potential_lemma
                    # Try removing just 'es'
                    potential_lemma = word_lower[:-2]
                    _GLOBAL_LEMMA_CACHE[word_lower] = potential_lemma
                    return potential_lemma

        # Cache result
        _GLOBAL_LEMMA_CACHE[word_lower] = lemma
        return lemma

    def _get_frequency_rank(self, word: str, lang: str = 'en') -> Optional[int]:
        global _GLOBAL_FREQUENCY_CACHE
        if not self.has_wordfreq:
            return None
        if word in _GLOBAL_FREQUENCY_CACHE:
            return _GLOBAL_FREQUENCY_CACHE[word]
        try:
            import wordfreq
            zipf = wordfreq.zipf_frequency(word, lang)
            if zipf >= 6:
                rank = int(10 ** (7 - zipf))
            elif zipf >= 3:
                rank = int(10 ** (7 - zipf))
            else:
                rank = 100000
            _GLOBAL_FREQUENCY_CACHE[word] = rank
            return rank
        except Exception:
            _GLOBAL_FREQUENCY_CACHE[word] = None
            return None

    def _classify_by_frequency(self, word: str, lemma: str) -> Optional[WordClassification]:
        rank = self._get_frequency_rank(lemma)
        if rank is None:
            return None
        for level, (min_rank, max_rank) in self.frequency_thresholds.items():
            if min_rank <= rank < max_rank:
                if rank < 3000:
                    confidence = 0.7
                elif rank < 10000:
                    confidence = 0.5
                else:
                    confidence = 0.3
                return WordClassification(
                    word=word,
                    lemma=lemma,
                    pos="",
                    cefr_level=level,
                    confidence=confidence,
                    source=ClassificationSource.FREQUENCY_BACKOFF,
                    frequency_rank=rank
                )
        return None

    def _classify_by_embedding(self, word: str, lemma: str) -> Optional[WordClassification]:
        if not self.has_embedding_classifier or self.embedding_classifier is None:
            return None
        try:
            embedding = self.sentence_model.encode([lemma])[0]
            prediction = self.embedding_classifier.predict([embedding])[0]
            if hasattr(self.embedding_classifier, 'predict_proba'):
                probabilities = self.embedding_classifier.predict_proba([embedding])[0]
                confidence = float(max(probabilities))
            else:
                confidence = 0.4
            return WordClassification(
                word=word,
                lemma=lemma,
                pos="",
                cefr_level=CEFRLevel(prediction),
                confidence=confidence * 0.8,
                source=ClassificationSource.EMBEDDING_CLASSIFIER
            )
        except Exception:
            return None

    def classify_word(self, word: str, pos: Optional[str] = None) -> WordClassification:
        global _GLOBAL_CEFR_CACHE
        word_lower = word.lower().strip()
        if word_lower in _GLOBAL_CEFR_CACHE:
            return _GLOBAL_CEFR_CACHE[word_lower]

        lemma = self._get_lemma_fast(word_lower)

        if ' ' in word_lower and word_lower in self.multi_word_expressions:
            level, source = self.multi_word_expressions[word_lower]
            result = WordClassification(
                word=word,
                lemma=word_lower,
                pos="",
                cefr_level=level,
                confidence=1.0,
                source=source,
                is_multi_word=True
            )
            _GLOBAL_CEFR_CACHE[word_lower] = result
            return result

        if lemma in self.cefr_wordlist:
            level, source = self.cefr_wordlist[lemma]
            result = WordClassification(
                word=word,
                lemma=lemma,
                pos="",
                cefr_level=level,
                confidence=1.0,
                source=source
            )
            _GLOBAL_CEFR_CACHE[word_lower] = result
            return result

        freq_result = self._classify_by_frequency(word_lower, lemma)
        if freq_result and freq_result.confidence >= 0.5:
            _GLOBAL_CEFR_CACHE[word_lower] = freq_result
            return freq_result

        if self.use_embedding_classifier:
            emb_result = self._classify_by_embedding(word_lower, lemma)
            if emb_result:
                _GLOBAL_CEFR_CACHE[word_lower] = emb_result
                return emb_result

        if freq_result:
            _GLOBAL_CEFR_CACHE[word_lower] = freq_result
            return freq_result

        result = WordClassification(
            word=word,
            lemma=lemma,
            pos="",
            cefr_level=CEFRLevel.C2,
            confidence=0.2,
            source=ClassificationSource.FALLBACK
        )
        _GLOBAL_CEFR_CACHE[word_lower] = result
        return result

    def classify_text(self, text: str) -> List[WordClassification]:
        import time
        start_time = time.time()

        cleaned_text = self.aggressive_preclean(text)
        words = cleaned_text.split()
        valid_words = [w for w in words if is_valid_token(w)]
        unique_words = list(set(valid_words))

        if logger.isEnabledFor(logging.DEBUG):
            logger.debug(f"Filtered {len(words)} tokens → {len(valid_words)} valid → {len(unique_words)} unique")

        lemma_to_word: Dict[str, str] = {}
        for word in unique_words:
            lemma = self._get_lemma_fast(word)
            if lemma not in lemma_to_word:
                lemma_to_word[lemma] = word

        classifications = []
        for lemma, original_word in lemma_to_word.items():
            classification = self.classify_word(original_word)
            classifications.append(classification)

        elapsed = time.time() - start_time
        logger.info(f"Classified {len(unique_words)} unique words → {len(classifications)} lemmas in {elapsed:.2f}s")

        return classifications

    def get_statistics(self, classifications: List[WordClassification]) -> Dict:
        if not classifications:
            return {}
        level_counts = {level: 0 for level in CEFRLevel}
        source_counts = {source: 0 for source in ClassificationSource}
        total_confidence = 0.0
        for cls in classifications:
            level_counts[cls.cefr_level] += 1
            source_counts[cls.source] += 1
            total_confidence += cls.confidence
        return {
            'total_words': len(classifications),
            'level_distribution': {k.value: v for k, v in level_counts.items()},
            'source_distribution': {k.value: v for k, v in source_counts.items()},
            'average_confidence': total_confidence / len(classifications),
            'wordlist_coverage': sum(
                1 for cls in classifications
                if cls.source in [
                    ClassificationSource.OXFORD_3000,
                    ClassificationSource.OXFORD_5000,
                    ClassificationSource.EFLLEX,
                    ClassificationSource.EVP
                ]
            ) / len(classifications)
        }

    def update_frequency_thresholds(self, thresholds: Dict[CEFRLevel, Tuple[int, int]]):
        self.frequency_thresholds.update(thresholds)
        logger.info(f"Updated frequency thresholds")
