"""
Google Cloud Translate API Client

Provides async translation services using Google Cloud Translate API v2.
Used as fallback when DeepL doesn't support a target language.
"""

import os
import logging
from typing import Any, Dict, List, Optional
import asyncio
from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger(__name__)

# Google Translate is sync, so we'll use a thread pool for async
_executor = ThreadPoolExecutor(max_workers=4)

# Texts per Google /translate call. Google's documented ceiling is 128 segments
# per request; 50 matches the DeepL client's chunk so a batch behaves the same
# whichever provider answers it, and keeps a single failed chunk small.
MAX_TEXTS_PER_REQUEST = 50


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
        # Service-account JSON supplied inline rather than as a file. Railway
        # containers have no durable filesystem to drop a key file into, and
        # baking one into the image would mean committing a secret — so the
        # deployed path is this variable, and GOOGLE_APPLICATION_CREDENTIALS
        # stays for local development where a file on disk is the natural form.
        self.credentials_json = os.getenv("GOOGLE_CREDENTIALS_JSON")
        self.enabled = os.getenv("GOOGLE_TRANSLATE_ENABLED", "false").lower() == "true"
        self._client = None

        # Log init warnings only once per class (not per instance)
        if not GoogleTranslateClient._init_warning_logged:
            if not self.enabled:
                logger.warning("Google Translate is disabled - set GOOGLE_TRANSLATE_ENABLED=true to enable")
            elif not (self.credentials_json or self.credentials_path):
                logger.warning(
                    "Neither GOOGLE_CREDENTIALS_JSON nor GOOGLE_APPLICATION_CREDENTIALS "
                    "is set - Google Translate will not work"
                )
            GoogleTranslateClient._init_warning_logged = True

    def _get_client(self):
        """Lazy initialization of Google Translate client"""
        if self._client is None:
            try:
                from google.cloud import translate_v2 as translate

                # Inline JSON wins: it is the deployed form, and if both are
                # present the file is almost certainly a stale local leftover.
                if self.credentials_json:
                    import json

                    from google.oauth2 import service_account

                    try:
                        info = json.loads(self.credentials_json)
                    except ValueError as e:
                        # Pasting a service-account key into a dashboard field
                        # mangles it easily (stripped newlines, added quotes).
                        # Say so plainly instead of surfacing a JSON position.
                        raise GoogleTranslateError(
                            f"GOOGLE_CREDENTIALS_JSON is not valid JSON: {e}. "
                            "Paste the service-account key file's full contents, "
                            "including the surrounding braces."
                        )
                    creds = service_account.Credentials.from_service_account_info(info)
                    self._client = translate.Client(credentials=creds)
                    logger.info(
                        "Google Translate client initialized from GOOGLE_CREDENTIALS_JSON "
                        "(project=%s)", info.get("project_id", "unknown"),
                    )
                    return self._client

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
                        "No Google credentials configured. Set GOOGLE_CREDENTIALS_JSON "
                        "to the service-account key's contents (the deployed form), or "
                        "GOOGLE_APPLICATION_CREDENTIALS to its file path (local dev)."
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

    def _sync_translate_many(
        self,
        texts: List[str],
        target_lang: str,
        source_lang: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Translate many texts in as few API calls as possible.

        Google's v2 client accepts a list and returns results in order, so the
        whole batch is one HTTP round trip. This matters in two places: the
        offline cache warmer pushes tens of thousands of strings through here,
        and — more importantly — this is the path live traffic takes whenever
        DeepL walls out on quota. Before this existed the fallback resolved
        one text at a time behind a semaphore of 2, which turned a 40-item
        feed page into 20 sequential round trips exactly when the system was
        already degraded.

        Empty strings never reach the API but keep their slot, so the result
        lines up 1:1 with `texts`.
        """
        if not self.enabled:
            raise GoogleTranslateError("Google Translate is not enabled")

        cleaned = [(t or "").strip() for t in texts]
        results: List[Optional[Dict[str, Any]]] = [None] * len(cleaned)
        pending = [i for i, t in enumerate(cleaned) if t]
        for i, t in enumerate(cleaned):
            if not t:
                results[i] = {"translated": "", "detected_source_lang": None}

        if not pending:
            return [r for r in results if r is not None]

        try:
            client = self._get_client()
            target = target_lang.lower()
            source = source_lang.lower() if source_lang and source_lang != "auto" else None

            for start in range(0, len(pending), MAX_TEXTS_PER_REQUEST):
                slots = pending[start : start + MAX_TEXTS_PER_REQUEST]
                raw = client.translate(
                    [cleaned[i] for i in slots],
                    target_language=target,
                    source_language=source,
                )
                # A single-item list can come back as a bare dict.
                if isinstance(raw, dict):
                    raw = [raw]
                # Order is the contract. A length mismatch means we can no
                # longer trust the pairing, so fail rather than attach the
                # wrong translation to a word permanently in the cache.
                if len(raw) != len(slots):
                    raise GoogleTranslateError(
                        f"Google returned {len(raw)} translations for {len(slots)} texts"
                    )
                for slot, item in zip(slots, raw):
                    detected = item.get("detectedSourceLanguage")
                    results[slot] = {
                        "translated": item.get("translatedText", ""),
                        "detected_source_lang": detected.upper() if detected else None,
                    }

            return [r for r in results if r is not None]

        except GoogleTranslateError:
            raise
        except Exception as e:
            if not GoogleTranslateClient._credential_error_logged:
                logger.error(f"Google Translate batch error: {e}")
                logger.info("Further Google Translate errors will be suppressed")
                GoogleTranslateClient._credential_error_logged = True
            raise GoogleTranslateError(f"Batch translation failed: {str(e)}")

    async def translate_many(
        self,
        texts: List[str],
        target_lang: str,
        source_lang: str = "auto",
    ) -> List[Dict[str, Any]]:
        """Async wrapper for `_sync_translate_many`.

        The Google SDK is synchronous, so it runs in a thread — the API is a
        single uvicorn process and calling it inline would stall every other
        request for the duration (see CLAUDE.md, backend concurrency).
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            _executor,
            self._sync_translate_many,
            texts,
            target_lang,
            source_lang,
        )

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
