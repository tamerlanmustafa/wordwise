"""
Translation Service

Provides translation orchestration with caching using DeepL API.
Implements database-first caching to minimize API calls and costs.
"""

import logging
from typing import Optional, Dict, Any
from datetime import datetime

from prisma import Prisma
from ..utils.deepl_client import (
    DeepLClient,
    DeepLError,
    DeepLQuotaExceededError,
    DeepLInvalidLanguageError,
    normalize_text_for_cache
)

logger = logging.getLogger(__name__)


class TranslationService:
    """Service for handling translations with caching"""

    def __init__(self, db: Prisma, deepl_client: Optional[DeepLClient] = None):
        self.db = db
        self.client = deepl_client or DeepLClient()

    async def get_translation(
        self,
        text: str,
        target_lang: str,
        source_lang: str = "auto",
        use_cache: bool = True
    ) -> Dict[str, Any]:
        """
        Get translation with automatic caching

        Flow:
        1. Normalize input text for consistent cache lookups
        2. Check cache for existing translation
        3. If cache hit -> return cached value
        4. If cache miss -> call DeepL API
        5. Save new translation to database
        6. Return translation

        Args:
            text: Text to translate
            target_lang: Target language code (e.g., 'DE', 'FR', 'ES')
            source_lang: Source language code or 'auto' for detection
            use_cache: Whether to use cached translations (default: True)

        Returns:
            Dict containing:
                - source: Original text
                - translated: Translated text
                - target_lang: Target language code
                - source_lang: Detected/provided source language
                - cached: Whether result came from cache
                - created_at: Timestamp of cache entry (if cached)

        Raises:
            DeepLError: If translation fails
        """
        # Normalize for consistent cache lookups
        normalized_text = normalize_text_for_cache(text)
        original_text = text.strip()
        target_lang_upper = target_lang.upper()

        # Handle empty text
        if not original_text:
            return {
                "source": "",
                "translated": "",
                "target_lang": target_lang_upper,
                "source_lang": None,
                "cached": False
            }

        # Check cache first
        if use_cache:
            cached = await self._get_from_cache(normalized_text, target_lang_upper)
            if cached:
                logger.info(f"Cache hit for '{normalized_text}' -> {target_lang_upper}")
                return {
                    "source": original_text,
                    "translated": cached["translated"],
                    "target_lang": target_lang_upper,
                    "source_lang": cached.get("source_lang"),
                    "cached": True,
                    "created_at": cached["created_at"].isoformat()
                }

        # Cache miss - translate via DeepL
        logger.info(f"Cache miss for '{normalized_text}' -> {target_lang_upper}")

        try:
            result = await self.client.translate(
                text=original_text,
                target_lang=target_lang_upper,
                source_lang=source_lang
            )

            translated = result["translated"]
            detected_lang = result.get("detected_source_lang")

            # Save to cache
            await self._save_to_cache(
                source_text=normalized_text,
                target_lang=target_lang_upper,
                translated=translated,
                source_lang=detected_lang
            )

            return {
                "source": original_text,
                "translated": translated,
                "target_lang": target_lang_upper,
                "source_lang": detected_lang,
                "cached": False
            }

        except DeepLQuotaExceededError as e:
            logger.error(f"DeepL quota exceeded: {e}")
            raise
        except DeepLInvalidLanguageError as e:
            logger.error(f"Invalid language code: {e}")
            raise
        except DeepLError as e:
            logger.error(f"Translation error: {e}")
            raise

    async def _get_from_cache(
        self,
        source_text: str,
        target_lang: str
    ) -> Optional[Dict[str, Any]]:
        """
        Retrieve translation from cache

        Args:
            source_text: Normalized source text
            target_lang: Target language code

        Returns:
            Cache entry dict or None if not found
        """
        try:
            cache_entry = await self.db.translationcache.find_first(
                where={
                    "sourceText": source_text,
                    "targetLang": target_lang
                }
            )

            if cache_entry:
                return {
                    "translated": cache_entry.translated,
                    "source_lang": cache_entry.sourceLang,
                    "created_at": cache_entry.createdAt
                }

            return None

        except Exception as e:
            logger.error(f"Cache lookup error: {e}")
            return None

    async def _save_to_cache(
        self,
        source_text: str,
        target_lang: str,
        translated: str,
        source_lang: Optional[str] = None
    ) -> None:
        """
        Save translation to cache

        Uses upsert to handle duplicate translations gracefully.

        Args:
            source_text: Normalized source text
            target_lang: Target language code
            translated: Translated text
            source_lang: Detected source language
        """
        try:
            await self.db.translationcache.upsert(
                where={
                    "sourceText_targetLang": {
                        "sourceText": source_text,
                        "targetLang": target_lang
                    }
                },
                data={
                    "create": {
                        "sourceText": source_text,
                        "targetLang": target_lang,
                        "translated": translated,
                        "sourceLang": source_lang
                    },
                    "update": {
                        "translated": translated,
                        "sourceLang": source_lang,
                        "updatedAt": datetime.utcnow()
                    }
                }
            )
            logger.debug(f"Saved to cache: '{source_text}' -> '{translated}'")

        except Exception as e:
            # Don't fail the request if cache save fails
            logger.error(f"Failed to save to cache: {e}")

    async def batch_translate(
        self,
        texts: list[str],
        target_lang: str,
        source_lang: str = "auto"
    ) -> list[Dict[str, Any]]:
        """
        Translate multiple texts efficiently

        Checks cache for all texts first, then only translates cache misses.

        Args:
            texts: List of texts to translate
            target_lang: Target language code
            source_lang: Source language code or 'auto'

        Returns:
            List of translation results in same order as input
        """
        results = []

        for text in texts:
            try:
                result = await self.get_translation(
                    text=text,
                    target_lang=target_lang,
                    source_lang=source_lang
                )
                results.append(result)
            except DeepLError as e:
                logger.error(f"Failed to translate '{text}': {e}")
                # Return error result but continue
                results.append({
                    "source": text,
                    "translated": None,
                    "target_lang": target_lang.upper(),
                    "source_lang": None,
                    "cached": False,
                    "error": str(e)
                })

        return results

    async def get_cache_stats(self) -> Dict[str, Any]:
        """
        Get translation cache statistics

        Returns:
            Dict with cache metrics
        """
        try:
            total_entries = await self.db.translationcache.count()

            # Count by target language
            # Note: Prisma Python doesn't support groupBy yet, so we do it manually
            all_entries = await self.db.translationcache.find_many()

            lang_counts = {}
            for entry in all_entries:
                lang = entry.targetLang
                lang_counts[lang] = lang_counts.get(lang, 0) + 1

            return {
                "total_translations": total_entries,
                "languages": lang_counts,
                "cache_enabled": True
            }

        except Exception as e:
            logger.error(f"Failed to get cache stats: {e}")
            return {
                "total_translations": 0,
                "languages": {},
                "cache_enabled": False,
                "error": str(e)
            }


async def get_translation(
    db: Prisma,
    text: str,
    target_lang: str,
    source_lang: str = "auto"
) -> Dict[str, Any]:
    """
    Convenience function for getting translation

    Args:
        db: Prisma database instance
        text: Text to translate
        target_lang: Target language code
        source_lang: Source language code or 'auto'

    Returns:
        Translation result dict
    """
    service = TranslationService(db)
    return await service.get_translation(text, target_lang, source_lang)
