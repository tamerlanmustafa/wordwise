"""
Example Translation Service

Handles batch translation of sentence examples with caching and rate limiting.
Uses existing translation infrastructure (DeepL + Google fallback).
"""

import logging
import time
import asyncio
from typing import List, Dict, Optional, Tuple
from prisma import Prisma

from .translation_service import TranslationService, DEEPL_SUPPORTED_TARGET_LANGS

logger = logging.getLogger(__name__)


class ExampleTranslationService:
    """Batch translate sentence examples with rate limiting and caching"""

    # Batch configuration
    DEFAULT_BATCH_SIZE = 25
    DEFAULT_DELAY_MS = 500  # Delay between batches (ms)

    def __init__(
        self,
        db: Prisma,
        translation_service: Optional[TranslationService] = None,
        batch_size: int = DEFAULT_BATCH_SIZE,
        delay_ms: int = DEFAULT_DELAY_MS
    ):
        self.db = db
        self.translation_service = translation_service or TranslationService(db)
        self.batch_size = batch_size
        self.delay_seconds = delay_ms / 1000.0

    async def translate_sentence_batch(
        self,
        sentences: List[str],
        target_lang: str,
        source_lang: str = "en"
    ) -> List[Dict[str, str]]:
        """
        Translate a batch of sentences.

        Args:
            sentences: List of sentence strings to translate
            target_lang: Target language code (e.g., 'ES', 'RU')
            source_lang: Source language code (default: 'en')

        Returns:
            List of dicts with 'sentence', 'translation', 'provider', 'cached' keys
        """
        results = []

        for sentence in sentences:
            try:
                translation_result = await self.translation_service.get_translation(
                    text=sentence,
                    target_lang=target_lang,
                    source_lang=source_lang,
                    use_cache=True,
                    user_id=None  # No user tracking for batch enrichment
                )

                results.append({
                    'sentence': sentence,
                    'translation': translation_result['translated'],
                    'provider': translation_result.get('provider', 'unknown'),
                    'cached': translation_result.get('cached', False)
                })

            except Exception as e:
                error_msg = str(e).lower()
                # If rate limited, add longer delay
                if 'rate limit' in error_msg or '429' in error_msg:
                    logger.warning(f"Rate limit hit, waiting 2 seconds before retry...")
                    await asyncio.sleep(2)

                # Log translation failures only once to avoid log spam
                if not hasattr(self, '_translation_error_logged'):
                    logger.error(f"Failed to translate sentence: {e}")
                    logger.warning("Further translation errors will be suppressed to avoid log spam")
                    self._translation_error_logged = True

                results.append({
                    'sentence': sentence,
                    'translation': sentence,  # Fallback to original
                    'provider': 'error',
                    'cached': False
                })

        return results

    async def translate_all_sentences(
        self,
        sentences: List[str],
        target_lang: str,
        source_lang: str = "en"
    ) -> Tuple[List[Dict[str, str]], Dict[str, int]]:
        """
        Translate all sentences in batches with rate limiting.

        Args:
            sentences: List of unique sentence strings
            target_lang: Target language code
            source_lang: Source language code

        Returns:
            Tuple of (translation_results, statistics_dict)
        """
        total_sentences = len(sentences)
        logger.info(f"Translating {total_sentences} sentences to {target_lang} in batches of {self.batch_size}")

        all_results = []
        cache_hits = 0
        api_calls = 0

        # Process in batches
        for i in range(0, total_sentences, self.batch_size):
            batch = sentences[i:i + self.batch_size]
            batch_num = (i // self.batch_size) + 1
            total_batches = (total_sentences + self.batch_size - 1) // self.batch_size

            logger.info(f"Processing batch {batch_num}/{total_batches} ({len(batch)} sentences)")

            # Translate batch
            batch_results = await self.translate_sentence_batch(
                batch,
                target_lang,
                source_lang
            )

            # Collect statistics
            for result in batch_results:
                if result['cached']:
                    cache_hits += 1
                else:
                    api_calls += 1

            all_results.extend(batch_results)

            # Rate limiting: sleep between batches (except after last batch)
            if i + self.batch_size < total_sentences:
                logger.debug(f"Sleeping {self.delay_seconds}s before next batch")
                await asyncio.sleep(self.delay_seconds)

        statistics = {
            'total_sentences': total_sentences,
            'cache_hits': cache_hits,
            'api_calls': api_calls,
            'cache_hit_rate': cache_hits / total_sentences if total_sentences > 0 else 0.0
        }

        logger.info(f"Translation complete: {cache_hits} cached, {api_calls} API calls")

        return all_results, statistics

    async def save_word_examples(
        self,
        movie_id: int,
        word_examples: Dict[str, List[Tuple[str, int, str, str]]],
        target_lang: str
    ) -> int:
        """
        Save word sentence examples to database.

        Args:
            movie_id: Movie ID
            word_examples: Dict mapping word -> list of (sentence, position, translation, lemma) tuples
            target_lang: Target language code

        Returns:
            Number of rows saved
        """
        logger.info(f"Saving {len(word_examples)} word examples to database")

        # Fetch CEFR levels for words
        word_classifications = await self.db.wordclassification.find_many(
            where={
                'script': {
                    'is': {
                        'movieId': movie_id
                    }
                }
            }
        )

        # Build word -> (lemma, cefr_level) mapping
        word_to_info: Dict[str, Tuple[str, str]] = {}
        for wc in word_classifications:
            word_lower = wc.word.lower()
            if word_lower not in word_to_info:
                word_to_info[word_lower] = (wc.lemma, wc.cefrLevel)

        # Prepare data for batch insert
        data_to_insert = []

        for word, examples in word_examples.items():
            word_lower = word.lower()

            # Get word info (lemma, cefr_level)
            if word_lower not in word_to_info:
                logger.warning(f"Word '{word}' not found in classifications, skipping")
                continue

            lemma, cefr_level = word_to_info[word_lower]

            for sentence, position, translation, _ in examples:
                data_to_insert.append({
                    'movieId': movie_id,
                    'word': word_lower,
                    'lemma': lemma,
                    'cefrLevel': cefr_level,
                    'sentence': sentence,
                    'translation': translation,
                    'targetLang': target_lang.upper(),
                    'wordPosition': position
                })

        if not data_to_insert:
            logger.warning("No data to insert")
            return 0

        # Batch insert with upsert logic
        # Use deleteMany + createMany for idempotency
        logger.info(f"Deleting existing examples for movie {movie_id}, lang {target_lang}")
        deleted = await self.db.wordsentenceexample.delete_many(
            where={
                'movieId': movie_id,
                'targetLang': target_lang.upper()
            }
        )
        logger.info(f"Deleted {deleted} existing rows")

        # Insert new data
        logger.info(f"Inserting {len(data_to_insert)} new examples")
        await self.db.wordsentenceexample.create_many(
            data=data_to_insert,
            skip_duplicates=True
        )

        logger.info(f"Successfully saved {len(data_to_insert)} word examples")

        return len(data_to_insert)
