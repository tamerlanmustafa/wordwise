"""
CEFR Classification API Routes

Endpoints for classifying words and texts with CEFR levels
"""

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from typing import List, Optional, Dict
from pathlib import Path
import logging
import json
import asyncio

from src.services.cefr_classifier import (
    HybridCEFRClassifier,
    CEFRLevel,
    ClassificationSource,
    WordClassification,
)
from src.services.lemmatization_service import (
    lemmatize_script_async,
    populate_lemma_registry,
    backfill_lemmas_from_classifications,
)
from src.database import get_db
from src.middleware.auth import get_admin_user, get_current_active_user
from src.services.cefr_registry import apply_registry_levels
from src.services.internationalism_filter import is_internationalism_entry
from src.services.lemma_guard import display_form
from src.services.profanity_filter import is_profane_entry
from src.services.script_idioms import get_script_idioms
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
    Filter out ultra-common A1 words that all learners already know,
    internationalisms they recognise regardless of level, and strong
    profanity/slurs at any level.

    Args:
        word: The word token
        lemma: The lemmatized form
        cefr_level: CEFR level (A1, A2, B1, B2, C1, C2) or UNKNOWN

    Returns:
        True if word should be shown to user, False if it should be filtered out
    """
    # UNKNOWN is the "classifier could not place this" bucket, not a level
    # (#91): proper nouns, fantasy words and unrecognised debris. Nothing in
    # it is taught until we've looked at what accumulates there.
    if cefr_level == "UNKNOWN":
        return False

    # Swear words and slurs are never taught. Checked here (not only via the
    # upstream lemma guard) because classifications cached before the guard
    # existed are served straight from the DB on the fast path.
    if is_profane_entry(word, lemma):
        return False

    # Internationalisms are dropped at every level, not just A1: the CEFR
    # classifier rates plenty of them B1+ ("kilowatt", "saxophone") even
    # though a learner reads them at sight (issue #89).
    if is_internationalism_entry(word, lemma):
        return False

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
    target_language: Optional[str] = Field(
        default='ES',
        description="Target language for enrichment (e.g., 'ES', 'FR', 'DE'). "
                   "If provided, sentence examples will be automatically enriched in background."
    )
    genres: Optional[List[str]] = Field(
        default=None,
        description="TMDB genre names (e.g., ['Animation', 'Family']). "
                   "Saved to movie and used for difficulty genre normalization."
    )


class IdiomInfo(BaseModel):
    """Information about a detected idiom or phrasal verb"""
    phrase: str = Field(..., description="The idiom or phrasal verb phrase")
    type: str = Field(..., description="Type: 'phrasal_verb' or 'idiom'")
    cefr_level: str = Field(..., description="CEFR level of the expression")
    words: List[str] = Field(..., description="Component words of the expression")


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
    idioms: List[IdiomInfo] = Field(default_factory=list, description="Detected idioms and phrasal verbs")


class FrequencyThresholdUpdate(BaseModel):
    """Update frequency thresholds for CEFR mapping"""
    A1: tuple[int, int] = Field((0, 1000))
    A2: tuple[int, int] = Field((1000, 2000))
    B1: tuple[int, int] = Field((2000, 5000))
    B2: tuple[int, int] = Field((5000, 10000))
    C1: tuple[int, int] = Field((10000, 20000))
    C2: tuple[int, int] = Field((20000, 999999))


# === Endpoints ===

async def populate_sentence_bank_bg(movie_id: int):
    """
    Background task: populate SentenceBank + SentenceLemmaLink for a movie's
    classified vocabulary. Translation-free (pure spaCy + DB), so safe to fire
    on every classify-script call. Idempotent — skips if SentenceBank already
    has entries for this movie.

    Owns its own Prisma connection because the request-scoped `db` injected
    into the handler is closed by the time this task runs.
    """
    db = None
    try:
        db = Prisma()
        await db.connect()
        from src.services.sentence_bank_service import populate_movie_sentence_bank
        stats = await populate_movie_sentence_bank(db, movie_id)
        logger.info(f"[bg-sentencebank] movie={movie_id} {stats}")
    except Exception as e:
        logger.error(f"[bg-sentencebank] movie={movie_id} FAILED: {e}", exc_info=True)
    finally:
        if db is not None:
            try:
                await db.disconnect()
            except Exception:
                pass


async def auto_enrich_after_classification(movie_id: int, target_lang: str):
    """
    Background task: Automatically enrich movie with sentence examples after classification.

    This runs asynchronously and doesn't block the classification response.
    Only enriches if not already done for this (movie, language) combination.

    Args:
        movie_id: Movie ID to enrich
        target_lang: Target language code (e.g., 'ES', 'FR', 'DE')
    """
    db = None
    try:
        # Create new DB connection for background task
        db = Prisma()
        await db.connect()

        # Check if enrichment already exists
        existing = await db.wordsentenceexample.find_first(
            where={'movieId': movie_id, 'targetLang': target_lang.upper()}
        )

        if existing:
            logger.info(
                f"⚡ Enrichment already exists for movie {movie_id}, lang {target_lang} - skipping"
            )
            return

        # Import enrichment service (lazy import to avoid circular dependency)
        from src.routes.enrichment import enrich_movie_examples, EnrichExamplesRequest

        logger.info(
            f"🔄 Starting background enrichment: movie {movie_id}, lang {target_lang}"
        )

        # Run enrichment
        await enrich_movie_examples(
            request=EnrichExamplesRequest(
                movie_id=movie_id,
                target_lang=target_lang.upper(),
                batch_size=25,
                delay_ms=500
            ),
            db=db
        )

        logger.info(
            f"✅ Background enrichment complete: movie {movie_id}, lang {target_lang}"
        )

    except Exception as e:
        logger.error(
            f"❌ Background enrichment failed for movie {movie_id}, lang {target_lang}: {e}",
            exc_info=True
        )
    finally:
        if db:
            await db.disconnect()


async def run_script_classification(
    db: Prisma,
    request: ScriptClassificationRequest,
) -> ScriptClassificationResponse:
    """
    Core CEFR classification for a movie script. Shared by the HTTP route
    below and the ingestion worker, which calls this in-process (no auth, no
    HTTP hop) rather than POSTing to its own API.

    PERFORMANCE OPTIMIZATION:
    If classifications already exist in DB, returns cached data immediately
    WITHOUT initializing the CEFR classifier or loading any word lists.

    NOTE: This does NOT schedule SentenceBank population — the caller is
    responsible for kicking off populate_sentence_bank_bg(movie_id) after a
    successful return (the route does it via BackgroundTasks; the worker
    awaits it directly).
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
                    # Display the lemma, not the inflected surface form
                    # ("stakeholders" row renders as "stakeholder").
                    'word': display_form(cls.word, cls.lemma),
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

            # Idioms come from the stored column (issue #106). This branch used
            # to reparse the script even though every other value here is read
            # from the DB — so "already classified" saved nothing on the NLP
            # cost, and opening a movie paid for the same parse twice (#122).
            idioms = [IdiomInfo(**i) for i in await get_script_idioms(db, script)]
            logger.info(f"Detected {len(idioms)} idioms/phrasal verbs in script")

            # If genres provided and movie has no genre or no difficulty, update now
            if request.genres and (not movie.genre or movie.difficultyScore is None):
                try:
                    await db.movie.update(
                        where={'id': request.movie_id},
                        data={'genre': json.dumps(request.genres)}
                    )
                    # Recompute difficulty with genres
                    from src.services.difficulty_scorer import compute_difficulty_advanced_async, WordData
                    word_data_list = [
                        WordData(
                            cefr_level=cls.cefrLevel if isinstance(cls.cefrLevel, str) else cls.cefrLevel.value,
                            confidence=cls.confidence,
                            frequency_rank=cls.frequencyRank,
                            word=cls.word
                        )
                        for cls in existing_classifications
                    ]
                    level, score, breakdown = await compute_difficulty_advanced_async(word_data_list, genres=request.genres, text=script.cleanedScriptText)
                    await db.movie.update(
                        where={'id': request.movie_id},
                        data={
                            'difficultyLevel': level,
                            'difficultyScore': score,
                            'cefrDistribution': json.dumps(breakdown) if breakdown else None
                        }
                    )
                    logger.info(f"✓ Updated difficulty with genres {request.genres}: {level.value}, score: {score}")
                except Exception as e:
                    logger.warning(f"Failed to update difficulty with genres: {e}")

            # Return immediately without initializing classifier
            return ScriptClassificationResponse(
                movie_id=request.movie_id,
                script_id=script.id,
                total_words=script.cleanedWordCount or 0,
                unique_words=len(set(cls.lemma for cls in existing_classifications)),
                level_distribution=level_distribution,
                average_confidence=average_confidence,
                wordlist_coverage=0.0,  # Not computed for cached data
                top_words_by_level=top_words_by_level,
                idioms=idioms
            )

        # ========================================================================
        # SLOW PATH: No cache exists, initialize classifier and process script
        # ========================================================================
        logger.info(
            f"SLOW PATH: No cache found. Initializing classifier and processing script "
            f"for movie {request.movie_id} ({script.cleanedWordCount} words)..."
        )

        # Extract genres: prefer request genres (from TMDB), fall back to DB
        genres = []
        if request.genres:
            genres = request.genres
            # Save genres to movie for future use
            try:
                await db.movie.update(
                    where={'id': request.movie_id},
                    data={'genre': json.dumps(genres)}
                )
            except Exception:
                pass
        elif movie and movie.genre:
            try:
                genres = json.loads(movie.genre) if isinstance(movie.genre, str) else movie.genre
            except:
                genres = []

        classifier = get_classifier()
        classifications = classifier.classify_text(script.cleanedScriptText, genres=genres)

        # A word the registry can already place must not be stored UNKNOWN
        # just because this script capitalised it (#119). Before statistics,
        # so difficulty and the lemma registry below see the same levels.
        await apply_registry_levels(db, classifications)

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
                # Display the lemma, not the inflected surface form
                # ("stakeholders" row renders as "stakeholder").
                'word': display_form(cls.word, cls.lemma),
                'lemma': cls.lemma,
                'confidence': cls.confidence,
                'frequency_rank': cls.frequency_rank
            })

        # Sort by frequency_rank (lower rank = more common = easier)
        # Words without rank go to the end
        # Cap at 50 words per level for performance
        top_words_by_level = {
            level: sorted(
                words,
                key=lambda x: (x['frequency_rank'] is None, x['frequency_rank'] or 999999)
            )[:50]  # Cap at 50 words per level
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

            # ================================================================
            # V2 DUAL-WRITE: Populate Lemma registry + MovieLemmaMapping
            # ================================================================
            try:
                lemma_result = await lemmatize_script_async(script.cleanedScriptText)

                # Build classification lookup for the lemmatization service
                cls_lookup = {}
                for cls in cls_list:
                    cls_lookup[cls.lemma] = {
                        "cefr_level": cls.cefr_level.value,
                        "confidence": cls.confidence,
                        "source": cls.source.value,
                        "frequency_rank": cls.frequency_rank,
                        "pos": cls.pos,
                    }

                lemma_id_map = await populate_lemma_registry(
                    db=db,
                    movie_id=request.movie_id,
                    lemma_result=lemma_result,
                    classifications=cls_lookup,
                )
                logger.info(
                    f"✓ V2 Lemma registry: {len(lemma_id_map)} lemmas for movie {request.movie_id}"
                )
            except Exception as e:
                # Non-fatal: V2 pipeline failure should not break V1
                logger.error(f"V2 Lemma registry population failed (non-fatal): {e}", exc_info=True)

            # Compute difficulty using advanced algorithm with ALL words (no cap)
            # The 50-word cap is applied ONLY to API response, not to scoring
            from src.services.difficulty_scorer import compute_difficulty_advanced_async, WordData

            # Use ALL classifications for difficulty scoring (critical fix)
            word_data_list = [
                WordData(
                    cefr_level=cls.cefr_level.value,
                    confidence=cls.confidence,
                    frequency_rank=cls.frequency_rank,
                    word=cls.word
                )
                for cls in classifications
            ]

            # genres already extracted above (from request or DB)
            level, score, breakdown = await compute_difficulty_advanced_async(word_data_list, genres=genres, text=script.cleanedScriptText)

            # Convert dict to JSON string for Prisma Json field
            await db.movie.update(
                where={'id': request.movie_id},
                data={
                    'difficultyLevel': level,
                    'difficultyScore': score,
                    'cefrDistribution': json.dumps(breakdown) if breakdown else None
                }
            )

            await db.moviescript.update(
                where={'id': script.id},
                data={'isPreprocessed': True}
            )

            logger.info(f"✓ Updated movie difficulty: {level.value}, score: {score}")

        # Idioms from the stored column, computed once per script (issue #106).
        idioms = [IdiomInfo(**i) for i in await get_script_idioms(db, script)]
        logger.info(f"Detected {len(idioms)} idioms/phrasal verbs in script")

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
            top_words_by_level=top_words_by_level,
            idioms=idioms
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error classifying script: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/classify-script", response_model=ScriptClassificationResponse)
async def classify_script(
    request: ScriptClassificationRequest,
    background_tasks: BackgroundTasks,
    db: Prisma = Depends(get_db),
    current_user = Depends(get_current_active_user),
):
    """
    Classify an entire movie script from the database. Available to any
    authenticated user (e.g. classifying a movie's vocabulary from the app).

    After classification, schedules background SentenceBank population (the
    cheap, translation-free path). The heavier translation-bearing /enrich
    endpoint is still the explicit opt-in.
    """
    result = await run_script_classification(db, request)
    background_tasks.add_task(populate_sentence_bank_bg, request.movie_id)
    return result


@router.put("/update-thresholds")
async def update_frequency_thresholds(
    thresholds: FrequencyThresholdUpdate,
    admin_user = Depends(get_admin_user),
):
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


@router.post("/v2/backfill-lemmas")
async def backfill_lemmas(
    background_tasks: BackgroundTasks,
    db: Prisma = Depends(get_db),
    admin_user = Depends(get_admin_user),
):
    """
    Migration endpoint: Backfill the Lemma table from existing WordClassification data.
    Runs as a background task. Safe to call multiple times (upserts).
    """
    async def _run_backfill():
        backfill_db = Prisma()
        await backfill_db.connect()
        try:
            count = await backfill_lemmas_from_classifications(backfill_db)
            logger.info(f"Backfill complete: {count} lemmas")
        finally:
            await backfill_db.disconnect()

    background_tasks.add_task(_run_backfill)
    return {"status": "started", "message": "Lemma backfill running in background"}
