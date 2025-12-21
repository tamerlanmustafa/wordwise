"""
Google Cloud Translate API Client

Provides async translation services using Google Cloud Translate API v2.
Used as fallback when DeepL doesn't support a target language.
"""

import os
import logging
from typing import Dict, Any, Optional
import asyncio
from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger(__name__)

# Google Translate is sync, so we'll use a thread pool for async
_executor = ThreadPoolExecutor(max_workers=4)


class GoogleTranslateError(Exception):
    """Base exception for Google Translate API errors"""
    pass


class GoogleTranslateClient:
    """Async wrapper for Google Cloud Translate API v2"""

    # Class-level flag to track if credential errors have been logged
    _credential_error_logged = False
    _init_warning_logged = False

    def __init__(self, credentials_path: Optional[str] = None):
        self.credentials_path = credentials_path or os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        self.enabled = os.getenv("GOOGLE_TRANSLATE_ENABLED", "false").lower() == "true"
        self._client = None

        # Log init warnings only once per class (not per instance)
        if not GoogleTranslateClient._init_warning_logged:
            if not self.enabled:
                logger.warning("Google Translate is disabled - set GOOGLE_TRANSLATE_ENABLED=true to enable")
            elif not self.credentials_path:
                logger.warning("GOOGLE_APPLICATION_CREDENTIALS not set - Google Translate will not work")
            GoogleTranslateClient._init_warning_logged = True

    def _get_client(self):
        """Lazy initialization of Google Translate client"""
        if self._client is None:
            try:
                from google.cloud import translate_v2 as translate

                # Set credentials path if provided
                if self.credentials_path:
                    if not os.path.exists(self.credentials_path):
                        raise GoogleTranslateError(
                            f"Google credentials file not found: {self.credentials_path}. "
                            f"Please set GOOGLE_APPLICATION_CREDENTIALS to a valid path."
                        )
                    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = self.credentials_path
                    logger.info(f"Using Google credentials from: {self.credentials_path}")
                else:
                    raise GoogleTranslateError(
                        "GOOGLE_APPLICATION_CREDENTIALS not set. "
                        "Please set it to the path of your Google service account JSON file."
                    )

                self._client = translate.Client()
                logger.info("Google Translate client initialized successfully")
            except ImportError:
                logger.error("google-cloud-translate not installed. Install with: pip install google-cloud-translate")
                raise GoogleTranslateError("google-cloud-translate package not installed")
            except GoogleTranslateError:
                raise
            except Exception as e:
                logger.error(f"Failed to initialize Google Translate client: {e}")
                raise GoogleTranslateError(f"Failed to initialize client: {str(e)}")

        return self._client

    def _sync_translate(self, text: str, target_lang: str, source_lang: Optional[str] = None) -> Dict[str, Any]:
        """Synchronous translation using Google Translate"""
        if not self.enabled:
            raise GoogleTranslateError("Google Translate is not enabled")

        if not text or not text.strip():
            return {
                "translated": "",
                "detected_source_lang": None
            }

        try:
            client = self._get_client()

            # Normalize language codes
            target = target_lang.lower()
            source = source_lang.lower() if source_lang and source_lang != "auto" else None

            # Google Translate API call
            result = client.translate(
                text,
                target_language=target,
                source_language=source
            )

            # Extract results
            translated_text = result.get("translatedText", "")
            detected_lang = result.get("detectedSourceLanguage")

            # Convert detected language to uppercase (to match DeepL format)
            if detected_lang:
                detected_lang = detected_lang.upper()

            logger.info(f"Google Translate: '{text}' -> '{translated_text}' ({detected_lang} -> {target_lang.upper()})")

            return {
                "translated": translated_text,
                "detected_source_lang": detected_lang
            }

        except Exception as e:
            # Log errors only once to avoid spam
            if not GoogleTranslateClient._credential_error_logged:
                logger.error(f"Google Translate error: {e}")
                logger.info("Further Google Translate errors will be suppressed")
                GoogleTranslateClient._credential_error_logged = True
            raise GoogleTranslateError(f"Translation failed: {str(e)}")

    async def translate(
        self,
        text: str,
        target_lang: str,
        source_lang: str = "auto"
    ) -> Dict[str, Any]:
        """
        Async translate text using Google Cloud Translate

        Args:
            text: Text to translate
            target_lang: Target language code (e.g., 'az', 'hy', 'ka')
            source_lang: Source language code or 'auto' for detection

        Returns:
            Dict with:
                - translated: Translated text
                - detected_source_lang: Detected source language

        Raises:
            GoogleTranslateError: If translation fails
        """
        # Run sync Google Translate in thread pool
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            _executor,
            self._sync_translate,
            text,
            target_lang,
            source_lang
        )
        return result


async def google_translate(
    text: str,
    target_lang: str,
    source_lang: str = "auto"
) -> Dict[str, Any]:
    """
    Convenience function for Google Translate

    Args:
        text: Text to translate
        target_lang: Target language code
        source_lang: Source language code or 'auto'

    Returns:
        Dict with translated text and detected source language

    Raises:
        GoogleTranslateError: If translation fails
    """
    client = GoogleTranslateClient()
    return await client.translate(text, target_lang, source_lang)
