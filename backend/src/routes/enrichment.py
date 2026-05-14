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
from src.services.sentence_bank_service import populate_sentence_bank
from src.services.sense_clustering_service import cluster_and_store_senses
from src.services.translation_memory_service import TranslationMemoryService
from src.services.v2_optimization_service import V2OptimizationService

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

        # Step 6b: V2 DUAL-WRITE — Populate SentenceBank + SentenceLemmaLink
        try:
            # Build word -> lemma mapping from classifications
            word_to_lemma = {}
            for wc in word_classifications:
                word_to_lemma[wc.word.lower()] = wc.lemma.lower()

            # Get lemma_id_map from Lemma registry
            lemma_strs = list(set(word_to_lemma.values()))
            lemma_records = await db.lemma.find_many(
                where={"lemma": {"in": lemma_strs}}
            )
            lemma_id_map = {lr.lemma: lr.id for lr in lemma_records}

            await populate_sentence_bank(
                db=db,
                movie_id=request.movie_id,
                word_sentences=word_sentences,
                lemma_id_map=lemma_id_map,
                word_to_lemma=word_to_lemma,
            )

            # Step 6c: V2 — Sense Clustering (Phase 3)
            await cluster_and_store_senses(
                db=db,
                movie_id=request.movie_id,
                lemma_id_map=lemma_id_map,
            )

            # Step 6d: V2 — Stage B: Eager Translation (Phase 4)
            tm_service = TranslationMemoryService(db)
            tm_stats = await tm_service.translate_movie_eager(
                movie_id=request.movie_id,
                target_lang=request.target_lang,
            )
            logger.info(f"V2 Stage B (sync): {tm_stats}")

            # Step 6e: V2 — Propagation to WordSentenceExample
            prop_count = await tm_service.propagate_to_word_sentence_examples(
                movie_id=request.movie_id,
                target_lang=request.target_lang,
            )
            logger.info(f"V2 propagated {prop_count} entries to WordSentenceExample")
        except Exception as e:
            # Non-fatal: V2 failure should not break V1 enrichment
            logger.error(f"V2 pipeline failed (non-fatal): {e}", exc_info=True)

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
                bg_db = await get_db()

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

                    # V2 DUAL-WRITE — SentenceBank + SentenceLemmaLink
                    try:
                        word_to_lemma = {}
                        for wc in word_classifications:
                            word_to_lemma[wc.word.lower()] = wc.lemma.lower()

                        lemma_strs = list(set(word_to_lemma.values()))
                        lemma_records = await bg_db.lemma.find_many(
                            where={"lemma": {"in": lemma_strs}}
                        )
                        lemma_id_map = {lr.lemma: lr.id for lr in lemma_records}

                        await populate_sentence_bank(
                            db=bg_db,
                            movie_id=movie_id,
                            word_sentences=word_sentences,
                            lemma_id_map=lemma_id_map,
                            word_to_lemma=word_to_lemma,
                        )

                        await cluster_and_store_senses(
                            db=bg_db,
                            movie_id=movie_id,
                            lemma_id_map=lemma_id_map,
                        )

                        # V2 Stage B: Eager Translation (Phase 4)
                        tm_service = TranslationMemoryService(bg_db)
                        tm_stats = await tm_service.translate_movie_eager(
                            movie_id=movie_id,
                            target_lang=lang_upper,
                        )
                        logger.info(f"V2 Stage B (async): {tm_stats}")

                        # V2 Propagation
                        prop_count = await tm_service.propagate_to_word_sentence_examples(
                            movie_id=movie_id,
                            target_lang=lang_upper,
                        )
                        logger.info(f"V2 propagated {prop_count} entries to WordSentenceExample")
                    except Exception as e:
                        logger.error(f"V2 pipeline failed (non-fatal): {e}", exc_info=True)

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


@router.get("/movies/{movie_id}/sentences/{word}")
async def get_word_sentences(
    movie_id: int,
    word: str,
    target_lang: str = None,
    max_examples: int = 1,
    db: Prisma = Depends(get_db)
):
    """
    Get sentences containing a word from a movie, with optional cached translation.
    Fast path: query pre-extracted SentenceBank (populated during enrichment).
    Slow path: parse script on-the-fly if SentenceBank has no data.
    If target_lang is provided, returns cached translation or translates on-demand and caches.
    """
    try:
        from src.services.lemmatization_service import get_nlp
        nlp = get_nlp()

        raw_sentences = []
        is_phrase = ' ' in word.strip()

        # Phrase path: skip lemma lookup, use phrase-aware extraction directly
        if is_phrase:
            movie = await db.movie.find_unique(
                where={'id': movie_id},
                include={'movieScripts': True}
            )
            if not movie or not movie.movieScripts or not movie.movieScripts[0].cleanedScriptText:
                raise HTTPException(status_code=404, detail=f"Movie {movie_id} not found or has no script")

            sentence_service = SentenceExampleService()
            sentences = sentence_service.extract_phrase_sentences(
                movie.movieScripts[0].cleanedScriptText,
                word,
                nlp,
                max_examples,
            )
            for sent, pos, form in sentences:
                raw_sentences.append({
                    "sentence": sent,
                    "word_position": pos,
                    "matched_form": form,
                })

            # Translate sentences if requested
            if target_lang and raw_sentences:
                from src.services.translation_service import TranslationService
                ts = TranslationService(db)
                for item in raw_sentences:
                    try:
                        result = await ts.get_translation(item["sentence"], target_lang.upper(), "en")
                        if result and result.get("translated"):
                            item["translation"] = result["translated"]
                    except Exception as tx_err:
                        logger.warning(f"Sentence translation failed: {tx_err}")

            return {
                "movie_id": movie_id,
                "word": word.lower(),
                "lemma": word.lower(),
                "sentences": raw_sentences,
                "total": len(raw_sentences),
            }

        doc = nlp(word.lower().strip())
        lemma_text = doc[0].lemma_ if doc else word.lower()

        # Fast path: check SentenceBank via lemma link
        lemma_record = await db.lemma.find_first(where={"lemma": lemma_text})

        if lemma_record:
            links = await db.sentencelemmalink.find_many(
                where={
                    "lemmaId": lemma_record.id,
                    "sentence": {"movieId": movie_id},
                },
                include={"sentence": True},
                order={"score": "desc"},
                take=max_examples,
            )

            if links:
                for link in links:
                    sent = link.sentence.sentence
                    # Use stored matched_form when present (populated at
                    # indexing time). Fall back to a single spaCy parse only
                    # for legacy rows where matched_form is NULL.
                    matched_form = link.matchedForm
                    if matched_form is None:
                        sent_doc = nlp(sent)
                        matched_form = word.lower()
                        for token in sent_doc:
                            if token.lemma_.lower() == lemma_text:
                                matched_form = token.text
                                break
                    raw_sentences.append({
                        "sentence": sent,
                        "word_position": link.wordPosition or 0,
                        "matched_form": matched_form,
                    })

        # Slow path: parse script on-the-fly
        if not raw_sentences:
            movie = await db.movie.find_unique(
                where={'id': movie_id},
                include={'movieScripts': True}
            )

            if not movie or not movie.movieScripts:
                raise HTTPException(status_code=404, detail=f"Movie {movie_id} not found or has no script")

            script = movie.movieScripts[0]
            if not script.cleanedScriptText:
                raise HTTPException(status_code=400, detail="Script has no cleaned text")

            sentence_service = SentenceExampleService()
            surface_form = word.lower().strip()
            sentences = sentence_service.extract_word_sentences_by_lemma(
                script.cleanedScriptText,
                lemma_text,
                nlp,
                max_examples,
                target_surface=surface_form,
            )
            # Fallback: if bare-word lemma disagrees with in-context lemma
            # (e.g., spaCy gives "unimpaire" for "unimpaired" in isolation),
            # retry treating the surface form itself as the lemma target.
            if not sentences and surface_form != lemma_text:
                sentences = sentence_service.extract_word_sentences_by_lemma(
                    script.cleanedScriptText,
                    surface_form,
                    nlp,
                    max_examples,
                    target_surface=surface_form,
                )
            for sent, pos, form in sentences:
                raw_sentences.append({
                    "sentence": sent,
                    "word_position": pos,
                    "matched_form": form,
                })

        # Look up or create translations if target_lang provided
        if target_lang and raw_sentences:
            from src.services.translation_service import TranslationService
            ts = TranslationService(db)
            for item in raw_sentences:
                try:
                    result = await ts.get_translation(item["sentence"], target_lang.upper(), "en")
                    if result and result.get("translated"):
                        item["translation"] = result["translated"]
                except Exception as tx_err:
                    logger.warning(f"Sentence translation failed: {tx_err}")

        return {
            "movie_id": movie_id,
            "word": word.lower(),
            "lemma": lemma_text,
            "sentences": raw_sentences,
            "total": len(raw_sentences),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to extract sentences for '{word}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


class BatchSentencesRequest(BaseModel):
    """Request body for the batch-sentences endpoint."""
    words: List[str] = Field(..., description="Surface-form words to look up")
    max_examples: int = Field(1, ge=1, le=5)


@router.post("/movies/{movie_id}/sentences/batch")
async def get_word_sentences_batch(
    movie_id: int,
    request: BatchSentencesRequest,
    db: Prisma = Depends(get_db),
):
    """
    Look up cached sentences for many words in a single round trip.
    Replaces the N+1 pattern of calling /sentences/{word} per row.

    Only the SentenceBank fast path is used here — words without an indexed
    sentence return an empty list rather than triggering a full-script
    spaCy reparse for the batch. Callers can fall back to /sentences/{word}
    for misses if they need the slow path.

    Phrases (multi-word entries) are skipped; they need extract_phrase_sentences
    and don't currently appear in the For You list anyway.
    """
    import time
    t_start = time.perf_counter()

    if not request.words:
        logger.info(f"[batch-sentences] movie={movie_id} empty request, no-op")
        return {"movie_id": movie_id, "results": {}}

    single_words = [w.lower().strip() for w in request.words if w and " " not in w.strip()]
    n_in = len(request.words)
    n_single = len(single_words)
    if not single_words:
        logger.info(f"[batch-sentences] movie={movie_id} all {n_in} inputs were phrases or empty")
        return {"movie_id": movie_id, "results": {}}

    # Resolve word → lemma from word_classifications for this movie. The
    # classifier saw the word in full sentence context, so its lemma is
    # accurate. Bare-word spaCy lemmatization is wrong for many forms
    # ("bookmaking" → "bookmake", "abuses" → "abuse" but only sometimes,
    # any short fragment from a tokenization artifact gets mangled). Using
    # the classified lemma keeps the request path consistent with the
    # indexer and removes spaCy from the hot path.
    t_lemma = time.perf_counter()
    classifications = await db.wordclassification.find_many(
        where={
            "script": {"is": {"movieId": movie_id}},
            "word": {"in": single_words, "mode": "insensitive"},
        }
    )
    word_to_lemma: Dict[str, str] = {}
    for wc in classifications:
        word_to_lemma[wc.word.lower()] = wc.lemma.lower()
    # Fallback for any input not in classifications (shouldn't happen for
    # the For You flow, but defensive): treat the word as its own lemma.
    for w in single_words:
        if w not in word_to_lemma:
            word_to_lemma[w] = w
    lemma_ms = (time.perf_counter() - t_lemma) * 1000
    nlp_load_ms = 0.0  # nlp is loaded lazily only by the slow-path fallback

    # Resolve lemmas → ids in a single query.
    unique_lemmas = list({lemma for lemma in word_to_lemma.values()})
    t_lemma_q = time.perf_counter()
    lemma_records = await db.lemma.find_many(where={"lemma": {"in": unique_lemmas}})
    lemma_q_ms = (time.perf_counter() - t_lemma_q) * 1000
    lemma_str_to_id = {lr.lemma: lr.id for lr in lemma_records}

    if not lemma_str_to_id:
        total_ms = (time.perf_counter() - t_start) * 1000
        logger.warning(
            f"[batch-sentences] movie={movie_id} NO LEMMA MATCHES "
            f"words={n_single} unique_lemmas={len(unique_lemmas)} "
            f"sample_lemmas={unique_lemmas[:5]} total={total_ms:.0f}ms"
        )
        return {"movie_id": movie_id, "results": {word: [] for word in word_to_lemma}}

    # One query for every link in this movie keyed by these lemmas.
    t_links = time.perf_counter()
    links = await db.sentencelemmalink.find_many(
        where={
            "lemmaId": {"in": list(lemma_str_to_id.values())},
            "sentence": {"movieId": movie_id},
        },
        include={"sentence": True},
        order={"score": "desc"},
    )
    links_ms = (time.perf_counter() - t_links) * 1000

    # Group by lemma, capped at max_examples per lemma. The list is already
    # sorted by score desc, so we just take the head of each bucket.
    by_lemma_id: Dict[int, list] = {}
    for link in links:
        bucket = by_lemma_id.setdefault(link.lemmaId, [])
        if len(bucket) < request.max_examples:
            bucket.append(link)

    results: Dict[str, list] = {}
    n_hit_fast = 0
    n_matched_form_null = 0
    missing_words: List[str] = []
    for word, lemma_str in word_to_lemma.items():
        lemma_id = lemma_str_to_id.get(lemma_str)
        bucket = by_lemma_id.get(lemma_id, []) if lemma_id is not None else []
        if bucket:
            n_hit_fast += 1
            for link in bucket:
                if link.matchedForm is None:
                    n_matched_form_null += 1
            results[word] = [
                {
                    "sentence": link.sentence.sentence,
                    "word_position": link.wordPosition or 0,
                    "matched_form": link.matchedForm or word,
                }
                for link in bucket
            ]
        else:
            results[word] = []
            missing_words.append(word)

    # ─── Slow-path fallback ─────────────────────────────────────────────────
    # Only fires for movies that haven't been indexed at all (no SentenceBank
    # rows). For indexed movies, we trust whatever the lemma-based indexer
    # produced — burning ~1-2s of spaCy at request time to scrape another
    # one or two sentences for marginal coverage doesn't pay off. Cold/
    # unindexed movies still get a one-time bootstrap so first-time access
    # works, and the backfill script handles the rest offline.
    n_hit_slow = 0
    slow_path_ms = 0.0
    movie_already_indexed = await db.sentencebank.find_first(
        where={"movieId": movie_id}
    ) is not None
    if missing_words and not movie_already_indexed:
        t_slow = time.perf_counter()
        try:
            movie = await db.movie.find_unique(
                where={"id": movie_id},
                include={"movieScripts": True},
            )
            script_text = (
                movie.movieScripts[0].cleanedScriptText
                if movie and movie.movieScripts and movie.movieScripts[0].cleanedScriptText
                else None
            )
            if script_text:
                # Lazy-load spaCy only when the slow path actually fires;
                # the fast path no longer needs it.
                from src.services.lemmatization_service import get_nlp
                t_nlp = time.perf_counter()
                nlp = get_nlp()
                nlp_load_ms = (time.perf_counter() - t_nlp) * 1000
                missing_lemmas = {word_to_lemma[w] for w in missing_words}
                sentence_service = SentenceExampleService()
                slow_results = sentence_service.extract_sentences_for_lemmas(
                    script_text,
                    missing_lemmas,
                    nlp,
                    max_per_lemma=request.max_examples,
                )
                for word in missing_words:
                    lemma = word_to_lemma[word]
                    sents = slow_results.get(lemma, [])
                    if sents:
                        n_hit_slow += 1
                        results[word] = [
                            {
                                "sentence": sent,
                                "word_position": pos,
                                "matched_form": form,
                            }
                            for sent, pos, form in sents
                        ]
        except Exception as fallback_err:
            logger.warning(
                f"[batch-sentences] slow-path fallback failed: {fallback_err}",
                exc_info=True,
            )
        slow_path_ms = (time.perf_counter() - t_slow) * 1000

    total_ms = (time.perf_counter() - t_start) * 1000
    slow_path_state = "fired" if slow_path_ms > 0 else (
        "skipped(indexed)" if movie_already_indexed else "skipped(no-misses)"
    )
    logger.info(
        f"[batch-sentences] movie={movie_id} "
        f"in={n_in} single={n_single} lemmas={len(unique_lemmas)} "
        f"lemma_rows={len(lemma_records)} links={len(links)} "
        f"hits_fast={n_hit_fast}/{n_single} hits_slow={n_hit_slow}/{len(missing_words) or 0} "
        f"slow_path={slow_path_state} legacy_null_matched_form={n_matched_form_null} "
        f"| timing nlp_load={nlp_load_ms:.0f}ms classifications_q={lemma_ms:.0f}ms "
        f"lemma_q={lemma_q_ms:.0f}ms links_q={links_ms:.0f}ms "
        f"slow_path_t={slow_path_ms:.0f}ms total={total_ms:.0f}ms"
    )

    return {"movie_id": movie_id, "results": results}


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


# ================================================================
# V2 API Endpoints (Phase 4 — Context-Aware Translation)
# ================================================================


class V2EnrichRequest(BaseModel):
    """Request for V2 enrichment (Stage B: Translation)"""
    target_lang: str = Field(..., description="Target language code")


@router.post("/v2/movies/{movie_id}/start")
async def start_v2_enrichment(
    movie_id: int,
    request: V2EnrichRequest,
    background_tasks: BackgroundTasks,
    db: Prisma = Depends(get_db)
):
    """
    Start V2 enrichment Stage B (translation) for a movie.
    Assumes Stage A (NLP: lemmatization, sentence extraction, sense clustering) is done.
    Translates eager senses and propagates to WordSentenceExample.
    """
    try:
        target = request.target_lang.upper()

        # Verify NLP stage is done (lemma mappings exist)
        mapping_count = await db.movielemmamapping.count(
            where={"movieId": movie_id}
        )
        if mapping_count == 0:
            raise HTTPException(
                status_code=400,
                detail="Movie has no lemma mappings. Run V1 enrichment (Stage A) first."
            )

        async def run_v2_translation():
            from src.database import get_db as get_bg_db
            bg_db = await get_bg_db()
            try:
                tm_service = TranslationMemoryService(bg_db)
                stats = await tm_service.translate_movie_eager(
                    movie_id=movie_id, target_lang=target
                )
                logger.info(f"V2 Stage B complete for movie {movie_id}: {stats}")

                prop_count = await tm_service.propagate_to_word_sentence_examples(
                    movie_id=movie_id, target_lang=target
                )
                logger.info(f"V2 propagated {prop_count} WordSentenceExample entries")
            finally:
                await bg_db.disconnect()

        background_tasks.add_task(run_v2_translation)

        return {
            "status": "started",
            "movie_id": movie_id,
            "target_lang": target,
            "estimated_eager_lemmas": mapping_count,
            "message": "V2 translation pipeline started in background."
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"V2 enrichment start failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/v2/translation-memory/word/{word}")
async def get_translation_memory_word(
    word: str,
    lang: str,
    db: Prisma = Depends(get_db)
):
    """
    Look up all sense-aware translations for a word from TranslationMemory.

    Returns all senses with their translations for the given target language.
    """
    try:
        target = lang.upper()

        # Find lemma
        from src.services.lemmatization_service import get_nlp
        nlp = get_nlp()
        doc = nlp(word.lower().strip())
        if not doc:
            raise HTTPException(status_code=404, detail=f"Cannot lemmatize '{word}'")
        lemma_text = doc[0].lemma_

        lemma = await db.lemma.find_first(where={"lemma": lemma_text})
        if not lemma:
            raise HTTPException(status_code=404, detail=f"Lemma '{lemma_text}' not found")

        # Get all senses with translations
        senses = await db.wordsense.find_many(
            where={"lemmaId": lemma.id},
            include={"translations": {"where": {"targetLang": target}}}
        )

        sense_list = []
        for sense in senses:
            tm = sense.translations[0] if sense.translations else None
            sense_list.append({
                "sense_id": sense.id,
                "sense_index": sense.senseIndex,
                "label": sense.label,
                "representative_sentence": sense.representativeSentence,
                "translation": tm.translatedWord if tm else None,
                "sentence_translation": tm.translatedSentence if tm else None,
                "provider": tm.wordProvider if tm else None,
                "usage_count": tm.usageCount if tm else 0,
                "report_count": tm.reportCount if tm else 0,
            })

        return {
            "lemma": lemma.lemma,
            "pos": lemma.pos,
            "cefr_level": lemma.cefrLevel,
            "priority_score": lemma.priorityScore,
            "target_lang": target,
            "senses": sense_list,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"V2 TM lookup failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/v2/translation-memory/{tm_id}/report")
async def report_translation(
    tm_id: int,
    background_tasks: BackgroundTasks,
    db: Prisma = Depends(get_db)
):
    """
    Report a bad translation. Increments reportCount.
    If report rate exceeds 10% (with min 5 usages), triggers auto-retranslation with DeepL.
    """
    try:
        tm_service = TranslationMemoryService(db)
        result = await tm_service.report_translation(tm_id)
        return result
    except Exception as e:
        logger.error(f"Report failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/v2/translation-memory/stats")
async def get_tm_stats(
    lang: Optional[str] = None,
    db: Prisma = Depends(get_db)
):
    """Get TranslationMemory statistics."""
    try:
        tm_service = TranslationMemoryService(db)
        return await tm_service.get_translation_memory_stats(target_lang=lang)
    except Exception as e:
        logger.error(f"TM stats failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ================================================================
# V2 Phase 5 Endpoints — Optimization & Quality
# ================================================================


@router.post("/v2/backfill")
async def backfill_all_movies(
    background_tasks: BackgroundTasks,
    db: Prisma = Depends(get_db)
):
    """
    Backfill all existing movies through V2 Stage A pipeline
    (lemmatization, sentence bank, sense clustering).
    Skips movies that already have MovieLemmaMapping entries.
    Runs in background.
    """
    async def run_backfill():
        from src.database import get_db as get_bg_db
        bg_db = await get_bg_db()
        try:
            service = V2OptimizationService(bg_db)
            stats = await service.backfill_all_movies()
            logger.info(f"Backfill complete: {stats}")
        finally:
            await bg_db.disconnect()

    background_tasks.add_task(run_backfill)
    return {"status": "started", "message": "V2 backfill started in background. Check logs for progress."}


@router.post("/v2/migrate-cache")
async def migrate_translation_cache(
    lang: Optional[str] = None,
    background_tasks: BackgroundTasks = None,
    db: Prisma = Depends(get_db)
):
    """
    Migrate V1 TranslationCache entries into TranslationMemory.
    Matches cached translations to lemmas/senses and creates TM entries.
    """
    try:
        service = V2OptimizationService(db)
        stats = await service.migrate_translation_cache(target_lang=lang)
        return stats
    except Exception as e:
        logger.error(f"Cache migration failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/v2/refine-clusters")
async def refine_clusters_minilm(
    lemma_id: Optional[int] = None,
    merge_threshold: float = 0.88,
    background_tasks: BackgroundTasks = None,
    db: Prisma = Depends(get_db)
):
    """
    Run MiniLM hybrid clustering refinement.
    Merges senses that are semantically identical (MiniLM similarity > threshold).
    Optionally restrict to a single lemma by ID.
    """
    async def run_refinement():
        from src.database import get_db as get_bg_db
        bg_db = await get_bg_db()
        try:
            service = V2OptimizationService(bg_db)
            stats = await service.refine_clusters_with_minilm(
                lemma_id=lemma_id,
                similarity_merge_threshold=merge_threshold,
            )
            logger.info(f"MiniLM refinement complete: {stats}")
        finally:
            await bg_db.disconnect()

    background_tasks.add_task(run_refinement)
    return {
        "status": "started",
        "message": "MiniLM cluster refinement started in background.",
        "lemma_id": lemma_id,
        "merge_threshold": merge_threshold,
    }


@router.post("/v2/recalculate-priorities")
async def recalculate_priority_scores(
    db: Prisma = Depends(get_db)
):
    """
    Recompute priorityScore for all lemmas using fresh usage data.
    Incorporates click rate from TranslationMemory usageCount.
    """
    try:
        service = V2OptimizationService(db)
        stats = await service.recalculate_priority_scores()
        return stats
    except Exception as e:
        logger.error(f"Priority recalculation failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/v2/cost-monitoring")
async def get_cost_monitoring(
    lang: Optional[str] = None,
    db: Prisma = Depends(get_db)
):
    """
    Get cost monitoring dashboard: cache hit rates, API call counts,
    provider breakdown, eager/lazy coverage.
    """
    try:
        service = V2OptimizationService(db)
        return await service.get_cost_monitoring_stats(target_lang=lang)
    except Exception as e:
        logger.error(f"Cost monitoring failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/v2/quality-metrics")
async def get_quality_metrics(
    lang: Optional[str] = None,
    db: Prisma = Depends(get_db)
):
    """
    Get quality metrics: reported translations, retranslation candidates,
    provider quality comparison, sense distribution.
    """
    try:
        service = V2OptimizationService(db)
        return await service.get_quality_metrics(target_lang=lang)
    except Exception as e:
        logger.error(f"Quality metrics failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/v2/benchmarks")
async def run_benchmarks(
    db: Prisma = Depends(get_db)
):
    """
    Run performance benchmarks: TM lookup, sense selection, spaCy lemmatization.
    Returns average latencies in milliseconds.
    """
    try:
        service = V2OptimizationService(db)
        return await service.run_performance_benchmarks()
    except Exception as e:
        logger.error(f"Benchmarks failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/v2/migration-readiness")
async def check_migration_readiness(
    db: Prisma = Depends(get_db)
):
    """
    Check whether V2 is ready to fully replace V1 dual-write.
    Returns readiness status with specific blockers if not ready.
    """
    try:
        service = V2OptimizationService(db)
        return await service.check_migration_readiness()
    except Exception as e:
        logger.error(f"Migration readiness check failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
