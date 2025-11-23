"""
Hybrid CEFR Difficulty Classifier - OPTIMIZED FOR SPEED

This classifier assigns CEFR levels (A1-C2) to English words using a hybrid approach:
1. CEFR Wordlists (Oxford 3000/5000, EFLLex, EVP)
2. Frequency-Based Backoff (wordfreq library)
3. Embedding-Based Classifier (DISABLED BY DEFAULT for speed)
4. Lemmatization (spaCy)

CRITICAL OPTIMIZATIONS:
- Aggressive lemma-level caching (process each lemma only once)
- Token filtering BEFORE any NLP work
- Deduplication before classification
- Batch processing with nlp.pipe()
- NO logging inside loops
- NO POS tagging (disabled for maximum speed)
- Embedding classifier DISABLED by default (20-100ms per word!)
"""

import logging
from typing import Dict, List, Optional, Tuple, Set
from dataclasses import dataclass
from enum import Enum
import json
import spacy
from pathlib import Path
import re

logger = logging.getLogger(__name__)


class CEFRLevel(str, Enum):
    """CEFR proficiency levels"""
    A1 = "A1"
    A2 = "A2"
    B1 = "B1"
    B2 = "B2"
    C1 = "C1"
    C2 = "C2"
    UNKNOWN = "UNKNOWN"


class ClassificationSource(str, Enum):
    """Source of CEFR classification"""
    OXFORD_3000 = "oxford_3000"
    OXFORD_5000 = "oxford_5000"
    EFLLEX = "efllex"
    EVP = "evp"
    FREQUENCY_BACKOFF = "frequency_backoff"
    EMBEDDING_CLASSIFIER = "embedding_classifier"
    FALLBACK = "fallback"


@dataclass
class WordClassification:
    """Result of classifying a single word"""
    word: str
    lemma: str
    pos: str  # Kept for API compatibility but always empty
    cefr_level: CEFRLevel
    confidence: float  # 0.0 to 1.0
    source: ClassificationSource
    frequency_rank: Optional[int] = None
    is_multi_word: bool = False
    alternatives: Optional[List[Tuple[CEFRLevel, float]]] = None


def is_valid_token(token: str) -> bool:
    """
    STRICT token filtering - applied BEFORE any NLP processing.

    Filters out:
    - Empty/whitespace tokens
    - Tokens < 2 characters
    - Pure numbers
    - Pure punctuation
    - Unicode artifacts
    - PDF garbage tokens
    """
    if not token:
        return False

    token = token.strip()

    if len(token) < 2:
        return False

    # Must contain at least one letter
    if not any(c.isalpha() for c in token):
        return False

    # Skip pure numbers
    if token.isdigit():
        return False

    # Skip tokens that are mostly punctuation
    punct_count = sum(1 for c in token if c in ".,!?;:-–—()[]{}\"'")
    if punct_count > len(token) // 2:
        return False

    # Skip weird unicode/PDF artifacts
    if any(ord(c) > 127 for c in token):
        # Allow common accented characters but block weird unicode
        if not all(ord(c) < 256 or c in "''""" for c in token):
            return False

    return True


class HybridCEFRClassifier:
    """
    OPTIMIZED CEFR classifier with aggressive caching and NO POS tagging
    """

    def __init__(
        self,
        data_dir: Path,
        use_embedding_classifier: bool = False,  # DISABLED BY DEFAULT
        spacy_model: str = "en_core_web_sm"
    ):
        """
        Initialize the hybrid classifier

        Args:
            data_dir: Directory containing CEFR wordlists and models
            use_embedding_classifier: Whether to use embedding-based fallback (SLOW!)
            spacy_model: spaCy model name for lemmatization
        """
        self.data_dir = Path(data_dir)
        self.use_embedding_classifier = use_embedding_classifier

        # Load spaCy in LIGHTWEIGHT mode (disable ALL expensive components including POS tagger)
        logger.info(f"Loading spaCy model: {spacy_model} (lightweight mode, no POS)")
        self.nlp = spacy.load(
            spacy_model,
            disable=["ner", "parser", "attribute_ruler", "tagger"]
        )

        # OPTIMIZATION: Caches for lemmatization and classification
        self._lemma_cache: Dict[str, str] = {}  # word -> lemma (no POS!)
        self._cefr_cache: Dict[str, WordClassification] = {}  # lemma -> classification
        self._frequency_cache: Dict[str, Optional[int]] = {}

        # CEFR wordlist dictionary: {lemma: (level, source)}
        self.cefr_wordlist: Dict[str, Tuple[CEFRLevel, ClassificationSource]] = {}

        # Multi-word expressions: {"look after": (level, source)}
        self.multi_word_expressions: Dict[str, Tuple[CEFRLevel, ClassificationSource]] = {}

        # Frequency rank thresholds for CEFR mapping
        self.frequency_thresholds = {
            CEFRLevel.A1: (0, 1000),
            CEFRLevel.A2: (1000, 2000),
            CEFRLevel.B1: (2000, 5000),
            CEFRLevel.B2: (5000, 10000),
            CEFRLevel.C1: (10000, 20000),
            CEFRLevel.C2: (20000, float('inf'))
        }

        # Initialize components
        self._load_cefr_wordlists()
        self._load_frequency_data()

        if self.use_embedding_classifier:
            logger.warning("Embedding classifier enabled - this will slow down classification significantly!")
            self._load_embedding_classifier()

    def _load_cefr_wordlists(self):
        """Load and merge all CEFR wordlists"""
        logger.info("Loading CEFR wordlists...")

        # Load Oxford 3000/5000
        oxford_path = self.data_dir / "oxford_3000_5000.json"
        if oxford_path.exists():
            self._load_oxford_wordlist(oxford_path)

        # Load EFLLex dataset
        efllex_path = self.data_dir / "efllex.json"
        if efllex_path.exists():
            self._load_efllex_wordlist(efllex_path)

        # Load EVP (English Vocabulary Profile)
        evp_path = self.data_dir / "evp.json"
        if evp_path.exists():
            self._load_evp_wordlist(evp_path)

        logger.info(f"Loaded {len(self.cefr_wordlist)} CEFR entries, {len(self.multi_word_expressions)} MWEs")

    def _load_oxford_wordlist(self, path: Path):
        """Load Oxford 3000/5000 wordlist"""
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

                # Lemmatize the word
                lemma = self._get_lemma_simple(word)

                # Add to main wordlist
                if lemma not in self.cefr_wordlist:
                    self.cefr_wordlist[lemma] = (cefr_level, ClassificationSource.OXFORD_3000)

                # Check for multi-word expressions
                if ' ' in word:
                    self.multi_word_expressions[word] = (cefr_level, ClassificationSource.OXFORD_3000)

        except Exception as e:
            logger.error(f"Error loading Oxford wordlist: {e}")

    def _load_efllex_wordlist(self, path: Path):
        """Load EFLLex CEFR dataset"""
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

                # Only add if not already present (Oxford takes priority)
                if lemma not in self.cefr_wordlist:
                    self.cefr_wordlist[lemma] = (cefr_level, ClassificationSource.EFLLEX)

        except Exception as e:
            logger.error(f"Error loading EFLLex wordlist: {e}")

    def _load_evp_wordlist(self, path: Path):
        """Load English Vocabulary Profile data"""
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

                # Only add if not already present
                if lemma not in self.cefr_wordlist:
                    self.cefr_wordlist[lemma] = (cefr_level, ClassificationSource.EVP)

        except Exception as e:
            logger.error(f"Error loading EVP wordlist: {e}")

    def _load_frequency_data(self):
        """Load frequency data for backoff classification"""
        try:
            import wordfreq
            self.has_wordfreq = True
            logger.info("wordfreq library available")
        except ImportError:
            logger.warning("wordfreq library not available")
            self.has_wordfreq = False

    def _load_embedding_classifier(self):
        """Load embedding-based classifier for rare words (SLOW!)"""
        logger.warning("Loading embedding classifier (this will slow down classification)...")
        try:
            from sentence_transformers import SentenceTransformer
            import joblib

            # Load sentence transformer model
            model_path = self.data_dir / "sentence_transformer"
            if model_path.exists():
                self.sentence_model = SentenceTransformer(str(model_path))
            else:
                # Download and cache all-MiniLM-L6-v2 (small, fast, accurate)
                self.sentence_model = SentenceTransformer('all-MiniLM-L6-v2')
                self.sentence_model.save(str(model_path))

            # Load trained classifier
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
        """
        OPTIMIZED text normalization

        - Lowercase
        - Fix curly quotes/apostrophes
        - Remove extra punctuation
        - Collapse whitespace
        """
        text = text.lower()
        text = text.replace("'", "'").replace("'", "'")
        text = text.replace(""", '"').replace(""", '"')
        text = re.sub(r'[—–−]', ' ', text)
        text = re.sub(r"[^\w\s']", ' ', text)
        text = re.sub(r'\s+', ' ', text).strip()
        return text

    def _get_lemma_simple(self, word: str) -> str:
        """Simple lemmatization for wordlist loading (single word, no POS)"""
        doc = self.nlp(word.lower())
        if len(doc) > 0:
            return doc[0].lemma_
        return word.lower()

    def _get_frequency_rank(self, word: str, lang: str = 'en') -> Optional[int]:
        """Get frequency rank of a word using wordfreq (CACHED)"""
        if not self.has_wordfreq:
            return None

        # Check cache first
        if word in self._frequency_cache:
            return self._frequency_cache[word]

        try:
            import wordfreq
            zipf = wordfreq.zipf_frequency(word, lang)

            if zipf >= 6:
                rank = int(10 ** (7 - zipf))
            elif zipf >= 3:
                rank = int(10 ** (7 - zipf))
            else:
                rank = 100000

            self._frequency_cache[word] = rank
            return rank

        except Exception:
            self._frequency_cache[word] = None
            return None

    def _classify_by_frequency(self, word: str, lemma: str) -> Optional[WordClassification]:
        """Classify word based on frequency rank"""
        rank = self._get_frequency_rank(lemma)

        if rank is None:
            return None

        # Map frequency rank to CEFR level
        for level, (min_rank, max_rank) in self.frequency_thresholds.items():
            if min_rank <= rank < max_rank:
                # Confidence decreases with rank
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
        """Classify word using embedding-based classifier (SLOW - avoid if possible!)"""
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
        """
        Classify a single word with CEFR level (CACHED)

        This uses lemma-level caching so each unique lemma is classified only once.

        Args:
            word: Word to classify
            pos: Ignored (kept for API compatibility)
        """
        word_lower = word.lower().strip()

        # Check if we've already classified this lemma
        if word_lower in self._cefr_cache:
            return self._cefr_cache[word_lower]

        lemma = word_lower

        # Get lemma from cache or compute it
        if word_lower in self._lemma_cache:
            lemma = self._lemma_cache[word_lower]
        else:
            # Compute lemma (only happens once per unique word)
            doc = self.nlp(word_lower)
            if len(doc) > 0:
                lemma = doc[0].lemma_
                self._lemma_cache[word_lower] = lemma
            else:
                self._lemma_cache[word_lower] = word_lower

        # Stage 1: Check multi-word expressions
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
            self._cefr_cache[word_lower] = result
            return result

        # Stage 2: Check main CEFR wordlist
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
            self._cefr_cache[word_lower] = result
            return result

        # Stage 3: Frequency-based backoff
        freq_result = self._classify_by_frequency(word_lower, lemma)
        if freq_result and freq_result.confidence >= 0.5:
            self._cefr_cache[word_lower] = freq_result
            return freq_result

        # Stage 4: Embedding-based classifier (DISABLED BY DEFAULT)
        if self.use_embedding_classifier:
            emb_result = self._classify_by_embedding(word_lower, lemma)
            if emb_result:
                self._cefr_cache[word_lower] = emb_result
                return emb_result

        # Stage 5: Fallback - use frequency if available, else C2
        if freq_result:
            self._cefr_cache[word_lower] = freq_result
            return freq_result

        # Ultimate fallback: assume C2 (advanced/rare word)
        result = WordClassification(
            word=word,
            lemma=lemma,
            pos="",
            cefr_level=CEFRLevel.C2,
            confidence=0.2,
            source=ClassificationSource.FALLBACK
        )
        self._cefr_cache[word_lower] = result
        return result

    def classify_text(self, text: str) -> List[WordClassification]:
        """
        Classify all words in a text - HEAVILY OPTIMIZED

        CRITICAL OPTIMIZATIONS:
        1. Normalize text first
        2. Filter valid tokens BEFORE any NLP work
        3. Deduplicate to unique words
        4. Batch lemmatization with nlp.pipe() (NO POS tagging!)
        5. Classify unique lemmas only (not every token!)
        6. Use aggressive caching
        7. NO logging inside loops

        Returns:
            List of WordClassification objects (one per unique lemma)
        """
        import time
        start_time = time.time()

        # Step 1: Normalize text (lowercase, fix punctuation, collapse whitespace)
        normalized_text = self.normalize_text(text)

        # Step 2: Split and filter valid tokens BEFORE spaCy
        words = normalized_text.split()
        valid_words = [w for w in words if is_valid_token(w)]

        # Deduplicate to unique words
        unique_words = list(set(valid_words))

        if logger.isEnabledFor(logging.DEBUG):
            logger.debug(f"Filtered {len(words)} tokens → {len(valid_words)} valid → {len(unique_words)} unique")

        # Step 3: Batch lemmatization with nlp.pipe() (NO POS tagging!)
        docs = list(self.nlp.pipe(
            unique_words,
            batch_size=1000,
            n_process=1
        ))

        # Build lemma → word mapping
        lemma_to_word: Dict[str, str] = {}

        for doc in docs:
            if len(doc) > 0:
                token = doc[0]
                word = token.text
                lemma = token.lemma_

                # Cache lemma result
                self._lemma_cache[word] = lemma

                if lemma not in lemma_to_word:
                    lemma_to_word[lemma] = word

        # Step 4: Classify unique lemmas only (MASSIVE speedup)
        classifications = []
        for lemma, original_word in lemma_to_word.items():
            classification = self.classify_word(original_word)
            classifications.append(classification)

        elapsed = time.time() - start_time
        logger.info(f"Classified {len(unique_words)} unique words → {len(classifications)} lemmas in {elapsed:.2f}s")

        return classifications

    def get_statistics(self, classifications: List[WordClassification]) -> Dict:
        """
        Get statistics about classifications

        Args:
            classifications: List of WordClassification objects

        Returns:
            Dictionary with statistics
        """
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
        """
        Update frequency rank thresholds for CEFR mapping

        Args:
            thresholds: Dictionary mapping CEFR levels to (min_rank, max_rank) tuples
        """
        self.frequency_thresholds.update(thresholds)
        logger.info(f"Updated frequency thresholds")
