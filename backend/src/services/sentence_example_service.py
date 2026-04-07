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

    def extract_word_sentences_by_lemma(
        self,
        script_text: str,
        target_lemma: str,
        nlp,
        max_examples: int = 3,
        target_surface: str = None,
    ) -> List[Tuple[str, int, str]]:
        """
        Extract sentences where any token lemmatizes to target_lemma.
        Catches all irregular forms (ran→run, went→go, etc.).

        If target_surface is provided, also matches tokens whose literal text
        equals target_surface — used as a fallback when spaCy's bare-word
        lemmatization disagrees with its in-context lemmatization (e.g.,
        "unimpaired" → "unimpaire" in isolation but "unimpaired" as adjective).

        Returns list of (sentence, word_position, matched_form) tuples, sorted by score.
        matched_form is the actual word as it appears in the sentence (e.g., "sell", "sold", "selling").
        """
        sentences = self.split_into_sentences(script_text)
        candidates: List[Tuple[str, float, int, int, str]] = []
        surface_lower = target_surface.lower() if target_surface else None

        for sentence_idx, sentence in enumerate(sentences):
            tokens = self.tokenize_sentence(sentence)
            word_count = len(tokens)

            if word_count > self.MAX_SENTENCE_WORDS:
                continue

            # Lemmatize tokens to find matches
            doc = nlp(sentence)
            match_positions = []
            matched_form = target_lemma
            for i, spacy_token in enumerate(doc):
                if spacy_token.is_punct or spacy_token.is_space:
                    continue
                token_lemma = spacy_token.lemma_.lower()
                token_text_lower = spacy_token.text.lower()
                if token_lemma == target_lemma or (
                    surface_lower and token_text_lower == surface_lower
                ):
                    token_text = spacy_token.text.lower()
                    matched_form = spacy_token.text  # preserve original casing
                    pos = next(
                        (j for j, t in enumerate(tokens) if t == token_text),
                        0
                    )
                    match_positions.append(pos)

            if not match_positions:
                continue

            # If sentence is too short, prepend previous sentence(s) for context
            actual_sentence = sentence
            if word_count < self.MIN_SENTENCE_WORDS:
                combined = sentence
                for lookback in range(1, 3):  # Try up to 2 previous sentences
                    prev_idx = sentence_idx - lookback
                    if prev_idx < 0:
                        break
                    combined = sentences[prev_idx].strip() + " " + combined
                    combined_tokens = self.tokenize_sentence(combined)
                    if len(combined_tokens) > self.MAX_SENTENCE_WORDS:
                        break  # Too long, stop adding
                    actual_sentence = combined
                    tokens = combined_tokens
                    word_count = len(tokens)
                    if word_count >= self.MIN_SENTENCE_WORDS:
                        break  # Good enough

                if word_count < self.MIN_SENTENCE_WORDS:
                    continue  # Still too short, skip

                # Recalculate word position in combined sentence
                target_token = doc[match_positions[0]].text.lower() if match_positions else target_lemma
                match_positions[0] = next(
                    (j for j, t in enumerate(tokens) if t == target_token),
                    match_positions[0]
                )

            word_position = match_positions[0]
            score = self.score_sentence(
                actual_sentence, tokens, tokens[word_position] if word_position < len(tokens) else target_lemma,
                sentence_idx
            )

            if score > 0:
                candidates.append((actual_sentence, score, sentence_idx, word_position, matched_form))

        # Sort by score descending, then position ascending
        candidates.sort(key=lambda x: (-x[1], x[2]))

        return [
            (sent, pos, form)
            for sent, _score, _idx, pos, form in candidates[:max_examples]
        ]

    def extract_phrase_sentences(
        self,
        script_text: str,
        phrase: str,
        nlp,
        max_examples: int = 3,
    ) -> List[Tuple[str, int, str]]:
        """
        Extract sentences containing a multi-word phrase (e.g., phrasal verbs, idioms).

        Strategy:
        1. Direct substring match on the phrase (case-insensitive).
        2. For two-token phrasal-verb-like phrases (verb + particle), also detect
           split forms via spaCy where the verb's lemma matches the first token
           and the particle text matches the second, allowing intervening tokens
           (e.g., "give it up" matches "give up").

        Returns list of (sentence, word_position, matched_form) tuples.
        matched_form is the literal substring that matched in the sentence.
        """
        sentences = self.split_into_sentences(script_text)
        phrase_lower = phrase.lower().strip()
        phrase_tokens = phrase_lower.split()

        # Build a regex for direct substring match (word-boundary aware)
        escaped = re.escape(phrase_lower)
        # Allow flexible whitespace between phrase tokens
        flex_pattern = r'\b' + r'\s+'.join(re.escape(t) for t in phrase_tokens) + r'\b'
        direct_re = re.compile(flex_pattern, re.IGNORECASE)

        candidates: List[Tuple[str, float, int, int, str]] = []
        is_two_token_pv = len(phrase_tokens) == 2
        # Phrases are rarer than single words, so be much more permissive on
        # sentence length than the single-word path.
        PHRASE_MAX_WORDS = 60

        for sentence_idx, sentence in enumerate(sentences):
            tokens = self.tokenize_sentence(sentence)
            word_count = len(tokens)
            if word_count > PHRASE_MAX_WORDS:
                continue

            matched_form = None
            word_position = 0

            # Step 1: direct substring match
            m = direct_re.search(sentence)
            if m:
                matched_form = m.group(0)
                # Approximate word_position: find first phrase token in tokens
                first_tok = phrase_tokens[0]
                for j, t in enumerate(tokens):
                    if t == first_tok:
                        word_position = j
                        break

            # Step 2: split phrasal verb (verb ... particle) via spaCy
            # Strict: the particle must be parsed as dep_=='prt' AND its head
            # must be the verb token. This avoids false positives like
            # "Maybe I could help. -You're out, Tom." where 'out' is in a
            # different clause / sentence and not a particle of 'help'.
            elif is_two_token_pv:
                try:
                    doc = nlp(sentence)
                    verb_lemma, particle_text = phrase_tokens[0], phrase_tokens[1]
                    for tok in doc:
                        # Find the particle token first (cheaper filter)
                        if tok.text.lower() != particle_text:
                            continue
                        if tok.dep_ != 'prt':
                            continue
                        head = tok.head
                        if head is None or head.lemma_.lower() != verb_lemma:
                            continue
                        # Reject if a sentence-ending punct sits between them
                        lo, hi = (head.i, tok.i) if head.i < tok.i else (tok.i, head.i)
                        bad_break = False
                        for k in range(lo + 1, hi):
                            if doc[k].text in {'.', '!', '?', ';', '—', '–', '--'}:
                                bad_break = True
                                break
                        if bad_break:
                            continue
                        matched_form = f"{head.text} {tok.text}"
                        head_text_lower = head.text.lower()
                        for j, t in enumerate(tokens):
                            if t == head_text_lower:
                                word_position = j
                                break
                        break
                except Exception:
                    pass

            if not matched_form:
                continue

            actual_sentence = sentence
            # If short, try prepending prior sentences for context — but never
            # drop the candidate just because it's short.
            if word_count < self.MIN_SENTENCE_WORDS:
                combined = sentence
                for lookback in range(1, 3):
                    prev_idx = sentence_idx - lookback
                    if prev_idx < 0:
                        break
                    combined = sentences[prev_idx].strip() + " " + combined
                    combined_tokens = self.tokenize_sentence(combined)
                    if len(combined_tokens) > PHRASE_MAX_WORDS:
                        break
                    actual_sentence = combined
                    tokens = combined_tokens
                    word_count = len(tokens)
                    if word_count >= self.MIN_SENTENCE_WORDS:
                        break

            # Always accept the match — phrase extractions are intentional and
            # rare, so a low scoring or short sentence is still useful.
            score = max(
                1,
                self.score_sentence(
                    actual_sentence,
                    tokens,
                    phrase_tokens[0],
                    sentence_idx,
                ),
            )
            candidates.append((actual_sentence, score, sentence_idx, word_position, matched_form))

        candidates.sort(key=lambda x: (-x[1], x[2]))
        return [
            (sent, pos, form)
            for sent, _score, _idx, pos, form in candidates[:max_examples]
        ]

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
