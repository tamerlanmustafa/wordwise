"""
Translation Service with Hybrid DeepL + Google Translate Fallback

Provides translation with:
- Automatic caching to minimize API costs
- DeepL as primary provider (31 languages)
- Google Translate fallback for unsupported languages (e.g., Azerbaijani)
- User translation history tracking for learning analytics
"""

import logging
import re
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime

from prisma import Prisma
from ..utils.deepl_client import (
    DeepLClient,
    DeepLError,
    DeepLQuotaExceededError,
    DeepLInvalidLanguageError
)
from ..utils.google_translate_client import GoogleTranslateClient, GoogleTranslateError

logger = logging.getLogger(__name__)


# DeepL supported target languages (reviewed 2026-08-20).
#
# This set is a routing table, not a capability guarantee: a code listed here
# is *attempted* on DeepL, and anything else goes straight to Google. Getting
# it wrong is not fatal in either direction — an unlisted-but-supported
# language just never gets DeepL's better output, and a listed-but-unsupported
# one raises DeepLInvalidLanguageError and falls through to Google anyway
# (see get_translation). It does need reviewing when DeepL ships languages,
# because a stale list silently routes a whole market to the weaker provider.
#
# VI/TH/HE were added 2026-08-20 after DeepL launched them. Caveat from that
# launch: they are served only by Pro and next-generation API models, and Thai
# is early access — so on the legacy Free key these three may still raise, and
# they rely on the Google fallback actually being configured to be useful.
#
# NOTE: AZ (Azerbaijani) is NOT supported by DeepL - will use Google fallback
DEEPL_SUPPORTED_TARGET_LANGS = {
    "EN", "DE", "FR", "ES", "IT",
    "NL", "PL", "PT", "RU",
    "JA", "ZH", "TR", "KO",
    "SV", "DA", "FI", "NB",
    "BG", "CS", "EL", "ET",
    "HU", "LT", "LV", "RO",
    "SK", "SL", "UK", "ID",
    "AR", "HI",
    "VI", "TH", "HE",
}


def normalize_cache_text(text: str) -> str:
    """The cache key for a piece of source text.

    Module-level because two different callers have to agree on it exactly:
    the request path writes rows under this key, and the offline warmer
    (#124) has to ask "is this already cached?" *before* spending DeepL
    characters on it. A warmer that normalized even slightly differently
    would re-translate the entire corpus and store it under keys the read
    path never looks up — it would warm nothing while spending everything.

    Note this is NOT the same as `deepl_client.normalize_text_for_cache`,
    which only strips trailing punctuation from single words. That helper is
    unused; this is the one the cache is actually keyed on.
    """
    normalized = text.lower().strip()
    # Remove trailing punctuation for cache key consistency
    normalized = re.sub(r'[.,!?;:]+$', '', normalized)
    return normalized


class TranslationService:
    """Service for handling hybrid translations with caching and user tracking"""

    def __init__(
        self,
        db: Prisma,
        deepl_client: Optional[DeepLClient] = None,
        google_client: Optional[GoogleTranslateClient] = None
    ):
        self.db = db
        self.deepl_client = deepl_client or DeepLClient()
        self.google_client = google_client or GoogleTranslateClient()

    def _normalize_text(self, text: str) -> str:
        """Normalize text for consistent cache lookups"""
        return normalize_cache_text(text)

    async def _get_from_cache(
        self,
        normalized_text: str,
        target_lang: str
    ) -> Optional[Dict[str, Any]]:
        """Retrieve translation from cache"""
        try:
            cached = await self.db.translationcache.find_first(
                where={
                    "sourceText": normalized_text,
                    "targetLang": target_lang
                }
            )

            if cached:
                return {
                    "source_text": cached.sourceText,
                    "translated": cached.translated,
                    "target_lang": cached.targetLang,
                    "source_lang": cached.sourceLang,
                    "created_at": cached.createdAt
                }

            return None
        except Exception as e:
            logger.error(f"Cache lookup failed: {e}")
            return None

    async def _save_to_cache(
        self,
        source_text: str,
        target_lang: str,
        translated: str,
        source_lang: Optional[str] = None,
        provider: Optional[str] = None,
    ) -> None:
        """Save translation to cache"""
        # A translation identical to its source is almost always a provider
        # passthrough / failure (e.g. English text returned unchanged as
        # "Turkish"). Don't persist those — they'd serve wrong data forever
        # and inflate the cache. The rare truly-identical word just re-resolves
        # next time at negligible cost.
        if self._is_passthrough(source_text, translated):
            return
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
                        "sourceLang": source_lang,
                        "provider": provider,
                    },
                    "update": {
                        "translated": translated,
                        "sourceLang": source_lang,
                        "provider": provider,
                    }
                }
            )
        except Exception as e:
            logger.error(f"Failed to save to cache: {e}")

    @staticmethod
    def _is_passthrough(source_text: str, translated: str) -> bool:
        """Whether a result is the provider handing the input straight back.

        Shared by the single and batched cache writes so both refuse to
        persist the same junk — see `_save_to_cache` for why it matters.
        """
        return translated.strip().lower() == source_text.strip().lower()

    async def _save_many_to_cache(
        self,
        rows: List[Tuple[str, str, Optional[str]]],
        target_lang: str,
        provider: Optional[str] = None,
    ) -> None:
        """Persist a whole batch of fresh translations in one statement.

        `_save_to_cache` awaits one upsert per row, which is fine for a
        single lookup but was costing a feed page up to 40 sequential round
        trips *after* DeepL had already answered — pure added latency on the
        first card the user waits for.

        `skip_duplicates` rather than an upsert: every row here was a cache
        miss moments ago, so the only way one exists is a concurrent request
        that raced us to it. Its value is equally good, and skipping keeps
        this to a single insert.
        """
        payload = [
            {
                "sourceText": source_text,
                "targetLang": target_lang,
                "translated": translated,
                "sourceLang": source_lang,
                "provider": provider,
            }
            for source_text, translated, source_lang in rows
            if not self._is_passthrough(source_text, translated)
        ]
        if not payload:
            return
        try:
            await self.db.translationcache.create_many(
                data=payload,
                skip_duplicates=True,
            )
        except Exception as e:
            # A failed cache write costs the next caller a re-translation;
            # it must not fail the page that already has its answers.
            logger.error(f"Failed to save batch to cache: {e}")

    async def _track_user_translation(
        self,
        user_id: int,
        word: str,
        target_lang: str,
        translation: str,
        provider: str
    ) -> None:
        """Track user translation attempt for learning analytics"""
        try:
            await self.db.usertranslationhistory.create(
                data={
                    "userId": user_id,
                    "word": word.lower().strip(),
                    "targetLang": target_lang,
                    "translationUsed": translation,
                    "provider": provider
                }
            )
        except Exception as e:
            # Don't fail the request if tracking fails
            logger.error(f"Failed to track user translation: {e}")

    async def get_translation(
        self,
        text: str,
        target_lang: str,
        source_lang: str = "auto",
        use_cache: bool = True,
        user_id: Optional[int] = None,
        context: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Get translation with automatic caching and hybrid provider fallback

        Flow:
        1. Normalize input text for consistent cache lookups
        2. Check cache for existing translation
        3. If cache hit -> return cached value
        4. If cache miss:
           a. Try DeepL if language is supported
           b. Fallback to Google Translate if DeepL doesn't support language
        5. Save new translation to database
        6. Track user translation attempt (if user_id provided)

        Args:
            text: Text to translate
            target_lang: Target language code (e.g., 'ES', 'AZ')
            source_lang: Source language code or 'auto' for detection
            use_cache: Whether to use cache (default: True)
            user_id: User ID for tracking translation attempts (optional)
            context: Surrounding sentence used only to disambiguate the sense
                of `text` (DeepL `context` hint). When set, the shared
                word-level cache is bypassed on both read and write — the
                result is context-specific and keyed only by `text`, so
                caching it would poison plain-word lookups.

        Returns:
            Dict with translation result and metadata
        """
        # Preserve original text for output
        original_text = text.strip()
        normalized_text = self._normalize_text(text)
        target_lang_upper = target_lang.upper()

        # A context-biased translation is specific to its sentence; the cache
        # is keyed by word alone, so it must not read or write it.
        cache_ok = use_cache and not (context and context.strip())

        # Check cache first
        if cache_ok:
            cached = await self._get_from_cache(normalized_text, target_lang_upper)
            if cached:
                # Track user translation even if cached
                if user_id:
                    await self._track_user_translation(
                        user_id=user_id,
                        word=normalized_text,
                        target_lang=target_lang_upper,
                        translation=cached["translated"],
                        provider="cache"
                    )

                return {
                    "source": original_text,
                    "translated": cached["translated"],
                    "target_lang": target_lang_upper,
                    "source_lang": cached.get("source_lang"),
                    "cached": True,
                    "provider": "cache",
                    "created_at": cached["created_at"].isoformat()
                }

        # Cache miss - determine which provider to use
        # Try DeepL first if language is supported
        if target_lang_upper in DEEPL_SUPPORTED_TARGET_LANGS:
            try:
                result = await self.deepl_client.translate(
                    text=original_text,
                    target_lang=target_lang_upper,
                    source_lang=source_lang,
                    context=context
                )

                translated = result["translated"]
                detected_lang = result.get("detected_source_lang")

                # Save to cache (skipped for context-biased results)
                if cache_ok:
                    await self._save_to_cache(
                        source_text=normalized_text,
                        target_lang=target_lang_upper,
                        translated=translated,
                        source_lang=detected_lang,
                        provider="deepl",
                    )

                # Track user translation
                if user_id:
                    await self._track_user_translation(
                        user_id=user_id,
                        word=normalized_text,
                        target_lang=target_lang_upper,
                        translation=translated,
                        provider="deepl"
                    )

                return {
                    "source": original_text,
                    "translated": translated,
                    "target_lang": target_lang_upper,
                    "source_lang": detected_lang,
                    "cached": False,
                    "provider": "deepl"
                }

            except DeepLInvalidLanguageError:
                # DeepL rejected the language - fallback to Google
                logger.info(f"DeepL doesn't support language, falling back to Google")
                pass

            except DeepLQuotaExceededError as e:
                # Rate limited - fallback to Google Translate
                # Log only once to avoid spam
                if not hasattr(self, '_deepl_quota_error_logged'):
                    logger.warning(f"DeepL rate limited, falling back to Google: {e}")
                    logger.info("Further DeepL quota warnings will be suppressed")
                    self._deepl_quota_error_logged = True
                pass

            except DeepLError as e:
                # Other DeepL error - fallback to Google
                logger.warning(f"DeepL error, falling back to Google: {e}")
                pass

        # Use Google Translate (either not in DeepL list or DeepL rejected it)
        try:
            result = await self.google_client.translate(
                text=original_text,
                target_lang=target_lang_upper,
                source_lang=source_lang
            )

            translated = result["translated"]
            detected_lang = result.get("detected_source_lang")

            # Save to cache (skipped in context mode — see cache_ok above)
            if cache_ok:
                await self._save_to_cache(
                    source_text=normalized_text,
                    target_lang=target_lang_upper,
                    translated=translated,
                    source_lang=detected_lang,
                    provider="google",
                )

            # Track user translation
            if user_id:
                await self._track_user_translation(
                    user_id=user_id,
                    word=normalized_text,
                    target_lang=target_lang_upper,
                    translation=translated,
                    provider="google"
                )

            return {
                "source": original_text,
                "translated": translated,
                "target_lang": target_lang_upper,
                "source_lang": detected_lang,
                "cached": False,
                "provider": "google"
            }

        except GoogleTranslateError as e:
            # Log only once to avoid spam
            if not hasattr(self, '_google_translate_error_logged'):
                logger.error(f"Google Translate failed: {e}")
                self._google_translate_error_logged = True
            raise

    async def batch_translate(
        self,
        texts: List[str],
        target_lang: str,
        source_lang: str = "auto",
        user_id: Optional[int] = None,
        max_concurrent: int = 2,
        force_provider: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Translate multiple texts efficiently with caching and rate-limited requests.

        Args:
            texts: List of texts to translate
            target_lang: Target language code
            source_lang: Source language code or 'auto'
            user_id: User ID for tracking (optional)
            max_concurrent: Maximum concurrent translation requests (default 2 to avoid rate limits)

        Returns:
            List of translation results (same order as input)

        Shape of the work: ONE cache read for every text, then ONE DeepL
        request per 50 misses. The previous implementation looped
        `get_translation` behind a semaphore, which cost a DB round trip *and*
        an HTTP round trip per text — 40 texts meant 40 of each. Batching both
        halves matters: batching only the API would still leave 40 sequential
        cache queries.

        `max_concurrent` is retained for signature compatibility but is no
        longer meaningful on the fast path — there is nothing left to run
        concurrently. It still bounds the per-item fallback below.
        """
        if not texts:
            return []

        target_lang_upper = target_lang.upper()
        normalized = [self._normalize_text(t) for t in texts]

        # ── 1. One cache read for the whole batch ────────────────────────
        # Deduped: a page routinely repeats a word across its sentences, and
        # there is no reason to look it up twice or pay for it twice.
        unique_texts = sorted({n for n in normalized if n})
        cache_hits: Dict[str, Dict[str, Any]] = {}
        if unique_texts:
            try:
                rows = await self.db.translationcache.find_many(
                    where={
                        "targetLang": target_lang_upper,
                        "sourceText": {"in": unique_texts},
                    }
                )
                cache_hits = {r.sourceText: {"translated": r.translated,
                                             "source_lang": r.sourceLang} for r in rows}
            except Exception as e:
                # A failed cache read must not fail the batch — it just means
                # everything is treated as a miss.
                logger.warning(f"[batch_translate] cache read failed: {e}")

        misses = [t for t in unique_texts if t not in cache_hits]

        # ── 2. One DeepL request per 50 misses ───────────────────────────
        # `force_provider="google"` skips this step entirely. The offline
        # warmer sets it once DeepL's monthly characters are spent: without
        # it every batch would still open with a DeepL call, burn a round
        # trip discovering the same quota wall, and only then reach Google.
        use_deepl = force_provider != "google"
        if misses and use_deepl and target_lang_upper in DEEPL_SUPPORTED_TARGET_LANGS:
            try:
                translated = await self.deepl_client.translate_many(
                    texts=misses,
                    target_lang=target_lang_upper,
                    source_lang=source_lang,
                )
                fresh: List[Tuple[str, str, Optional[str]]] = []
                for source_text, result in zip(misses, translated):
                    value = result.get("translated") or ""
                    if not value:
                        continue
                    cache_hits[source_text] = {
                        "translated": value,
                        "source_lang": result.get("detected_source_lang"),
                    }
                    fresh.append(
                        (source_text, value, result.get("detected_source_lang"))
                    )
                # Persist so the next user of these words pays nothing. The
                # cache is global, which is what makes the corpus a one-time
                # cost rather than a per-user one. One statement for the whole
                # batch — see `_save_many_to_cache`.
                await self._save_many_to_cache(fresh, target_lang_upper, provider="deepl")
                misses = []
            except Exception as e:
                # Fall through to the per-item path, which handles the Google
                # fallback, quota errors and unsupported languages.
                logger.warning(f"[batch_translate] batched DeepL failed, falling back: {e}")

        # ── 3a. Batched Google fallback ──────────────────────────────────
        # Reached when the target is not a DeepL language (AZ) or DeepL just
        # failed — most consequentially when it has hit its monthly character
        # wall, which is precisely when live traffic is already degraded and
        # least able to afford 20 sequential round trips. One request per 50
        # keeps the fallback the same shape as the primary path.
        if misses:
            try:
                translated = await self.google_client.translate_many(
                    texts=misses,
                    target_lang=target_lang_upper,
                    source_lang=source_lang,
                )
                fresh_google: List[Tuple[str, str, Optional[str]]] = []
                for source_text, result in zip(misses, translated):
                    value = result.get("translated") or ""
                    if not value:
                        continue
                    cache_hits[source_text] = {
                        "translated": value,
                        "source_lang": result.get("detected_source_lang"),
                    }
                    fresh_google.append(
                        (source_text, value, result.get("detected_source_lang"))
                    )
                await self._save_many_to_cache(
                    fresh_google, target_lang_upper, provider="google"
                )
                misses = [t for t in misses if t not in cache_hits]
            except Exception as e:
                # Google unconfigured or failing — fall to the per-item path,
                # which is slower but keeps the single place that knows how to
                # give up gracefully on one text without failing the page.
                logger.warning(f"[batch_translate] batched Google failed, falling back: {e}")

        # ── 3b. Per-item fallback for whatever is still missing ──────────
        # Last resort, one text at a time, so a single bad string cannot take
        # the whole page down with it.
        if misses:
            import asyncio

            semaphore = asyncio.Semaphore(max_concurrent)

            async def resolve(text: str) -> None:
                async with semaphore:
                    try:
                        result = await self.get_translation(
                            text=text,
                            target_lang=target_lang_upper,
                            source_lang=source_lang,
                        )
                        if result.get("translated"):
                            cache_hits[text] = {
                                "translated": result["translated"],
                                "source_lang": result.get("source_lang"),
                            }
                    except Exception as e:
                        logger.error(f"Batch translation failed for '{text}': {e}")

            await asyncio.gather(*[resolve(t) for t in misses])

        # ── 4. Reassemble in input order ─────────────────────────────────
        results: List[Dict[str, Any]] = []
        for original, key in zip(texts, normalized):
            hit = cache_hits.get(key)
            if hit:
                results.append({
                    "source": original.strip(),
                    "translated": hit["translated"],
                    "target_lang": target_lang_upper,
                    "source_lang": hit.get("source_lang"),
                    "cached": True,
                    "provider": "batch",
                })
            else:
                results.append({
                    "source": original.strip(),
                    "error": "translation unavailable",
                    "target_lang": target_lang_upper,
                })

        if user_id:
            # Tracking is per-user bookkeeping, not part of the translation —
            # do it once per unique word rather than inside the hot loop.
            for key in unique_texts:
                hit = cache_hits.get(key)
                if hit:
                    try:
                        await self._track_user_translation(
                            user_id=user_id,
                            word=key,
                            target_lang=target_lang_upper,
                            translation=hit["translated"],
                            provider="batch",
                        )
                    except Exception as e:
                        logger.warning(f"[batch_translate] tracking failed: {e}")

        return results

    async def get_cache_stats(self) -> Dict[str, Any]:
        """Get translation cache statistics"""
        try:
            total = await self.db.translationcache.count()

            # Count by target language
            all_cached = await self.db.translationcache.find_many(
                select={"targetLang": True}
            )
            lang_counts = {}
            for entry in all_cached:
                lang = entry.targetLang
                lang_counts[lang] = lang_counts.get(lang, 0) + 1

            return {
                "total_translations": total,
                "languages": lang_counts,
                "cache_enabled": True,
                "google_fallback_enabled": self.google_client.enabled,
                "deepl_supported_languages": sorted(DEEPL_SUPPORTED_TARGET_LANGS)
            }
        except Exception as e:
            logger.error(f"Failed to get cache stats: {e}")
            return {
                "total_translations": 0,
                "languages": {},
                "cache_enabled": False,
                "google_fallback_enabled": False,
                "deepl_supported_languages": []
            }

    async def get_user_difficult_words(
        self,
        user_id: int,
        target_lang: Optional[str] = None,
        min_attempts: int = 2,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """
        Get words that user has translated multiple times (indicating difficulty)

        Args:
            user_id: User ID
            target_lang: Filter by target language (optional)
            min_attempts: Minimum translation attempts to consider word "difficult" (default: 2)
            limit: Maximum number of words to return (default: 50)

        Returns:
            List of difficult words with translation count and details
        """
        try:
            # Build where clause
            where_clause = {"userId": user_id}
            if target_lang:
                where_clause["targetLang"] = target_lang.upper()

            # Get all translation history for user
            history = await self.db.usertranslationhistory.find_many(
                where=where_clause,
                order={"translatedAt": "desc"}
            )

            # Count translation attempts per word
            word_counts: Dict[str, Dict[str, Any]] = {}
            for entry in history:
                word = entry.word.lower()
                if word not in word_counts:
                    word_counts[word] = {
                        "word": word,
                        "target_lang": entry.targetLang,
                        "translation": entry.translationUsed,
                        "attempt_count": 0,
                        "first_translated": entry.translatedAt,
                        "last_translated": entry.translatedAt,
                        "providers_used": set()
                    }

                word_counts[word]["attempt_count"] += 1
                word_counts[word]["last_translated"] = max(
                    word_counts[word]["last_translated"],
                    entry.translatedAt
                )
                word_counts[word]["first_translated"] = min(
                    word_counts[word]["first_translated"],
                    entry.translatedAt
                )
                if entry.provider:
                    word_counts[word]["providers_used"].add(entry.provider)

            # Filter words with minimum attempts
            difficult_words = [
                {
                    **data,
                    "providers_used": list(data["providers_used"]),
                    "first_translated": data["first_translated"].isoformat(),
                    "last_translated": data["last_translated"].isoformat()
                }
                for word, data in word_counts.items()
                if data["attempt_count"] >= min_attempts
            ]

            # Sort by attempt count (descending)
            difficult_words.sort(key=lambda x: x["attempt_count"], reverse=True)

            return difficult_words[:limit]

        except Exception as e:
            logger.error(f"Failed to get difficult words for user {user_id}: {e}")
            return []

    async def get_user_translation_stats(
        self,
        user_id: int,
        target_lang: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Get user's translation statistics

        Args:
            user_id: User ID
            target_lang: Filter by target language (optional)

        Returns:
            Dict with user translation statistics
        """
        try:
            where_clause = {"userId": user_id}
            if target_lang:
                where_clause["targetLang"] = target_lang.upper()

            total_translations = await self.db.usertranslationhistory.count(
                where=where_clause
            )

            history = await self.db.usertranslationhistory.find_many(
                where=where_clause,
                order={"translatedAt": "desc"}
            )

            # Calculate stats
            unique_words = set(entry.word for entry in history)
            providers = {}
            languages = {}

            for entry in history:
                # Count by provider
                if entry.provider:
                    providers[entry.provider] = providers.get(entry.provider, 0) + 1

                # Count by language
                lang = entry.targetLang
                languages[lang] = languages.get(lang, 0) + 1

            return {
                "user_id": user_id,
                "total_translations": total_translations,
                "unique_words": len(unique_words),
                "languages": languages,
                "providers": providers,
                "most_recent": history[0].translatedAt.isoformat() if history else None
            }

        except Exception as e:
            logger.error(f"Failed to get translation stats for user {user_id}: {e}")
            return {
                "user_id": user_id,
                "total_translations": 0,
                "unique_words": 0,
                "languages": {},
                "providers": {},
                "most_recent": None
            }
