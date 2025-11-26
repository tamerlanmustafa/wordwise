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
from ..services.translation_service import TranslationService
from ..utils.deepl_client import (
    DeepLError,
    DeepLQuotaExceededError,
    DeepLInvalidLanguageError
)
from ..utils.google_translate_client import GoogleTranslateError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/translate", tags=["translation"])


# Request/Response Models
class TranslationRequest(BaseModel):
    """Request model for single translation"""
    text: str = Field(..., description="Text to translate", max_length=5000)
    target_lang: str = Field(..., description="Target language code (e.g., 'DE', 'FR', 'ES')")
    source_lang: str = Field(default="auto", description="Source language or 'auto' for detection")
    user_id: Optional[int] = Field(None, description="User ID for tracking translation attempts")

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
@router.post("/", response_model=TranslationResponse)
async def translate_text(
    request: TranslationRequest,
    db: Prisma = Depends(get_db)
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
    try:
        service = TranslationService(db)
        result = await service.get_translation(
            text=request.text,
            target_lang=request.target_lang,
            source_lang=request.source_lang,
            user_id=request.user_id
        )

        return TranslationResponse(**result)

    except DeepLQuotaExceededError as e:
        logger.error(f"DeepL quota exceeded: {e}")
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
        logger.error(f"Google Translate error: {e}")
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
    db: Prisma = Depends(get_db)
):
    """
    Translate multiple texts in a single request

    - Efficient batch processing with caching
    - Returns results in same order as input
    - Max 100 texts per request
    - Each text max 5000 characters
    """
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
    db: Prisma = Depends(get_db)
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
    db: Prisma = Depends(get_db)
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
    db: Prisma = Depends(get_db)
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
