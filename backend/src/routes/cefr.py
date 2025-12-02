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

# Master exclusion list - ultra-common A1 words that all learners know
# These are filtered out to show only meaningful vocabulary
EXCLUDED_A1_WORDS = {
    "a","an","the","i","you","he","she","it","we","they","me","him","her","us","them",
    "my","your","his","its","our","their","mine","yours","hers","ours","theirs",
    "this","that","these","those","here","there",
    "and","or","but","nor","so","yet","either","neither",
    "if","then","because","when","while","before","after","since","although",
    "in","on","at","by","to","for","of","from","with","without","into","out","over","under",
    "up","down","around","through","across","between","among","off","onto",
    "within","beyond","inside","outside","beside","behind","above","below",
    "is","am","are","was","were","be","been","being",
    "have","has","had","do","does","did",
    "can","could","should","would","will","may","might","must","shall",
    "not","no","yes","maybe","very","really","so","quite","just","only","even","still","already","almost",
    "who","what","when","where","why","how","which","whose",
    "any","some","many","few","each","every","another","other","both","all","most",
    "good","bad","big","small","little","large","old","young","new","long","short",
    "right","left","sure","true","false",
    "man","woman","boy","girl","people","person","friend","family",
    "time","day","night","morning","evening","afternoon","life","world","place",
    "thing","way","work","home","school","house","room","hand","head","face",
    "body","mother","father","brother","sister","child","children",
    "come","go","get","make","do","say","tell","see","look","watch","want","need",
    "know","think","feel","give","take","use","put","keep","find","try","leave",
    "call","ask","answer","mean","let",
    "zero","one","two","three","four","five","six","seven","eight","nine","ten",
    "eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen",
    "eighteen","nineteen","twenty",
    "monday","tuesday","wednesday","thursday","friday","saturday","sunday",
    "january","february","march","april","may","june","july","august","september",
    "october","november","december","spring","summer","autumn","fall","winter",
    "red","blue","green","yellow","black","white","brown","orange","purple",
    "pink","gray","grey",
    "today","yesterday","tomorrow","now","later","soon","always","never",
    "sometimes","often",
    "back","front","top","bottom","inside","outside","far","near","close",
    "hello","hi","bye","okay","ok","thanks","thank","please",
    "mr","mrs","ms","miss","sir","ma'am"
}


def should_keep_word(word: str, lemma: str, cefr_level: str) -> bool:
    """
    Filter out ultra-common A1 words that all learners already know.

    Args:
        word: The word token
        lemma: The lemmatized form
        cefr_level: CEFR level (A1, A2, B1, B2, C1, C2)

    Returns:
        True if word should be shown to user, False if it should be filtered out
    """
    # If it's not A1 → always keep
    if cefr_level != "A1":
        return True

    # Normalize for comparison
    w = word.lower().strip()
    l = lemma.lower().strip() if lemma else w

    # Hide ultra-common A1 words
    if w in EXCLUDED_A1_WORDS or l in EXCLUDED_A1_WORDS:
        return False

    return True


def get_classifier() -> HybridCEFRClassifier:
    """Get or initialize the CEFR classifier"""
    global _classifier

    if _classifier is None:
        backend_dir = Path(__file__).parent.parent.parent
        data_dir = backend_dir / "data" / "cefr"

        logger.info("Initializing CEFR classifier...")
        _classifier = HybridCEFRClassifier(
            data_dir=data_dir,
            use_embedding_classifier=False
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
    """
    Response with script classification results.

    Note: Ultra-common A1 words (articles, pronouns, basic prepositions, etc.)
    are filtered out to show only meaningful vocabulary that learners need to study.
    """
    movie_id: int
    script_id: int
    total_words: int
    unique_words: int
    level_distribution: Dict[str, int]
    average_confidence: float
    wordlist_coverage: float
    top_words_by_level: Dict[str, List[Dict]]  # All words sorted by frequency_rank (easier to harder)


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
    Classify an entire movie script from the database.

    PERFORMANCE OPTIMIZATION:
    If classifications already exist in DB, returns cached data immediately
    WITHOUT initializing the CEFR classifier or loading any word lists.
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

        # ========================================================================
        # CRITICAL PERFORMANCE OPTIMIZATION: Check cache BEFORE classifier init
        # ========================================================================
        existing_classifications = await db.wordclassification.find_many(
            where={'scriptId': script.id}
        )

        # ========================================================================
        # FAST PATH: Return cached data immediately (no classifier initialization)
        # ========================================================================
        if existing_classifications:
            logger.info(
                f"✓ FAST PATH: Using cached classifications for script {script.id} "
                f"({len(existing_classifications)} entries) - NO classifier initialization"
            )

            # Build level distribution and top words directly from DB data
            level_groups = {}
            level_distribution = {"A1": 0, "A2": 0, "B1": 0, "B2": 0, "C1": 0, "C2": 0}
            total_confidence = 0.0

            for cls in existing_classifications:
                level = cls.cefrLevel if isinstance(cls.cefrLevel, str) else cls.cefrLevel.value

                # Apply word filter
                if not should_keep_word(cls.word, cls.lemma, level):
                    continue

                level_distribution[level] = level_distribution.get(level, 0) + 1
                total_confidence += cls.confidence

                if level not in level_groups:
                    level_groups[level] = []

                level_groups[level].append({
                    'word': cls.word,
                    'lemma': cls.lemma,
                    'confidence': cls.confidence,
                    'frequency_rank': cls.frequencyRank
                })

            # Sort by frequency_rank (easier to harder)
            top_words_by_level = {
                level: sorted(
                    words,
                    key=lambda x: (x['frequency_rank'] is None, x['frequency_rank'] or 999999)
                )
                for level, words in level_groups.items()
            }

            # Calculate average confidence
            total_kept = sum(level_distribution.values())
            average_confidence = total_confidence / total_kept if total_kept > 0 else 0.0

            # Return immediately without initializing classifier
            return ScriptClassificationResponse(
                movie_id=request.movie_id,
                script_id=script.id,
                total_words=script.cleanedWordCount or 0,
                unique_words=len(set(cls.lemma for cls in existing_classifications)),
                level_distribution=level_distribution,
                average_confidence=average_confidence,
                wordlist_coverage=0.0,  # Not computed for cached data
                top_words_by_level=top_words_by_level
            )

        # ========================================================================
        # SLOW PATH: No cache exists, initialize classifier and process script
        # ========================================================================
        logger.info(
            f"SLOW PATH: No cache found. Initializing classifier and processing script "
            f"for movie {request.movie_id} ({script.cleanedWordCount} words)..."
        )

        classifier = get_classifier()
        classifications = classifier.classify_text(script.cleanedScriptText)

        # Compute statistics
        statistics = classifier.get_statistics(classifications)

        # All words by CEFR level (sorted easier to harder using frequency_rank)
        # Filter out ultra-common A1 words
        level_groups = {}
        for cls in classifications:
            level = cls.cefr_level.value

            # Skip ultra-common A1 words (articles, pronouns, etc.)
            if not should_keep_word(cls.word, cls.lemma, level):
                continue

            if level not in level_groups:
                level_groups[level] = []

            level_groups[level].append({
                'word': cls.word,
                'lemma': cls.lemma,
                'confidence': cls.confidence,
                'frequency_rank': cls.frequency_rank
            })

        # Sort by frequency_rank (lower rank = more common = easier)
        # Words without rank go to the end
        top_words_by_level = {
            level: sorted(
                words,
                key=lambda x: (x['frequency_rank'] is None, x['frequency_rank'] or 999999)
            )
            for level, words in level_groups.items()
        }

        # Save to database (only if NOT cached)
        if request.save_to_db and not existing_classifications:
            # Deduplicate by lemma + CEFR level (avoid storing duplicates)
            unique = {}
            for cls in classifications:
                key = (cls.lemma, cls.cefr_level.value)
                if key not in unique:
                    unique[key] = cls

            cls_list = list(unique.values())
            logger.info(f"Saving {len(cls_list)} unique classifications to DB (deduped from {len(classifications)})...")

            # Batch inserts to avoid timeout
            batch_size = 200
            num_batches = (len(cls_list) + batch_size - 1) // batch_size

            for batch_idx in range(num_batches):
                start = batch_idx * batch_size
                end = min(start + batch_size, len(cls_list))
                batch = cls_list[start:end]

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

            logger.info(f"✓ Saved {len(cls_list)} classifications in {num_batches} batches")

            from src.services.difficulty_scorer import compute_difficulty
            level, score, dist = compute_difficulty(statistics['level_distribution'])

            await db.movie.update(
                where={'id': request.movie_id},
                data={
                    'difficultyLevel': level,
                    'difficultyScore': score,
                    'cefrDistribution': dist
                }
            )

            await db.moviescript.update(
                where={'id': script.id},
                data={'isPreprocessed': True}
            )

            logger.info(f"✓ Updated movie difficulty: {level.value}, score: {score}")

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
