"""
DeepL Translation API Client

Provides async translation services using the DeepL API v2.
Supports both free and paid tiers with automatic language detection.
"""

import os
import aiohttp
import logging
from typing import Optional, Dict, Any, List
from enum import Enum

logger = logging.getLogger(__name__)

# DeepL accepts up to 50 `text` entries per /translate call. Batching up to
# this limit is what turns N round trips into one — the API bills characters,
# but each request costs a full network round trip regardless of size.
MAX_TEXTS_PER_REQUEST = 50


class DeepLPlan(str, Enum):
    FREE = "free"
    PAID = "paid"


class DeepLError(Exception):
    """Base exception for DeepL API errors"""
    pass


class DeepLQuotaExceededError(DeepLError):
    """Raised when API quota is exceeded"""
    pass


class DeepLInvalidLanguageError(DeepLError):
    """Raised when an invalid language code is provided"""
    pass


class DeepLClient:
    """Async client for DeepL translation API"""

    def __init__(
        self,
        api_key: Optional[str] = None,
        plan: DeepLPlan = DeepLPlan.FREE,
        timeout: int = 10
    ):
        self.api_key = api_key or os.getenv("DEEPL_API_KEY")
        self.plan = DeepLPlan(os.getenv("DEEPL_PLAN", plan))
        self.timeout = timeout

        if not self.api_key:
            logger.warning("DEEPL_API_KEY not set - translations will return mock data")

        # Select endpoint based on plan
        self.base_url = (
            "https://api-free.deepl.com/v2"
            if self.plan == DeepLPlan.FREE
            else "https://api.deepl.com/v2"
        )

    async def translate(
        self,
        text: str,
        target_lang: str,
        source_lang: str = "auto",
        context: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Translate a single text using DeepL API.

        Thin wrapper over `translate_many` — prefer that when you have more
        than one string, since DeepL bills per character but charges you a
        round trip per *request*.

        Args:
            text: Text to translate (max 5000 chars for free tier)
            target_lang: Target language code (e.g., 'DE', 'FR', 'ES')
            source_lang: Source language code or 'auto' for detection
            context: Optional surrounding text that biases sense selection
                without being translated or billed. Used so a single-word
                lookup ("run") resolves to the sense used in its sentence.

        Returns:
            Dict with:
                - translated: Translated text
                - detected_source_lang: Detected source language

        Raises:
            DeepLQuotaExceededError: If API quota exceeded
            DeepLInvalidLanguageError: If language code invalid
            DeepLError: For other API errors
        """
        results = await self.translate_many(
            texts=[text],
            target_lang=target_lang,
            source_lang=source_lang,
            context=context,
        )
        return results[0]

    async def translate_many(
        self,
        texts: List[str],
        target_lang: str,
        source_lang: str = "auto",
        context: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Translate many texts in as few HTTP requests as possible.

        DeepL accepts up to `MAX_TEXTS_PER_REQUEST` texts per call and returns
        them in request order. Translation time scales with total characters,
        not with the number of texts, so sending 40 short strings in one
        request costs roughly what one string costs — versus 40 round trips
        if you loop over `translate`.

        Empty strings never reach the API but still occupy their slot, so the
        returned list always lines up 1:1 with `texts`.

        Args:
            texts: Texts to translate, in the order results are wanted.
            target_lang: Target language code.
            source_lang: Source language code or 'auto'.
            context: Sense-disambiguation hint applied to the whole batch.
                Only meaningful when every text shares that context, so
                callers translating unrelated strings should leave it unset.

        Raises:
            Same as `translate` — an error on any chunk fails the call.
        """
        target_lang = target_lang.upper()
        cleaned = [(t or "").strip() for t in texts]

        results: List[Optional[Dict[str, Any]]] = [None] * len(cleaned)
        pending: List[int] = []
        for i, text in enumerate(cleaned):
            if text:
                pending.append(i)
            else:
                results[i] = {"translated": "", "detected_source_lang": None}

        if not pending:
            return [r for r in results if r is not None]

        # Mock response if no API key
        if not self.api_key:
            logger.info(f"Mock translation: {len(pending)} text(s) -> {target_lang}")
            for i in pending:
                results[i] = {
                    "translated": f"[MOCK {target_lang}] {cleaned[i]}",
                    "detected_source_lang": "EN",
                }
            return [r for r in results if r is not None]

        for start in range(0, len(pending), MAX_TEXTS_PER_REQUEST):
            slots = pending[start:start + MAX_TEXTS_PER_REQUEST]
            translations = await self._post_translate(
                texts=[cleaned[i] for i in slots],
                target_lang=target_lang,
                source_lang=source_lang,
                context=context,
            )
            # DeepL returns one entry per input, in order. A mismatch means we
            # can no longer trust the pairing, so fail rather than silently
            # attach the wrong translation to a word.
            if len(translations) != len(slots):
                raise DeepLError(
                    f"DeepL returned {len(translations)} translations for "
                    f"{len(slots)} texts"
                )
            for slot, translation in zip(slots, translations):
                results[slot] = {
                    "translated": translation.get("text", ""),
                    "detected_source_lang": translation.get("detected_source_language"),
                }

        return [r for r in results if r is not None]

    async def _post_translate(
        self,
        texts: List[str],
        target_lang: str,
        source_lang: str,
        context: Optional[str],
    ) -> List[Dict[str, Any]]:
        """One DeepL /translate call. Returns the raw `translations` array."""
        url = f"{self.base_url}/translate"
        data = {
            "text": texts,  # DeepL JSON API requires text as array
            "target_lang": target_lang,
        }

        # `context` is a DeepL API hint: it disambiguates the sense of `text`
        # (not translated, not counted toward the character quota).
        if context and context.strip():
            data["context"] = context.strip()

        headers = {
            "Authorization": f"DeepL-Auth-Key {self.api_key}",
            "Content-Type": "application/json"
        }

        if source_lang != "auto":
            data["source_lang"] = source_lang.upper()

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    url,
                    headers=headers,
                    json=data,
                    timeout=aiohttp.ClientTimeout(total=self.timeout)
                ) as response:
                    # Check content type before parsing JSON
                    content_type = response.headers.get('Content-Type', '')

                    # Handle non-JSON responses (error pages, HTML, etc.)
                    if 'application/json' not in content_type:
                        response_text = await response.text()
                        logger.error(f"DeepL returned non-JSON response (status={response.status}, content-type={content_type}): {response_text[:200]}")

                        if response.status == 403:
                            raise DeepLQuotaExceededError(
                                "DeepL API quota exceeded or invalid API key"
                            )
                        elif response.status == 429:
                            raise DeepLQuotaExceededError("Too many requests - rate limit exceeded")
                        elif response.status == 456:
                            raise DeepLQuotaExceededError("DeepL character quota exceeded for this billing period")
                        else:
                            raise DeepLError(
                                f"DeepL API error: {response.status} - unexpected response format"
                            )

                    response_data = await response.json()

                    # Handle errors
                    if response.status == 403:
                        raise DeepLQuotaExceededError(
                            "DeepL API quota exceeded or invalid API key"
                        )
                    elif response.status == 400:
                        error_message = response_data.get("message", "Invalid request")
                        if "target_lang" in error_message or "source_lang" in error_message:
                            raise DeepLInvalidLanguageError(error_message)
                        raise DeepLError(error_message)
                    elif response.status == 429:
                        raise DeepLQuotaExceededError("Too many requests - rate limit exceeded")
                    elif response.status == 456:
                        raise DeepLQuotaExceededError("DeepL character quota exceeded for this billing period")
                    elif response.status != 200:
                        raise DeepLError(
                            f"DeepL API error: {response.status} - {response_data}"
                        )

                    # Extract translations
                    translations = response_data.get("translations", [])
                    if not translations:
                        raise DeepLError("No translations returned from API")

                    return translations

        except aiohttp.ContentTypeError as e:
            # This happens when response.json() fails due to wrong content type
            logger.error(f"DeepL returned invalid content type: {e}")
            raise DeepLError(f"DeepL API returned invalid response format - check API key and quota")
        except aiohttp.ClientError as e:
            logger.error(f"Network error during translation: {e}")
            raise DeepLError(f"Network error: {str(e)}")
        except Exception as e:
            if isinstance(e, DeepLError):
                raise
            logger.error(f"Unexpected error during translation: {e}")
            raise DeepLError(f"Translation failed: {str(e)}")


async def translate_text_deepl(
    text: str,
    target_lang: str,
    source_lang: str = "auto"
) -> str:
    """
    Convenience function to translate text using DeepL

    Args:
        text: Text to translate
        target_lang: Target language code (e.g., 'DE', 'FR', 'ES')
        source_lang: Source language code or 'auto' for detection

    Returns:
        Translated text string

    Raises:
        DeepLError: If translation fails
    """
    client = DeepLClient()
    result = await client.translate(text, target_lang, source_lang)
    return result["translated"]


def normalize_text_for_cache(text: str) -> str:
    """
    Normalize text for cache key consistency

    - Strip leading/trailing whitespace
    - Normalize to lowercase for lookup
    - Remove trailing punctuation for word lookups

    Args:
        text: Input text

    Returns:
        Normalized text
    """
    text = text.strip().lower()

    # Remove trailing punctuation for single words
    # but keep internal punctuation (e.g., "don't")
    if " " not in text and text and text[-1] in ".,!?;:":
        text = text[:-1]

    return text
