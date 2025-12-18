"""
Word Example Enrichment API Routes

Endpoints for enriching movies with sentence examples and translations.
"""

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from typing import List, Optional, Dict
import logging

from src.database import get_db
from prisma import Prisma
from src.services.sentence_example_service import SentenceExampleService
from src.services.example_translation_service import ExampleTranslationService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/enrichment", tags=["Enrichment"])


# === Request/Response Models ===

class EnrichExamplesRequest(BaseModel):
    """Request to enrich movie with sentence examples"""
    movie_id: int = Field(..., description="Movie ID to enrich")
    target_lang: str = Field(..., description="Target language code (e.g., 'ES', 'RU')")
    batch_size: int = Field(25, description="Translation batch size")
    delay_ms: int = Field(500, description="Delay between batches (ms)")


class EnrichExamplesResponse(BaseModel):
    """Response from enrichment job"""
    movie_id: int
    target_lang: str
    status: str
    sentences_extracted: int
    words_processed: int
    examples_saved: int
    translation_stats: Dict


class WordExampleResponse(BaseModel):
    """Single word example"""
    sentence: str
    translation: str
    word_position: int


class WordExamplesResponse(BaseModel):
    """Response with word examples for a movie"""
    movie_id: int
    target_lang: str
    word: str
    lemma: str
    cefr_level: str
    examples: List[WordExampleResponse]


class MovieExamplesResponse(BaseModel):
    """Response with all examples for a movie"""
    movie_id: int
    target_lang: str
    words: List[WordExamplesResponse]
    total_words: int


# === Endpoints ===

@router.post("/examples", response_model=EnrichExamplesResponse)
async def enrich_movie_examples(
    request: EnrichExamplesRequest,
    db: Prisma = Depends(get_db)
):
    """
    Enrich a movie with sentence examples and translations.

    This is a synchronous ingestion/enrichment step that:
    1. Extracts representative sentences from the movie script
    2. Maps sentences to vocabulary words
    3. Translates sentences in batches
    4. Saves results to database

    This endpoint is idempotent - rerunning will replace existing examples.

    **Note:** This can take 30-60 seconds for a full movie script.
    Consider using background_tasks for async processing in production.
    """
    try:
        logger.info(f"Starting enrichment for movie {request.movie_id}, lang {request.target_lang}")

        # Step 1: Fetch movie and script
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

        # Step 2: Get vocabulary words for this movie
        word_classifications = await db.wordclassification.find_many(
            where={'scriptId': script.id}
        )

        if not word_classifications:
            raise HTTPException(
                status_code=400,
                detail="Movie has no vocabulary classifications. Run CEFR classification first."
            )

        vocabulary_words = set(wc.word.lower() for wc in word_classifications)
        logger.info(f"Found {len(vocabulary_words)} vocabulary words")

        # Step 3: Extract sentences for each word
        sentence_service = SentenceExampleService()
        word_sentences = sentence_service.extract_word_sentences(
            script.cleanedScriptText,
            vocabulary_words
        )

        sentences_extracted = sum(len(sents) for sents in word_sentences.values())
        logger.info(f"Extracted {sentences_extracted} sentences for {len(word_sentences)} words")

        # Step 4: Get unique sentences to translate
        unique_sentences = set()
        for sentences_list in word_sentences.values():
            for sentence, position in sentences_list:
                unique_sentences.add(sentence)

        unique_sentences_list = list(unique_sentences)
        logger.info(f"Translating {len(unique_sentences_list)} unique sentences")

        # Step 5: Translate sentences in batches
        translation_service = ExampleTranslationService(
            db=db,
            batch_size=request.batch_size,
            delay_ms=request.delay_ms
        )

        translation_results, stats = await translation_service.translate_all_sentences(
            unique_sentences_list,
            target_lang=request.target_lang,
            source_lang="en"
        )

        # Build sentence -> translation map
        sentence_to_translation = {
            result['sentence']: result['translation']
            for result in translation_results
        }

        # Step 6: Build final data structure for saving
        # word -> [(sentence, position, translation, lemma)]
        word_examples = {}

        for word, sentences_list in word_sentences.items():
            examples = []
            word_lower = word.lower()

            # Get lemma from classifications
            word_lemma = next(
                (wc.lemma for wc in word_classifications if wc.word.lower() == word_lower),
                word_lower
            )

            for sentence, position in sentences_list:
                translation = sentence_to_translation.get(sentence, sentence)
                examples.append((sentence, position, translation, word_lemma))

            word_examples[word] = examples

        # Step 7: Save to database
        examples_saved = await translation_service.save_word_examples(
            movie_id=request.movie_id,
            word_examples=word_examples,
            target_lang=request.target_lang
        )

        logger.info(f"✓ Enrichment complete for movie {request.movie_id}")

        return EnrichExamplesResponse(
            movie_id=request.movie_id,
            target_lang=request.target_lang.upper(),
            status="success",
            sentences_extracted=sentences_extracted,
            words_processed=len(word_sentences),
            examples_saved=examples_saved,
            translation_stats=stats
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Enrichment failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/movies/{movie_id}/examples", response_model=MovieExamplesResponse)
async def get_movie_examples(
    movie_id: int,
    lang: str,
    db: Prisma = Depends(get_db)
):
    """
    Fetch all enriched word examples for a movie.

    Fast, DB-backed endpoint that returns pre-translated sentence examples.

    Args:
        movie_id: Movie ID
        lang: Target language code (e.g., 'ES', 'RU')

    Returns:
        All words with their sentence examples and translations
    """
    try:
        lang_upper = lang.upper()

        # Fetch all examples for this movie + language
        examples = await db.wordsentenceexample.find_many(
            where={
                'movieId': movie_id,
                'targetLang': lang_upper
            }
        )

        if not examples:
            raise HTTPException(
                status_code=404,
                detail=f"No examples found for movie {movie_id}, lang {lang_upper}. "
                       f"Run enrichment first: POST /api/enrichment/examples"
            )

        # Group by word
        words_map: Dict[str, Dict] = {}

        for example in examples:
            word = example.word
            if word not in words_map:
                words_map[word] = {
                    'word': word,
                    'lemma': example.lemma,
                    'cefr_level': example.cefrLevel,
                    'examples': []
                }

            words_map[word]['examples'].append(WordExampleResponse(
                sentence=example.sentence,
                translation=example.translation,
                word_position=example.wordPosition
            ))

        words_list = [
            WordExamplesResponse(**word_data)
            for word_data in words_map.values()
        ]

        return MovieExamplesResponse(
            movie_id=movie_id,
            target_lang=lang_upper,
            words=words_list,
            total_words=len(words_list)
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch examples: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/movies/{movie_id}/status")
async def get_enrichment_status(
    movie_id: int,
    lang: str,
    db: Prisma = Depends(get_db)
):
    """
    Check enrichment status for a movie + language combination.

    Returns the enrichment status to help UI show appropriate loading states.

    Args:
        movie_id: Movie ID
        lang: Target language code (e.g., 'ES', 'FR', 'DE')

    Returns:
        - 'ready': Examples exist and ready to use
        - 'enriching': Background enrichment likely in progress
        - 'not_started': No classification or enrichment exists yet
    """
    try:
        lang_upper = lang.upper()

        # Check if examples exist
        existing = await db.wordsentenceexample.find_first(
            where={'movieId': movie_id, 'targetLang': lang_upper}
        )

        if existing:
            return {
                "status": "ready",
                "movie_id": movie_id,
                "target_lang": lang_upper,
                "message": "Sentence examples are ready"
            }

        # Check if classifications exist (prerequisite for enrichment)
        script = await db.moviescript.find_first(
            where={'movieId': movie_id},
            include={'wordClassifications': True}
        )

        if not script or not script.wordClassifications:
            return {
                "status": "not_started",
                "movie_id": movie_id,
                "target_lang": lang_upper,
                "message": "Movie not yet classified. Classification needed before enrichment."
            }

        # Classifications exist but no enrichment → not started yet
        return {
            "status": "not_started",
            "movie_id": movie_id,
            "target_lang": lang_upper,
            "message": "Ready to enrich. Click 'Enrich with sentence examples' to start."
        }

    except Exception as e:
        logger.error(f"Failed to check enrichment status: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/movies/{movie_id}/start")
async def start_enrichment(
    movie_id: int,
    lang: str,
    background_tasks: BackgroundTasks,
    db: Prisma = Depends(get_db)
):
    """
    Start background enrichment for a movie + language combination.

    This endpoint triggers enrichment asynchronously and returns immediately.
    The UI can poll /status to check progress.

    Args:
        movie_id: Movie ID
        lang: Target language code (e.g., 'ES', 'FR', 'DE')

    Returns:
        Confirmation that enrichment has started
    """
    try:
        lang_upper = lang.upper()

        # Check if already enriched
        existing = await db.wordsentenceexample.find_first(
            where={'movieId': movie_id, 'targetLang': lang_upper}
        )

        if existing:
            return {
                "status": "already_enriched",
                "movie_id": movie_id,
                "target_lang": lang_upper,
                "message": "Examples already exist for this movie"
            }

        # Check if classifications exist
        script = await db.moviescript.find_first(
            where={'movieId': movie_id},
            include={'wordClassifications': True}
        )

        if not script or not script.wordClassifications:
            raise HTTPException(
                status_code=400,
                detail="Movie must be classified before enrichment can start"
            )

        # Start enrichment in background
        async def run_enrichment():
            try:
                logger.info(f"Background enrichment starting for movie {movie_id}, lang {lang_upper}")

                # Get fresh DB connection for background task
                from src.database import get_db
                db_gen = get_db()
                bg_db = await db_gen.__anext__()

                try:
                    # Fetch movie and script
                    movie = await bg_db.movie.find_unique(
                        where={'id': movie_id},
                        include={'movieScripts': True}
                    )

                    if not movie or not movie.movieScripts:
                        logger.error(f"Movie {movie_id} or script not found")
                        return

                    script = movie.movieScripts[0]

                    # Get vocabulary
                    word_classifications = await bg_db.wordclassification.find_many(
                        where={'scriptId': script.id}
                    )

                    vocabulary_words = set(wc.word.lower() for wc in word_classifications)

                    # Extract sentences
                    sentence_service = SentenceExampleService()
                    word_sentences = sentence_service.extract_word_sentences(
                        script.cleanedScriptText,
                        vocabulary_words
                    )

                    # Get unique sentences
                    unique_sentences = set()
                    for sentences_list in word_sentences.values():
                        for sentence, position in sentences_list:
                            unique_sentences.add(sentence)

                    # Translate
                    translation_service = ExampleTranslationService(
                        db=bg_db,
                        batch_size=25,
                        delay_ms=500
                    )

                    translation_results, stats = await translation_service.translate_all_sentences(
                        list(unique_sentences),
                        target_lang=lang_upper,
                        source_lang="en"
                    )

                    sentence_to_translation = {
                        result['sentence']: result['translation']
                        for result in translation_results
                    }

                    # Build examples
                    word_examples = {}
                    for word, sentences_list in word_sentences.items():
                        examples = []
                        word_lower = word.lower()
                        word_lemma = next(
                            (wc.lemma for wc in word_classifications if wc.word.lower() == word_lower),
                            word_lower
                        )

                        for sentence, position in sentences_list:
                            translation = sentence_to_translation.get(sentence, sentence)
                            examples.append((sentence, position, translation, word_lemma))

                        word_examples[word] = examples

                    # Save
                    await translation_service.save_word_examples(
                        movie_id=movie_id,
                        word_examples=word_examples,
                        target_lang=lang_upper
                    )

                    logger.info(f"✓ Background enrichment complete for movie {movie_id}")

                finally:
                    # Disconnect background DB
                    await bg_db.disconnect()

            except Exception as e:
                logger.error(f"Background enrichment failed: {e}", exc_info=True)

        # Add to background tasks
        background_tasks.add_task(run_enrichment)

        return {
            "status": "started",
            "movie_id": movie_id,
            "target_lang": lang_upper,
            "message": "Enrichment started in background. Poll /status to check progress."
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to start enrichment: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/movies/{movie_id}/examples/{word}", response_model=WordExamplesResponse)
async def get_word_examples(
    movie_id: int,
    word: str,
    lang: str,
    db: Prisma = Depends(get_db)
):
    """
    Fetch sentence examples for a specific word in a movie.

    Args:
        movie_id: Movie ID
        word: Word to get examples for
        lang: Target language code

    Returns:
        Sentence examples with translations for the word
    """
    try:
        lang_upper = lang.upper()
        word_lower = word.lower()

        examples = await db.wordsentenceexample.find_many(
            where={
                'movieId': movie_id,
                'word': word_lower,
                'targetLang': lang_upper
            }
        )

        if not examples:
            raise HTTPException(
                status_code=404,
                detail=f"No examples found for word '{word}' in movie {movie_id}"
            )

        example_list = [
            WordExampleResponse(
                sentence=ex.sentence,
                translation=ex.translation,
                word_position=ex.wordPosition
            )
            for ex in examples
        ]

        return WordExamplesResponse(
            movie_id=movie_id,
            target_lang=lang_upper,
            word=examples[0].word,
            lemma=examples[0].lemma,
            cefr_level=examples[0].cefrLevel,
            examples=example_list
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch word examples: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
