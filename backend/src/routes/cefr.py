"""
CEFR Classification API Routes

Endpoints for classifying words and texts with CEFR levels
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional, Dict
from pathlib import Path
import logging

from src.services.cefr_classifier import (
    HybridCEFRClassifier,
    CEFRLevel,
    ClassificationSource,
    WordClassification
)
from src.database import get_db
from prisma import Prisma

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/cefr", tags=["CEFR Classification"])

# Global classifier instance (initialized on startup)
_classifier: Optional[HybridCEFRClassifier] = None


def get_classifier() -> HybridCEFRClassifier:
    """Get or initialize the CEFR classifier"""
    global _classifier

    if _classifier is None:
        backend_dir = Path(__file__).parent.parent.parent
        data_dir = backend_dir / "data" / "cefr"

        logger.info("Initializing CEFR classifier...")
        _classifier = HybridCEFRClassifier(
            data_dir=data_dir,
            use_embedding_classifier=True
        )
        logger.info("CEFR classifier initialized")

    return _classifier


# === Request/Response Models ===

class WordClassificationRequest(BaseModel):
    """Request to classify a single word"""
    word: str = Field(..., description="Word to classify")
    pos: Optional[str] = Field(None, description="Part of speech (optional)")


class WordClassificationResponse(BaseModel):
    """Response with word classification"""
    word: str
    lemma: str
    pos: str
    cefr_level: str
    confidence: float
    source: str
    frequency_rank: Optional[int] = None
    is_multi_word: bool = False


class TextClassificationRequest(BaseModel):
    """Request to classify all words in a text"""
    text: str = Field(..., description="Text to analyze")
    include_statistics: bool = Field(True, description="Include statistics in response")


class TextClassificationResponse(BaseModel):
    """Response with text classification results"""
    classifications: List[WordClassificationResponse]
    statistics: Optional[Dict] = None


class ScriptClassificationRequest(BaseModel):
    """Request to classify a movie script"""
    movie_id: int = Field(..., description="Movie ID from database")
    save_to_db: bool = Field(True, description="Save classifications to database")


class ScriptClassificationResponse(BaseModel):
    """Response with script classification results"""
    movie_id: int
    script_id: int
    total_words: int
    unique_words: int
    level_distribution: Dict[str, int]
    average_confidence: float
    wordlist_coverage: float
    top_words_by_level: Dict[str, List[Dict]]


class FrequencyThresholdUpdate(BaseModel):
    """Update frequency thresholds for CEFR mapping"""
    A1: tuple[int, int] = Field((0, 1000))
    A2: tuple[int, int] = Field((1000, 2000))
    B1: tuple[int, int] = Field((2000, 5000))
    B2: tuple[int, int] = Field((5000, 10000))
    C1: tuple[int, int] = Field((10000, 20000))
    C2: tuple[int, int] = Field((20000, 999999))


# === Endpoints ===

@router.post("/classify-word", response_model=WordClassificationResponse)
async def classify_word(request: WordClassificationRequest):
    """
    Classify a single word with CEFR level
    """
    try:
        classifier = get_classifier()
        result = classifier.classify_word(request.word, request.pos)

        return WordClassificationResponse(
            word=result.word,
            lemma=result.lemma,
            pos=result.pos,
            cefr_level=result.cefr_level.value,
            confidence=result.confidence,
            source=result.source.value,
            frequency_rank=result.frequency_rank,
            is_multi_word=result.is_multi_word
        )

    except Exception as e:
        logger.error(f"Error classifying word '{request.word}': {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/classify-text", response_model=TextClassificationResponse)
async def classify_text(request: TextClassificationRequest):
    """
    Classify all words in a text
    """
    try:
        classifier = get_classifier()
        classifications = classifier.classify_text(request.text)

        response_classifications = [
            WordClassificationResponse(
                word=cls.word,
                lemma=cls.lemma,
                pos=cls.pos,
                cefr_level=cls.cefr_level.value,
                confidence=cls.confidence,
                source=cls.source.value,
                frequency_rank=cls.frequency_rank,
                is_multi_word=cls.is_multi_word
            )
            for cls in classifications
        ]

        statistics = classifier.get_statistics(classifications) if request.include_statistics else None

        return TextClassificationResponse(
            classifications=response_classifications,
            statistics=statistics
        )

    except Exception as e:
        logger.error(f"Error classifying text: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/classify-script", response_model=ScriptClassificationResponse)
async def classify_script(
    request: ScriptClassificationRequest,
    db: Prisma = Depends(get_db)
):
    """
    Classify an entire movie script from the database
    """
    try:
        movie = await db.movie.find_unique(
            where={'id': request.movie_id},
            include={'movieScripts': True}
        )

        if not movie:
            raise HTTPException(status_code=404, detail=f"Movie {request.movie_id} not found")

        if not movie.movieScripts:
            raise HTTPException(
                status_code=404,
                detail=f"No script found for movie {request.movie_id}"
            )

        script = movie.movieScripts[0]

        if not script.cleanedScriptText:
            raise HTTPException(
                status_code=400,
                detail="Script has no cleaned text"
            )

        classifier = get_classifier()

        existing_classifications = await db.wordclassification.find_many(
            where={'scriptId': script.id}
        )

        # Use cache if exists
        if existing_classifications:
            logger.info(f"✓ Using cached classifications for script {script.id} ({len(existing_classifications)} entries)")

            from src.services.cefr_classifier import WordClassification, CEFRLevel, ClassificationSource
            classifications = [
                WordClassification(
                    word=cls.word,
                    lemma=cls.lemma,
                    pos=cls.pos or "",
                    cefr_level=CEFRLevel(cls.cefrLevel),
                    confidence=cls.confidence,
                    source=ClassificationSource(cls.source),
                    frequency_rank=cls.frequencyRank
                )
                for cls in existing_classifications
            ]
        else:
            # FIXED: use cleanedWordCount instead of nonexistent wordCount
            logger.info(
                f"Classifying script for movie {request.movie_id} "
                f"({script.cleanedWordCount} words)..."
            )

            classifications = classifier.classify_text(script.cleanedScriptText)

        # Compute statistics
        statistics = classifier.get_statistics(classifications)

        # Top words by CEFR level
        level_groups = {}
        for cls in classifications:
            level = cls.cefr_level.value
            if level not in level_groups:
                level_groups[level] = []

            level_groups[level].append({
                'word': cls.word,
                'lemma': cls.lemma,
                'confidence': cls.confidence,
                'frequency_rank': cls.frequency_rank
            })

        top_words_by_level = {
            level: sorted(words, key=lambda x: x['confidence'], reverse=True)[:20]
            for level, words in level_groups.items()
        }

        # Save to database (only if NOT cached)
        if request.save_to_db and not existing_classifications:
            logger.info(f"Saving {len(classifications)} classifications to DB...")

            unique = {}
            for cls in classifications:
                key = (cls.lemma, cls.cefr_level.value)
                if key not in unique:
                    unique[key] = cls

            batch_size = 300
            cls_list = list(unique.values())

            for start in range(0, len(cls_list), batch_size):
                batch = cls_list[start:start + batch_size]

                await db.wordclassification.create_many(
                    data=[
                        {
                            'scriptId': script.id,
                            'word': cls.word,
                            'lemma': cls.lemma,
                            'pos': cls.pos or None,
                            'cefrLevel': cls.cefr_level.value,
                            'confidence': cls.confidence,
                            'source': cls.source.value,
                            'frequencyRank': cls.frequency_rank,
                        }
                        for cls in batch
                    ],
                    skip_duplicates=True
                )

            logger.info("✓ Word classifications saved.")

        # Final response
        script_word_count = script.cleanedWordCount or 0
        unique_words = len(set(cls.lemma for cls in classifications))

        return ScriptClassificationResponse(
            movie_id=request.movie_id,
            script_id=script.id,
            total_words=script_word_count,
            unique_words=unique_words,
            level_distribution=statistics['level_distribution'],
            average_confidence=statistics['average_confidence'],
            wordlist_coverage=statistics['wordlist_coverage'],
            top_words_by_level=top_words_by_level
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error classifying script: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/statistics/{movie_id}")
async def get_script_statistics(movie_id: int, db: Prisma = Depends(get_db)):
    """
    Get CEFR statistics for a previously classified script
    """
    try:
        movie = await db.movie.find_unique(
            where={'id': movie_id},
            include={'movieScripts': True}
        )

        if not movie or not movie.movieScripts:
            raise HTTPException(status_code=404, detail=f"Movie {movie_id} not found")

        script = movie.movieScripts[0]

        classifications = await db.wordclassification.find_many(
            where={'scriptId': script.id}
        )

        if not classifications:
            raise HTTPException(
                status_code=404,
                detail=f"No classifications found for movie {movie_id}. Run /classify-script first."
            )

        level_counts = {}
        total_conf = 0

        for cls in classifications:
            level_counts[cls.cefrLevel] = level_counts.get(cls.cefrLevel, 0) + 1
            total_conf += cls.confidence

        return {
            'movie_id': movie_id,
            'script_id': script.id,
            'total_words': len(classifications),
            'level_distribution': level_counts,
            'average_confidence': total_conf / len(classifications),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting statistics: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/update-thresholds")
async def update_frequency_thresholds(thresholds: FrequencyThresholdUpdate):
    """
    Modify frequency thresholds used to map ranks → CEFR levels
    """
    try:
        classifier = get_classifier()

        threshold_dict = {
            CEFRLevel.A1: thresholds.A1,
            CEFRLevel.A2: thresholds.A2,
            CEFRLevel.B1: thresholds.B1,
            CEFRLevel.B2: thresholds.B2,
            CEFRLevel.C1: thresholds.C1,
            CEFRLevel.C2: thresholds.C2,
        }

        classifier.update_frequency_thresholds(threshold_dict)

        return {
            'status': 'success',
            'message': 'Frequency thresholds updated',
            'thresholds': {k.value: v for k, v in threshold_dict.items()}
        }

    except Exception as e:
        logger.error(f"Error updating thresholds: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health")
async def health_check():
    """
    Health check for CEFR classifier
    """
    try:
        classifier = get_classifier()
        return {
            'status': 'healthy',
            'wordlist_entries': len(classifier.cefr_wordlist),
            'multi_word_expressions': len(classifier.multi_word_expressions),
            'has_frequency_data': classifier.has_wordfreq,
            'has_embedding_classifier': classifier.has_embedding_classifier
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(status_code=503, detail="Classifier not available")
