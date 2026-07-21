"""
Translation API Routes

Provides endpoints for text translation using DeepL API with caching.
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field, validator
from typing import Optional, List, Dict, Any
import logging

from prisma import Prisma
from ..database import get_db
from ..middleware.auth import get_current_active_user, get_admin_user
from ..utils.rate_limit import rate_limit
from ..services.translation_service import TranslationService
from ..utils.deepl_client import (
    DeepLError,
    DeepLQuotaExceededError,
    DeepLInvalidLanguageError
)
from ..utils.google_translate_client import GoogleTranslateError

logger = logging.getLogger(__name__)

# Module-level flags to suppress repeated error logs
_google_error_logged = False
_deepl_quota_error_logged = False

router = APIRouter(prefix="/translate", tags=["translation"])

# Translation hits paid MT providers (DeepL/Google), so cap per-caller volume
# even for logged-in users to bound runaway cost from a compromised/abusive
# client. Keyed by user id when authenticated.
_translate_throttle = rate_limit(120, 60.0, scope="translate")
_translate_batch_throttle = rate_limit(30, 60.0, scope="translate-batch")


# Request/Response Models
class TranslationRequest(BaseModel):
    """Request model for single translation"""
    text: str = Field(..., description="Text to translate", max_length=5000)
    target_lang: str = Field(..., description="Target language code (e.g., 'DE', 'FR', 'ES')")
    source_lang: str = Field(default="auto", description="Source language or 'auto' for detection")
    user_id: Optional[int] = Field(None, description="User ID for tracking translation attempts")
    sentence: Optional[str] = Field(None, description="Context sentence (for V2 sense-aware translation)")
    movie_id: Optional[int] = Field(None, description="Movie ID (for V2 dominant sense fallback)")

    @validator('text')
    def validate_text(cls, v):
        if not v or not v.strip():
            raise ValueError("Text cannot be empty")
        return v.strip()

    @validator('target_lang', 'source_lang')
    def validate_lang_code(cls, v):
        if v and v.lower() != "auto":
            # Basic validation - DeepL will validate supported languages
            if len(v) < 2 or len(v) > 5:
                raise ValueError("Invalid language code format")
        return v.upper() if v.lower() != "auto" else v.lower()


class BatchTranslationRequest(BaseModel):
    """Request model for batch translation"""
    texts: List[str] = Field(..., description="List of texts to translate", max_items=2000)
    target_lang: str = Field(..., description="Target language code")
    source_lang: str = Field(default="auto", description="Source language or 'auto'")
    user_id: Optional[int] = Field(None, description="User ID for tracking translation attempts")

    @validator('texts')
    def validate_texts(cls, v):
        if not v:
            raise ValueError("Texts list cannot be empty")
        if len(v) > 2000:
            raise ValueError("Maximum 2000 texts per batch request")

        # Ensure all items are strings
        if not all(isinstance(text, str) for text in v):
            raise ValueError("All texts must be strings")

        # Filter out empty/whitespace-only strings
        cleaned = [text.strip() for text in v if text.strip()]
        # Verify we still have texts after filtering
        if not cleaned:
            raise ValueError("Texts list cannot contain only empty strings")
        return cleaned


class TranslationResponse(BaseModel):
    """Response model for translation"""
    source: str = Field(..., description="Original text")
    translated: str = Field(..., description="Translated text")
    target_lang: str = Field(..., description="Target language code")
    source_lang: Optional[str] = Field(None, description="Detected source language")
    cached: bool = Field(..., description="Whether result came from cache")
    provider: Optional[str] = Field(None, description="Translation provider used (deepl, google, cache)")
    created_at: Optional[str] = Field(None, description="Cache entry timestamp (ISO format)")
    # V2 fields (optional, present when sense-aware translation is used)
    lemma: Optional[str] = Field(None, description="Lemma form of the word")
    sense_id: Optional[int] = Field(None, description="WordSense ID used for translation")
    sense_label: Optional[str] = Field(None, description="Human-readable sense label")
    translated_sentence: Optional[str] = Field(None, description="Translation of the representative sentence")


class BatchTranslationResponse(BaseModel):
    """Response model for batch translation"""
    results: List[TranslationResponse]
    total: int
    cached_count: int
    api_calls: int


class CacheStatsResponse(BaseModel):
    """Response model for cache statistics"""
    total_translations: int
    languages: dict
    cache_enabled: bool


# Routes
#
# Registered at the prefix root with no trailing slash ("" not "/") so the
# canonical path is exactly `/translate` — what both the web and mobile
# clients call. With "/" the path is `/translate/`, and a client request to
# `/translate` gets a 307 redirect to add the slash; React Native's fetch
# drops the Authorization header when following that redirect, so the
# retried request 401s. Matches the `@router.post("")` convention in
# interactions.py.
@router.post("", response_model=TranslationResponse)
async def translate_text(
    request: TranslationRequest,
    db: Prisma = Depends(get_db),
    current_user=Depends(get_current_active_user),
    _: None = Depends(_translate_throttle),
):
    """
    Translate text to target language

    - Automatically caches translations to minimize API calls
    - Returns cached result if available
    - Detects source language if not specified
    - Supports all DeepL language pairs

    **Language Codes:**
    - English: EN
    - German: DE
    - French: FR
    - Spanish: ES
    - Italian: IT
    - Dutch: NL
    - Polish: PL
    - Portuguese: PT
    - Russian: RU
    - Japanese: JA
    - Chinese: ZH
    - And many more...

    **Rate Limits:**
    - Free tier: 500,000 characters/month
    - Check DeepL documentation for latest limits
    """
    # Attribution comes from the verified token, not the client-supplied
    # body — otherwise a caller could write attempts to any user's history.
    request.user_id = current_user.id
    try:
        # V2: Try TranslationMemory first (sense-aware, zero API cost)
        if request.sentence or request.movie_id:
            try:
                from ..services.translation_memory_service import TranslationMemoryService
                tm_service = TranslationMemoryService(db)
                v2_result = await tm_service.translate_on_demand(
                    word=request.text,
                    clicked_sentence=request.sentence,
                    target_lang=request.target_lang,
                    movie_id=request.movie_id,
                )
                if v2_result:
                    return TranslationResponse(
                        source=request.text,
                        translated=v2_result["translated_word"],
                        target_lang=v2_result["target_lang"],
                        source_lang="EN",
                        cached=True,
                        provider=v2_result["provider"],
                        lemma=v2_result["lemma"],
                        sense_id=v2_result["sense_id"],
                        sense_label=v2_result.get("sense_label"),
                        translated_sentence=v2_result.get("translated_sentence"),
                    )
            except Exception as e:
                logger.debug(f"V2 translation lookup failed (non-fatal): {e}")

        # V1 fallback: standard translation flow. Pass the clicked sentence as
        # a DeepL `context` hint so an ambiguous word ("run") resolves to the
        # sense it carries in that sentence, matching the sentence translation
        # shown alongside it. (V2 sense-aware memory is dormant in prod, so
        # this fallback is the path nearly every word takes.)
        service = TranslationService(db)
        result = await service.get_translation(
            text=request.text,
            target_lang=request.target_lang,
            source_lang=request.source_lang,
            user_id=request.user_id,
            context=request.sentence
        )

        return TranslationResponse(**result)

    except DeepLQuotaExceededError as e:
        global _deepl_quota_error_logged
        if not _deepl_quota_error_logged:
            logger.error(f"DeepL quota exceeded: {e}")
            _deepl_quota_error_logged = True
        raise HTTPException(
            status_code=429,
            detail="Translation quota exceeded. Please try again later or upgrade your DeepL plan."
        )
    except DeepLInvalidLanguageError as e:
        logger.error(f"Invalid language: {e}")
        raise HTTPException(
            status_code=400,
            detail=f"Invalid language code: {str(e)}"
        )
    except GoogleTranslateError as e:
        global _google_error_logged
        if not _google_error_logged:
            logger.error(f"Google Translate error: {e}")
            _google_error_logged = True
        raise HTTPException(
            status_code=500,
            detail=f"Translation failed (Google fallback): {str(e)}"
        )
    except DeepLError as e:
        logger.error(f"Translation error: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Translation failed: {str(e)}"
        )
    except Exception as e:
        logger.error(f"Unexpected error in translation: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="An unexpected error occurred during translation"
        )


@router.post("/batch", response_model=BatchTranslationResponse)
async def translate_batch(
    request: BatchTranslationRequest,
    db: Prisma = Depends(get_db),
    current_user=Depends(get_current_active_user),
    _: None = Depends(_translate_batch_throttle),
):
    """
    Translate multiple texts in a single request

    - Efficient batch processing with caching
    - Returns results in same order as input
    - Max 100 texts per request
    - Each text max 5000 characters
    """
    # Attribution comes from the verified token, not the client body.
    request.user_id = current_user.id
    logger.info(f"[BATCH TRANSLATE] Received {len(request.texts)} texts, target={request.target_lang}")
    logger.debug(f"[BATCH TRANSLATE] First 5 texts: {request.texts[:5]}")
    try:
        service = TranslationService(db)
        results = await service.batch_translate(
            texts=request.texts,
            target_lang=request.target_lang,
            source_lang=request.source_lang,
            user_id=request.user_id
        )

        # Count cached vs API calls
        cached_count = sum(1 for r in results if r.get("cached", False))
        api_calls = len(results) - cached_count

        # Filter out errors for response
        valid_results = [
            TranslationResponse(**r) for r in results if "error" not in r
        ]

        return BatchTranslationResponse(
            results=valid_results,
            total=len(valid_results),
            cached_count=cached_count,
            api_calls=api_calls
        )

    except DeepLQuotaExceededError as e:
        raise HTTPException(
            status_code=429,
            detail="Translation quota exceeded"
        )
    except Exception as e:
        logger.error(f"Batch translation error: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Batch translation failed: {str(e)}"
        )


@router.get("/cache/stats", response_model=CacheStatsResponse)
async def get_cache_statistics(db: Prisma = Depends(get_db)):
    """
    Get translation cache statistics

    Returns:
    - Total number of cached translations
    - Breakdown by target language
    - Cache status
    """
    try:
        service = TranslationService(db)
        stats = await service.get_cache_stats()
        return CacheStatsResponse(**stats)

    except Exception as e:
        logger.error(f"Failed to get cache stats: {e}")
        raise HTTPException(
            status_code=500,
            detail="Failed to retrieve cache statistics"
        )


@router.delete("/cache")
async def clear_translation_cache(
    target_lang: Optional[str] = None,
    db: Prisma = Depends(get_db),
    admin_user=Depends(get_admin_user),
):
    """
    Clear translation cache

    - If target_lang provided: Clear only that language
    - If not provided: Clear entire cache

    **Use with caution!** This will force API calls for all future translations.
    """
    try:
        if target_lang:
            target_lang = target_lang.upper()
            deleted = await db.translationcache.delete_many(
                where={"targetLang": target_lang}
            )
            return {
                "message": f"Cleared {deleted} translations for language {target_lang}",
                "language": target_lang,
                "count": deleted
            }
        else:
            deleted = await db.translationcache.delete_many()
            return {
                "message": f"Cleared entire cache ({deleted} translations)",
                "count": deleted
            }

    except Exception as e:
        logger.error(f"Failed to clear cache: {e}")
        raise HTTPException(
            status_code=500,
            detail="Failed to clear translation cache"
        )


@router.get("/health")
async def translation_health_check():
    """
    Check translation service health

    Returns service status and configuration
    """
    import os

    api_key_configured = bool(os.getenv("DEEPL_API_KEY"))
    plan = os.getenv("DEEPL_PLAN", "free")

    return {
        "status": "healthy",
        "api_configured": api_key_configured,
        "plan": plan,
        "mock_mode": not api_key_configured,
        "message": "Translation service is operational" if api_key_configured
                   else "Running in mock mode - configure DEEPL_API_KEY for real translations"
    }


# User Analytics Endpoints
class DifficultWordsResponse(BaseModel):
    """Response model for difficult words"""
    words: List[Dict[str, Any]]
    total: int
    min_attempts: int


class UserStatsResponse(BaseModel):
    """Response model for user translation statistics"""
    user_id: int
    total_translations: int
    unique_words: int
    languages: Dict[str, int]
    providers: Dict[str, int]
    most_recent: Optional[str]


@router.get("/user/{user_id}/difficult-words", response_model=DifficultWordsResponse)
async def get_difficult_words(
    user_id: int,
    target_lang: Optional[str] = None,
    min_attempts: int = 2,
    limit: int = 50,
    db: Prisma = Depends(get_db),
    current_user=Depends(get_current_active_user),
):
    """
    Get words that user has translated multiple times (indicating difficulty)

    This endpoint helps identify which words are harder for the user to learn
    by tracking how many times they've looked up the same word.

    Args:
        user_id: User ID
        target_lang: Filter by target language (optional)
        min_attempts: Minimum translation attempts to consider word "difficult" (default: 2)
        limit: Maximum number of words to return (default: 50)

    Returns:
        List of difficult words sorted by attempt count (highest first)
    """
    # A user may only read their own translation history.
    if user_id != current_user.id and not current_user.isAdmin:
        raise HTTPException(status_code=403, detail="Forbidden")
    try:
        service = TranslationService(db)
        words = await service.get_user_difficult_words(
            user_id=user_id,
            target_lang=target_lang,
            min_attempts=min_attempts,
            limit=limit
        )

        return DifficultWordsResponse(
            words=words,
            total=len(words),
            min_attempts=min_attempts
        )

    except Exception as e:
        logger.error(f"Failed to get difficult words for user {user_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail="Failed to retrieve difficult words"
        )


@router.get("/user/{user_id}/stats", response_model=UserStatsResponse)
async def get_user_translation_stats(
    user_id: int,
    target_lang: Optional[str] = None,
    db: Prisma = Depends(get_db),
    current_user=Depends(get_current_active_user),
):
    """
    Get user's translation statistics

    Returns overview of user's translation activity including:
    - Total number of translations
    - Number of unique words translated
    - Breakdown by language and provider
    - Most recent translation timestamp

    Args:
        user_id: User ID
        target_lang: Filter by target language (optional)

    Returns:
        User translation statistics
    """
    # A user may only read their own translation stats.
    if user_id != current_user.id and not current_user.isAdmin:
        raise HTTPException(status_code=403, detail="Forbidden")
    try:
        service = TranslationService(db)
        stats = await service.get_user_translation_stats(
            user_id=user_id,
            target_lang=target_lang
        )

        return UserStatsResponse(**stats)

    except Exception as e:
        logger.error(f"Failed to get translation stats for user {user_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail="Failed to retrieve user statistics"
        )
