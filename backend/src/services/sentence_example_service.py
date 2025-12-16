"""
Sentence Example Extraction Service

Extracts representative sentences from movie scripts for word examples.
Uses sentence splitting, tokenization, and heuristic-based selection.
"""

import re
import logging
from typing import Dict, List, Tuple, Set
from collections import defaultdict

logger = logging.getLogger(__name__)


class SentenceExampleService:
    """Extract representative sentences for words from movie scripts"""

    # Sentence selection parameters
    MIN_SENTENCE_WORDS = 6
    MAX_SENTENCE_WORDS = 25
    MAX_EXAMPLES_PER_WORD = 3

    def __init__(self):
        pass

    def split_into_sentences(self, text: str) -> List[str]:
        """
        Split text into sentences using regex-based approach.

        Handles:
        - Period, question mark, exclamation
        - Common abbreviations (Mr., Mrs., Dr., etc.)
        - Ellipsis (...)

        Returns list of sentence strings.
        """
        # Replace common abbreviations temporarily to avoid false splits
        abbrev_map = {
            r'\bMr\.': 'MR_ABBREV',
            r'\bMrs\.': 'MRS_ABBREV',
            r'\bMs\.': 'MS_ABBREV',
            r'\bDr\.': 'DR_ABBREV',
            r'\bProf\.': 'PROF_ABBREV',
            r'\bSr\.': 'SR_ABBREV',
            r'\bJr\.': 'JR_ABBREV',
            r'\bvs\.': 'VS_ABBREV',
            r'\betc\.': 'ETC_ABBREV',
            r'\be\.g\.': 'EG_ABBREV',
            r'\bi\.e\.': 'IE_ABBREV',
        }

        processed_text = text
        for pattern, replacement in abbrev_map.items():
            processed_text = re.sub(pattern, replacement, processed_text, flags=re.IGNORECASE)

        # Split on sentence boundaries
        # Match: period/question/exclamation followed by whitespace and capital letter
        sentence_pattern = r'(?<=[.!?])\s+(?=[A-Z])'
        sentences = re.split(sentence_pattern, processed_text)

        # Restore abbreviations
        reverse_map = {v: k.replace('\\b', '').replace('\\', '') for k, v in abbrev_map.items()}
        restored_sentences = []
        for sentence in sentences:
            restored = sentence
            for placeholder, original in reverse_map.items():
                restored = restored.replace(placeholder, original)
            restored_sentences.append(restored.strip())

        # Filter out empty sentences
        return [s for s in restored_sentences if s]

    def tokenize_sentence(self, sentence: str) -> List[str]:
        """
        Tokenize sentence into lowercase words.

        Strips punctuation and filters empty tokens.
        """
        # Convert to lowercase
        lower = sentence.lower()

        # Remove punctuation except apostrophes in contractions
        # Keep: don't, can't, won't, etc.
        cleaned = re.sub(r"[^\w\s']", '', lower)

        # Split on whitespace
        tokens = cleaned.split()

        # Filter empty
        return [t for t in tokens if t]

    def count_word_occurrences(self, tokens: List[str], target_word: str) -> int:
        """Count how many times target word appears in token list"""
        target_lower = target_word.lower()
        return sum(1 for token in tokens if token == target_lower)

    def score_sentence(
        self,
        sentence: str,
        tokens: List[str],
        target_word: str,
        sentence_index: int
    ) -> float:
        """
        Score a sentence for suitability as an example.

        Criteria:
        - Length (prefer 6-25 words)
        - Single occurrence of target word (penalize spam)
        - Earlier in script (more stable/deterministic)

        Returns score (higher is better). Returns 0 if sentence is unsuitable.
        """
        word_count = len(tokens)
        occurrences = self.count_word_occurrences(tokens, target_word)

        # Reject sentences outside length bounds
        if word_count < self.MIN_SENTENCE_WORDS or word_count > self.MAX_SENTENCE_WORDS:
            return 0.0

        # Reject if target word doesn't appear
        if occurrences == 0:
            return 0.0

        # Base score starts at 1.0
        score = 1.0

        # Length bonus: prefer middle range (12-18 words)
        if 12 <= word_count <= 18:
            score += 0.5
        elif 10 <= word_count <= 20:
            score += 0.2

        # Occurrence bonus: prefer single occurrence
        if occurrences == 1:
            score += 1.0
        else:
            # Penalize multiple occurrences
            score -= 0.3 * (occurrences - 1)

        # Position bonus: prefer earlier sentences
        # Give small boost to first 100 sentences
        if sentence_index < 100:
            position_bonus = 0.5 * (1.0 - sentence_index / 100.0)
            score += position_bonus

        return max(score, 0.0)

    def extract_word_sentences(
        self,
        script_text: str,
        vocabulary_words: Set[str]
    ) -> Dict[str, List[Tuple[str, int]]]:
        """
        Extract best sentences for each word in vocabulary.

        Args:
            script_text: Full movie script text
            vocabulary_words: Set of lowercase words from vocabulary

        Returns:
            Dict mapping word -> list of (sentence, word_position) tuples
            Each word gets up to MAX_EXAMPLES_PER_WORD sentences
        """
        logger.info(f"Extracting sentences for {len(vocabulary_words)} vocabulary words")

        # Split script into sentences
        sentences = self.split_into_sentences(script_text)
        logger.info(f"Split script into {len(sentences)} sentences")

        # Build word -> (sentence, score, index, position) mapping
        word_candidates: Dict[str, List[Tuple[str, float, int, int]]] = defaultdict(list)

        for sentence_idx, sentence in enumerate(sentences):
            tokens = self.tokenize_sentence(sentence)

            # Check which vocabulary words appear in this sentence
            tokens_set = set(tokens)
            matching_words = vocabulary_words & tokens_set

            for word in matching_words:
                # Score this sentence for this word
                score = self.score_sentence(sentence, tokens, word, sentence_idx)

                if score > 0:
                    # Find word position in sentence (first occurrence)
                    word_position = next(
                        (i for i, token in enumerate(tokens) if token == word.lower()),
                        0
                    )
                    word_candidates[word].append((sentence, score, sentence_idx, word_position))

        # Select top sentences for each word
        result: Dict[str, List[Tuple[str, int]]] = {}

        for word, candidates in word_candidates.items():
            # Sort by score (descending), then by sentence index (ascending)
            sorted_candidates = sorted(
                candidates,
                key=lambda x: (-x[1], x[2])
            )

            # Take top N
            top_candidates = sorted_candidates[:self.MAX_EXAMPLES_PER_WORD]

            # Extract (sentence, position) tuples
            result[word] = [(sent, pos) for sent, score, idx, pos in top_candidates]

        logger.info(f"Extracted examples for {len(result)} words")

        return result

    def filter_by_word_list(
        self,
        word_sentences: Dict[str, List[Tuple[str, int]]],
        valid_words: Set[str]
    ) -> Dict[str, List[Tuple[str, int]]]:
        """
        Filter extracted sentences to only include words in valid_words set.

        This ensures we don't extract sentences for junk tokens.
        """
        filtered = {
            word: sentences
            for word, sentences in word_sentences.items()
            if word.lower() in valid_words
        }

        logger.info(f"Filtered from {len(word_sentences)} to {len(filtered)} words")

        return filtered
