"""
DeepL Translation API Client

Provides async translation services using the DeepL API v2.
Supports both free and paid tiers with automatic language detection.
"""

import os
import aiohttp
import logging
from typing import Optional, Dict, Any
from enum import Enum

logger = logging.getLogger(__name__)


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
        source_lang: str = "auto"
    ) -> Dict[str, Any]:
        """
        Translate text using DeepL API

        Args:
            text: Text to translate (max 5000 chars for free tier)
            target_lang: Target language code (e.g., 'DE', 'FR', 'ES')
            source_lang: Source language code or 'auto' for detection

        Returns:
            Dict with:
                - translated: Translated text
                - detected_source_lang: Detected source language

        Raises:
            DeepLQuotaExceededError: If API quota exceeded
            DeepLInvalidLanguageError: If language code invalid
            DeepLError: For other API errors
        """
        # Normalize input
        text = text.strip()
        target_lang = target_lang.upper()

        # Handle empty text
        if not text:
            return {
                "translated": "",
                "detected_source_lang": None
            }

        # Mock response if no API key
        if not self.api_key:
            logger.info(f"Mock translation: '{text}' -> {target_lang}")
            return {
                "translated": f"[MOCK {target_lang}] {text}",
                "detected_source_lang": "EN"
            }

        # Prepare request
        url = f"{self.base_url}/translate"
        data = {
            "auth_key": self.api_key,  
            "text": text,
            "target_lang": target_lang,
            "enable_beta_languages": "true",
        }

        headers = {
            "Content-Type": "application/x-www-form-urlencoded"
        }

        if source_lang != "auto":
            data["source_lang"] = source_lang.upper()

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    url,
                    headers=headers,
                    data=data,
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

                    # Extract translation
                    translations = response_data.get("translations", [])
                    if not translations:
                        raise DeepLError("No translations returned from API")

                    translation = translations[0]
                    return {
                        "translated": translation.get("text", ""),
                        "detected_source_lang": translation.get("detected_source_language")
                    }

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
