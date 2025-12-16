"""
Embedding Similarity CEFR Classifier

Classifies unknown words by finding semantically similar known CEFR words.
Uses sentence-transformers for word embeddings and cosine similarity for matching.

This is a fallback classifier for words not found in CEFR dictionaries.
It leverages the semantic relationships between words to estimate CEFR levels.
"""

import logging
import json
import numpy as np
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# CEFR level to numeric mapping for voting
CEFR_TO_NUMERIC = {'A1': 1, 'A2': 2, 'B1': 3, 'B2': 4, 'C1': 5, 'C2': 6}
NUMERIC_TO_CEFR = {1: 'A1', 2: 'A2', 3: 'B1', 4: 'B2', 5: 'C1', 6: 'C2'}


@dataclass
class SimilarWord:
    """A known word similar to the query word."""
    word: str
    cefr_level: str
    similarity: float


class EmbeddingSimilarityClassifier:
    """
    Classifies unknown words using embedding similarity to known CEFR words.

    Architecture:
    1. Precompute embeddings for all known CEFR words at initialization
    2. For unknown word: compute embedding, find k most similar known words
    3. Use weighted voting based on similarity scores to determine CEFR level
    """

    def __init__(
        self,
        data_dir: Path,
        model_name: str = 'all-MiniLM-L6-v2',
        top_k: int = 5,
        min_similarity: float = 0.3
    ):
        """
        Initialize the embedding similarity classifier.

        Args:
            data_dir: Directory containing CEFR wordlists
            model_name: Sentence transformer model name (default: all-MiniLM-L6-v2 - 80MB)
            top_k: Number of similar words to use for voting
            min_similarity: Minimum similarity threshold for a match
        """
        self.data_dir = Path(data_dir)
        self.model_name = model_name
        self.top_k = top_k
        self.min_similarity = min_similarity

        self.sentence_model = None
        self.known_words: List[str] = []
        self.known_levels: List[str] = []
        self.known_embeddings: Optional[np.ndarray] = None

        self._initialized = False

    def initialize(self) -> bool:
        """
        Load the sentence transformer model and precompute embeddings.

        Returns:
            True if initialization succeeded, False otherwise
        """
        if self._initialized:
            return True

        try:
            from sentence_transformers import SentenceTransformer

            # Load or download the model
            model_path = self.data_dir / "sentence_transformer"
            if model_path.exists():
                logger.info(f"Loading sentence transformer from {model_path}")
                self.sentence_model = SentenceTransformer(str(model_path))
            else:
                logger.info(f"Downloading sentence transformer: {self.model_name}")
                self.sentence_model = SentenceTransformer(self.model_name)
                self.sentence_model.save(str(model_path))
                logger.info(f"Saved sentence transformer to {model_path}")

            # Load CEFR wordlists and compute embeddings
            self._load_known_words()
            self._compute_embeddings()

            self._initialized = True
            logger.info(f"Embedding classifier ready with {len(self.known_words)} known words")
            return True

        except ImportError:
            logger.warning("sentence-transformers not installed. Run: pip install sentence-transformers")
            return False
        except Exception as e:
            logger.error(f"Failed to initialize embedding classifier: {e}")
            return False

    def _load_known_words(self):
        """Load known words and their CEFR levels from wordlists."""
        self.known_words = []
        self.known_levels = []
        seen_words = set()

        # Load comprehensive CEFR
        comprehensive_path = self.data_dir / "comprehensive_cefr.json"
        if comprehensive_path.exists():
            self._load_wordlist(comprehensive_path, 'cefr_level', seen_words)

        # Load EFLLex
        efllex_path = self.data_dir / "efllex.json"
        if efllex_path.exists():
            self._load_wordlist(efllex_path, 'cefr', seen_words)

        logger.info(f"Loaded {len(self.known_words)} known words for embedding similarity")

    def _load_wordlist(self, path: Path, level_key: str, seen_words: set):
        """Load a single wordlist file."""
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            for entry in data:
                word = entry.get('word', '').lower().strip()
                level = entry.get(level_key, '').upper()

                if word and level and word not in seen_words and level in CEFR_TO_NUMERIC:
                    # Skip multi-word expressions for embedding (less reliable)
                    if ' ' not in word:
                        self.known_words.append(word)
                        self.known_levels.append(level)
                        seen_words.add(word)

        except Exception as e:
            logger.error(f"Error loading wordlist {path}: {e}")

    def _compute_embeddings(self):
        """Precompute embeddings for all known words."""
        if not self.known_words:
            logger.warning("No known words to compute embeddings for")
            return

        # Check for cached embeddings
        cache_path = self.data_dir / "word_embeddings.npy"
        words_cache_path = self.data_dir / "word_embeddings_words.json"

        if cache_path.exists() and words_cache_path.exists():
            try:
                with open(words_cache_path, 'r') as f:
                    cached_words = json.load(f)

                if cached_words == self.known_words:
                    self.known_embeddings = np.load(str(cache_path))
                    logger.info(f"Loaded cached embeddings for {len(self.known_words)} words")
                    return
            except Exception as e:
                logger.warning(f"Failed to load cached embeddings: {e}")

        # Compute embeddings in batches
        logger.info(f"Computing embeddings for {len(self.known_words)} words...")

        batch_size = 256
        all_embeddings = []

        for i in range(0, len(self.known_words), batch_size):
            batch = self.known_words[i:i + batch_size]
            embeddings = self.sentence_model.encode(batch, show_progress_bar=False)
            all_embeddings.append(embeddings)

        self.known_embeddings = np.vstack(all_embeddings)

        # Normalize for cosine similarity
        norms = np.linalg.norm(self.known_embeddings, axis=1, keepdims=True)
        self.known_embeddings = self.known_embeddings / norms

        # Cache the embeddings
        try:
            np.save(str(cache_path), self.known_embeddings)
            with open(words_cache_path, 'w') as f:
                json.dump(self.known_words, f)
            logger.info(f"Cached embeddings to {cache_path}")
        except Exception as e:
            logger.warning(f"Failed to cache embeddings: {e}")

        logger.info(f"Computed embeddings: shape={self.known_embeddings.shape}")

    def find_similar_words(self, word: str) -> List[SimilarWord]:
        """
        Find known words similar to the given word.

        Args:
            word: The unknown word to classify

        Returns:
            List of similar known words with their CEFR levels and similarity scores
        """
        if not self._initialized or self.known_embeddings is None:
            return []

        # Compute embedding for the query word
        query_embedding = self.sentence_model.encode([word.lower()], show_progress_bar=False)[0]

        # Normalize
        query_norm = np.linalg.norm(query_embedding)
        if query_norm > 0:
            query_embedding = query_embedding / query_norm

        # Compute cosine similarities (dot product since normalized)
        similarities = np.dot(self.known_embeddings, query_embedding)

        # Get top-k indices
        top_indices = np.argsort(similarities)[-self.top_k:][::-1]

        results = []
        for idx in top_indices:
            sim = float(similarities[idx])
            if sim >= self.min_similarity:
                results.append(SimilarWord(
                    word=self.known_words[idx],
                    cefr_level=self.known_levels[idx],
                    similarity=sim
                ))

        return results

    def classify(self, word: str) -> Tuple[Optional[str], float, List[SimilarWord]]:
        """
        Classify an unknown word using embedding similarity.

        Args:
            word: The word to classify

        Returns:
            Tuple of (cefr_level, confidence, similar_words)
            Returns (None, 0.0, []) if classification fails
        """
        if not self._initialized:
            if not self.initialize():
                return None, 0.0, []

        # Find similar known words
        similar_words = self.find_similar_words(word)

        if not similar_words:
            return None, 0.0, []

        # Weighted voting based on similarity
        level_weights: Dict[str, float] = {}

        for sw in similar_words:
            if sw.cefr_level not in level_weights:
                level_weights[sw.cefr_level] = 0.0
            level_weights[sw.cefr_level] += sw.similarity

        # Find the level with highest weight
        best_level = max(level_weights.items(), key=lambda x: x[1])

        # Calculate confidence based on:
        # 1. Highest similarity score
        # 2. Agreement among similar words
        # 3. Total weight of the winning level

        max_similarity = similar_words[0].similarity
        total_weight = sum(level_weights.values())
        level_agreement = best_level[1] / total_weight if total_weight > 0 else 0

        # Confidence formula: weighted average of factors
        confidence = (
            0.4 * max_similarity +          # How similar is the best match
            0.3 * level_agreement +          # How much do similar words agree
            0.3 * min(1.0, len(similar_words) / self.top_k)  # How many matches found
        )

        # Cap confidence at 0.75 (embedding similarity is less reliable than dictionary)
        confidence = min(0.75, confidence)

        return best_level[0], confidence, similar_words

    def batch_classify(self, words: List[str]) -> List[Tuple[str, Optional[str], float]]:
        """
        Classify multiple words efficiently.

        Args:
            words: List of words to classify

        Returns:
            List of (word, cefr_level, confidence) tuples
        """
        if not self._initialized:
            if not self.initialize():
                return [(w, None, 0.0) for w in words]

        results = []

        # Compute embeddings for all query words at once
        query_words = [w.lower() for w in words]
        query_embeddings = self.sentence_model.encode(query_words, show_progress_bar=False)

        # Normalize
        norms = np.linalg.norm(query_embeddings, axis=1, keepdims=True)
        norms[norms == 0] = 1  # Avoid division by zero
        query_embeddings = query_embeddings / norms

        # Compute all similarities at once
        all_similarities = np.dot(query_embeddings, self.known_embeddings.T)

        for i, word in enumerate(words):
            similarities = all_similarities[i]
            top_indices = np.argsort(similarities)[-self.top_k:][::-1]

            # Build similar words list
            similar_words = []
            for idx in top_indices:
                sim = float(similarities[idx])
                if sim >= self.min_similarity:
                    similar_words.append(SimilarWord(
                        word=self.known_words[idx],
                        cefr_level=self.known_levels[idx],
                        similarity=sim
                    ))

            if not similar_words:
                results.append((word, None, 0.0))
                continue

            # Weighted voting
            level_weights: Dict[str, float] = {}
            for sw in similar_words:
                if sw.cefr_level not in level_weights:
                    level_weights[sw.cefr_level] = 0.0
                level_weights[sw.cefr_level] += sw.similarity

            best_level = max(level_weights.items(), key=lambda x: x[1])

            max_similarity = similar_words[0].similarity
            total_weight = sum(level_weights.values())
            level_agreement = best_level[1] / total_weight if total_weight > 0 else 0

            confidence = min(0.75, (
                0.4 * max_similarity +
                0.3 * level_agreement +
                0.3 * min(1.0, len(similar_words) / self.top_k)
            ))

            results.append((word, best_level[0], confidence))

        return results


# Singleton instance for reuse
_singleton_classifier: Optional[EmbeddingSimilarityClassifier] = None


def get_embedding_classifier(data_dir: Path) -> EmbeddingSimilarityClassifier:
    """
    Get or create the singleton embedding classifier.

    Args:
        data_dir: Directory containing CEFR wordlists

    Returns:
        Initialized EmbeddingSimilarityClassifier instance
    """
    global _singleton_classifier

    if _singleton_classifier is None:
        _singleton_classifier = EmbeddingSimilarityClassifier(data_dir)

    return _singleton_classifier