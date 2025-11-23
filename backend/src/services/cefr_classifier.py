"""
Hybrid CEFR Difficulty Classifier

This classifier assigns CEFR levels (A1-C2) to English words using a hybrid approach:
1. CEFR Wordlists (Oxford 3000/5000, EFLLex, EVP)
2. Frequency-Based Backoff (wordfreq library)
3. Embedding-Based Classifier (sentence-transformers + scikit-learn)
4. Lemmatization (spaCy)
5. POS-sensitive mapping

Runs entirely locally with no external API calls.

Performance optimizations:
- Lightweight spaCy with disabled NER/parser
- Batch processing with nlp.pipe()
- Text normalization and deduplication
- Cached wordfreq lookups
- Reduced logging overhead
"""

import logging
from typing import Dict, List, Optional, Tuple, Set
from dataclasses import dataclass
from enum import Enum
import json
import spacy
from pathlib import Path
import re
from functools import lru_cache

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
    pos: str  # Part of speech
    cefr_level: CEFRLevel
    confidence: float  # 0.0 to 1.0
    source: ClassificationSource
    frequency_rank: Optional[int] = None
    is_multi_word: bool = False
    alternatives: Optional[List[Tuple[CEFRLevel, float]]] = None  # Alternative classifications


class HybridCEFRClassifier:
    """
    Main CEFR classifier that combines multiple data sources and methods
    """

    def __init__(
        self,
        data_dir: Path,
        use_embedding_classifier: bool = True,
        spacy_model: str = "en_core_web_sm"
    ):
        """
        Initialize the hybrid classifier

        Args:
            data_dir: Directory containing CEFR wordlists and models
            use_embedding_classifier: Whether to use embedding-based fallback
            spacy_model: spaCy model name for lemmatization
        """
        self.data_dir = Path(data_dir)
        self.use_embedding_classifier = use_embedding_classifier

        # Load spaCy in LIGHTWEIGHT mode (disable expensive components)
        logger.info(f"Loading spaCy model: {spacy_model} (lightweight mode)")
        self.nlp = spacy.load(
            spacy_model,
            disable=["ner", "parser", "attribute_ruler"]
        )

        # Frequency lookup cache
        self._frequency_cache: Dict[str, Optional[int]] = {}

        # CEFR wordlist dictionary: {lemma: (level, source)}
        self.cefr_wordlist: Dict[str, Tuple[CEFRLevel, ClassificationSource]] = {}

        # Multi-word expressions: {"look after": (level, source)}
        self.multi_word_expressions: Dict[str, Tuple[CEFRLevel, ClassificationSource]] = {}

        # POS-specific mappings: {(lemma, pos): (level, source)}
        self.pos_specific: Dict[Tuple[str, str], Tuple[CEFRLevel, ClassificationSource]] = {}

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

        logger.info(f"Loaded {len(self.cefr_wordlist)} CEFR entries")
        logger.info(f"Loaded {len(self.multi_word_expressions)} multi-word expressions")
        logger.info(f"Loaded {len(self.pos_specific)} POS-specific entries")

    def _load_oxford_wordlist(self, path: Path):
        """Load Oxford 3000/5000 wordlist"""
        logger.info(f"Loading Oxford wordlist from {path}")
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            for entry in data:
                word = entry.get('word', '').lower().strip()
                level = entry.get('cefr_level', '').upper()
                pos = entry.get('pos', '')

                if not word or not level:
                    continue

                try:
                    cefr_level = CEFRLevel(level)
                except ValueError:
                    continue

                # Lemmatize the word
                lemma = self._get_lemma(word)

                # Add to main wordlist
                if lemma not in self.cefr_wordlist:
                    self.cefr_wordlist[lemma] = (cefr_level, ClassificationSource.OXFORD_3000)

                # Add POS-specific mapping if available
                if pos:
                    pos_key = (lemma, pos.lower())
                    if pos_key not in self.pos_specific:
                        self.pos_specific[pos_key] = (cefr_level, ClassificationSource.OXFORD_3000)

                # Check for multi-word expressions
                if ' ' in word:
                    self.multi_word_expressions[word] = (cefr_level, ClassificationSource.OXFORD_3000)

        except Exception as e:
            logger.error(f"Error loading Oxford wordlist: {e}")

    def _load_efllex_wordlist(self, path: Path):
        """Load EFLLex CEFR dataset"""
        logger.info(f"Loading EFLLex wordlist from {path}")
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

                lemma = self._get_lemma(word)

                # Only add if not already present (Oxford takes priority)
                if lemma not in self.cefr_wordlist:
                    self.cefr_wordlist[lemma] = (cefr_level, ClassificationSource.EFLLEX)

        except Exception as e:
            logger.error(f"Error loading EFLLex wordlist: {e}")

    def _load_evp_wordlist(self, path: Path):
        """Load English Vocabulary Profile data"""
        logger.info(f"Loading EVP wordlist from {path}")
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            for entry in data:
                word = entry.get('word', '').lower().strip()
                level = entry.get('level', '').upper()
                pos = entry.get('pos', '')

                if not word or not level:
                    continue

                try:
                    cefr_level = CEFRLevel(level)
                except ValueError:
                    continue

                lemma = self._get_lemma(word)

                # Only add if not already present
                if lemma not in self.cefr_wordlist:
                    self.cefr_wordlist[lemma] = (cefr_level, ClassificationSource.EVP)

                # Add POS-specific if available
                if pos:
                    pos_key = (lemma, pos.lower())
                    if pos_key not in self.pos_specific:
                        self.pos_specific[pos_key] = (cefr_level, ClassificationSource.EVP)

        except Exception as e:
            logger.error(f"Error loading EVP wordlist: {e}")

    def _load_frequency_data(self):
        """Load frequency data for backoff classification"""
        logger.info("Loading frequency data...")
        try:
            # We'll use the wordfreq library which has built-in frequency data
            import wordfreq
            self.has_wordfreq = True
            logger.info("wordfreq library loaded successfully")
        except ImportError:
            logger.warning("wordfreq library not available - frequency backoff disabled")
            self.has_wordfreq = False

    def _load_embedding_classifier(self):
        """Load embedding-based classifier for rare words"""
        logger.info("Loading embedding classifier...")
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
                logger.warning("No pre-trained classifier found - will train on first use")
                self.embedding_classifier = None

            self.has_embedding_classifier = True

        except ImportError as e:
            logger.warning(f"Embedding classifier dependencies not available: {e}")
            self.has_embedding_classifier = False

    @staticmethod
    def normalize_text(text: str) -> str:
        """
        Comprehensive text normalization

        - Lowercase
        - Replace curly apostrophes with straight ones
        - Strip punctuation
        - Normalize whitespace
        """
        # Lowercase
        text = text.lower()

        # Replace curly apostrophes and quotes with straight ones
        text = text.replace("'", "'").replace("'", "'")
        text = text.replace(""", '"').replace(""", '"')

        # Replace dashes with spaces
        text = re.sub(r'[—–−]', ' ', text)

        # Remove all punctuation except apostrophes (for contractions)
        text = re.sub(r"[^\w\s']", ' ', text)

        # Normalize whitespace
        text = re.sub(r'\s+', ' ', text).strip()

        return text

    @staticmethod
    def is_valid_token(token: str) -> bool:
        """
        Check if a token should be classified

        Filters out:
        - Tokens < 2 characters
        - Tokens with numbers
        - Tokens that are purely symbols
        """
        if len(token) < 2:
            return False

        # Must contain at least one letter
        if not re.search(r'[a-zA-Z]', token):
            return False

        # Skip if contains numbers
        if re.search(r'\d', token):
            return False

        return True

    def _get_lemma(self, word: str) -> str:
        """Get lemma of a word using spaCy"""
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
            # Get Zipf frequency (log10 of frequency per billion words)
            zipf = wordfreq.zipf_frequency(word, lang)

            # Convert Zipf to approximate rank
            # Zipf 6+ = very common (rank 1-100)
            # Zipf 5-6 = common (rank 100-1000)
            # Zipf 4-5 = uncommon (rank 1000-10000)
            # Zipf 3-4 = rare (rank 10000-100000)
            # Zipf <3 = very rare (rank 100000+)

            if zipf >= 6:
                rank = int(10 ** (7 - zipf))
            elif zipf >= 3:
                rank = int(10 ** (7 - zipf))
            else:
                rank = 100000

            # Cache the result
            self._frequency_cache[word] = rank
            return rank

        except Exception:
            # Cache None to avoid repeated lookups
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
        """Classify word using embedding-based classifier"""
        if not self.has_embedding_classifier or self.embedding_classifier is None:
            return None

        try:
            # Get word embedding
            embedding = self.sentence_model.encode([lemma])[0]

            # Predict CEFR level
            prediction = self.embedding_classifier.predict([embedding])[0]

            # Get probability scores
            if hasattr(self.embedding_classifier, 'predict_proba'):
                probabilities = self.embedding_classifier.predict_proba([embedding])[0]
                confidence = float(max(probabilities))
            else:
                confidence = 0.4  # Default confidence for non-probabilistic classifiers

            return WordClassification(
                word=word,
                lemma=lemma,
                pos="",
                cefr_level=CEFRLevel(prediction),
                confidence=confidence * 0.8,  # Reduce confidence for embedding-based
                source=ClassificationSource.EMBEDDING_CLASSIFIER
            )

        except Exception as e:
            logger.debug(f"Error in embedding classification: {e}")
            return None

    def classify_word(self, word: str, pos: Optional[str] = None) -> WordClassification:
        """
        Classify a single word with CEFR level

        Args:
            word: The word to classify
            pos: Optional part of speech tag

        Returns:
            WordClassification with level, confidence, and source
        """
        word_lower = word.lower().strip()
        lemma = self._get_lemma(word_lower)

        # Stage 1: Check multi-word expressions
        if ' ' in word_lower and word_lower in self.multi_word_expressions:
            level, source = self.multi_word_expressions[word_lower]
            return WordClassification(
                word=word,
                lemma=word_lower,
                pos=pos or "",
                cefr_level=level,
                confidence=1.0,
                source=source,
                is_multi_word=True
            )

        # Stage 2: Check POS-specific mapping
        if pos:
            pos_key = (lemma, pos.lower())
            if pos_key in self.pos_specific:
                level, source = self.pos_specific[pos_key]
                return WordClassification(
                    word=word,
                    lemma=lemma,
                    pos=pos,
                    cefr_level=level,
                    confidence=1.0,
                    source=source
                )

        # Stage 3: Check main CEFR wordlist
        if lemma in self.cefr_wordlist:
            level, source = self.cefr_wordlist[lemma]
            return WordClassification(
                word=word,
                lemma=lemma,
                pos=pos or "",
                cefr_level=level,
                confidence=1.0,
                source=source
            )

        # Stage 4: Frequency-based backoff
        freq_result = self._classify_by_frequency(word_lower, lemma)
        if freq_result and freq_result.confidence >= 0.5:
            freq_result.pos = pos or ""
            return freq_result

        # Stage 5: Embedding-based classifier
        if self.use_embedding_classifier:
            emb_result = self._classify_by_embedding(word_lower, lemma)
            if emb_result:
                emb_result.pos = pos or ""
                return emb_result

        # Stage 6: Fallback - use frequency if available, else C2
        if freq_result:
            return freq_result

        # Ultimate fallback: assume C2 (advanced/rare word)
        return WordClassification(
            word=word,
            lemma=lemma,
            pos=pos or "",
            cefr_level=CEFRLevel.C2,
            confidence=0.2,
            source=ClassificationSource.FALLBACK
        )

    def classify_text(self, text: str) -> List[WordClassification]:
        """
        Classify all words in a text (OPTIMIZED)

        Performance optimizations:
        1. Normalize text first (lowercase, punctuation, apostrophes)
        2. Use nlp.pipe() for batch processing
        3. Deduplicate words before classification
        4. Process only unique lemmas

        Args:
            text: Input text to classify

        Returns:
            List of WordClassification objects (one per unique lemma)
        """
        import time
        start_time = time.time()

        # Step 1: Normalize text
        normalized_text = self.normalize_text(text)
        logger.info(f"Text normalized in {time.time() - start_time:.2f}s")

        # Step 2: Split into chunks for batch processing
        chunk_start = time.time()
        words = normalized_text.split()

        # Filter valid tokens BEFORE spaCy processing
        valid_words = [w for w in words if self.is_valid_token(w)]
        logger.info(f"Filtered {len(words)} tokens → {len(valid_words)} valid tokens in {time.time() - chunk_start:.2f}s")

        # Step 3: Batch lemmatization with nlp.pipe()
        lemma_start = time.time()

        # Use nlp.pipe() for efficient batch processing
        docs = list(self.nlp.pipe(
            valid_words,
            batch_size=500,
            n_process=1  # Use 1 for stability; increase if needed
        ))

        # Build lemma → original word mapping
        word_to_lemma: Dict[str, str] = {}
        lemma_to_word: Dict[str, str] = {}
        lemma_to_pos: Dict[str, str] = {}

        for doc in docs:
            if len(doc) > 0:
                token = doc[0]
                word = token.text
                lemma = token.lemma_
                pos = token.pos_ if hasattr(token, 'pos_') else ""

                word_to_lemma[word] = lemma
                if lemma not in lemma_to_word:
                    lemma_to_word[lemma] = word
                    lemma_to_pos[lemma] = pos

        logger.info(f"Lemmatized {len(valid_words)} words → {len(lemma_to_word)} unique lemmas in {time.time() - lemma_start:.2f}s")

        # Step 4: Classify unique lemmas only (MASSIVE speedup)
        classify_start = time.time()
        classifications = []

        for lemma, original_word in lemma_to_word.items():
            pos = lemma_to_pos.get(lemma, "")
            classification = self.classify_word(original_word, pos)
            classifications.append(classification)

        logger.info(f"Classified {len(classifications)} unique words in {time.time() - classify_start:.2f}s")
        logger.info(f"TOTAL classification time: {time.time() - start_time:.2f}s")

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
        logger.info(f"Updated frequency thresholds: {self.frequency_thresholds}")
