"""
Word Example Enrichment API Routes

Endpoints for enriching movies with sentence examples and translations.
"""

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from typing import List, Optional, Dict
import logging

from src.database import get_db
from src.middleware.auth import get_current_active_user, get_admin_user
from src.utils.nlp_executor import NLPOverloaded, nlp_slot, run_nlp
from src.utils.rate_limit import rate_limit
from prisma import Prisma
from src.config import get_settings
from src.services.sentence_example_service import SentenceExampleService
from src.services.example_translation_service import ExampleTranslationService
from src.services.sentence_bank_service import populate_sentence_bank


# Read-path preference: prefer LLM-authored sentences over any legacy
# subtitle-extracted rows. Tatoeba / public-domain fallbacks slot in
# between. Lower number = higher priority.
SENTENCE_SOURCE_PRIORITY = {
    "llm": 0,
    "tatoeba": 1,
    "public_domain": 2,
    "subtitle": 3,
}


def _sentence_link_sort_key(link):
    """Ranking used by every SentenceLemmaLink read path.

    Priority: source (LLM-authored beats subtitle extraction) → movie-tied
    beats a global row within the same source (honors legacy per-movie LLM
    rows) → higher score breaks ties. Both `/sentences/{word}` and
    `/sentences/batch` sort with this so the collapsed preview and the
    expanded sentence always resolve to the same row.
    """
    return (
        SENTENCE_SOURCE_PRIORITY.get(link.sentence.source, 99),
        0 if link.sentence.movieId is not None else 1,
        -(link.score or 0.0),
    )


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/enrichment", tags=["Enrichment"])

# These read paths incur real per-call external cost on a miss: the single
# endpoint translates sentences on-demand via DeepL/Google, and the batch
# endpoint's slow path authors example sentences with Claude (capped
# cumulatively by LLM_COST_CAP_USD). Throttle per caller so one client can't
# burn budget/latency by fanning out misses, on top of the global limiter.
_sentences_throttle = rate_limit(120, 60.0, scope="enrichment-sentences")
_sentences_batch_throttle = rate_limit(30, 60.0, scope="enrichment-sentences-batch")

# /sentences/{word} has a slow path that parses a whole script (1.6-2.9s) when
# SentenceBank has nothing for the word. Since #143 that parse runs on the NLP
# worker thread, so it no longer stalls the process — but one worker means the
# queue is the thing that grows, and this endpoint is reached by tapping a word,
# one tap per word, with the row already open and waiting.
#
# Hence a lower cap than /movies/{id}/vocabulary/preview's 4: at ~2.5s a parse,
# three already in line means the last caller waits ~9s. Past that, answering
# "no sentence" immediately beats answering correctly after the user has closed
# the row. The cap is a priority, not a reservation — every caller decrements
# the same counter, so a small number here also means this endpoint yields to
# the cheaper, cached paths rather than crowding them out.
MAX_PENDING_SENTENCE_PARSES = 3


# Lazy singleton for the word-gloss aligner so we build the Anthropic client
# once, not per request. `_align_service_off` latches when there's no API key
# (or the SDK is unavailable) so we don't retry construction every reveal.
_align_service = None
_align_service_off = False


def _get_align_service():
    global _align_service, _align_service_off
    if _align_service_off:
        return None
    if _align_service is None:
        try:
            from src.services.llm_sentence_service import LLMSentenceService
            _align_service = LLMSentenceService()
        except Exception as e:  # no ANTHROPIC_API_KEY, SDK missing, etc.
            logger.info(f"[align] gloss aligner disabled: {e}")
            _align_service_off = True
            return None
    return _align_service


async def _aligned_word_gloss(
    db, word: str, sentence: Optional[str], sentence_translation: Optional[str], target_lang: str
) -> Optional[str]:
    """Best-effort: the word's translation aligned to the sentence translation
    (so the card gloss matches the sentence). Never raises — returns None on
    cost-cap, missing key, or any model/parse error, and the caller falls back
    to a plain word translation."""
    if not sentence or not sentence_translation:
        return None
    svc = _get_align_service()
    if svc is None:
        return None
    try:
        from src.services.llm_sentence_service import CostCapExceeded
        return await svc.align_word_translation(
            db, word, sentence, sentence_translation, target_lang
        )
    except CostCapExceeded:
        return None
    except Exception as e:
        logger.warning(f"[align] gloss failed word='{word}': {e}")
        return None


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

# V1 enrichment: no longer routed (V2 is the active client-facing path),
# but `cefr.py:auto_enrich_after_classification` still invokes this directly
# as a background task, so the function body is retained.
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
        except Exception as e:
            # Non-fatal: SentenceBank dual-write must not break enrichment.
            logger.error(f"SentenceBank population failed (non-fatal): {e}", exc_info=True)

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
    db: Prisma = Depends(get_db),
    current_user = Depends(get_current_active_user),
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
    db: Prisma = Depends(get_db),
    current_user = Depends(get_current_active_user),
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
    db: Prisma = Depends(get_db),
    admin_user = Depends(get_admin_user),
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
                    except Exception as e:
                        logger.error(f"SentenceBank population failed (non-fatal): {e}", exc_info=True)

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
    db: Prisma = Depends(get_db),
    current_user = Depends(get_current_active_user),
    _: None = Depends(_sentences_throttle),
):
    """
    Get sentences containing a word from a movie, with optional cached translation.
    Fast path: query pre-extracted SentenceBank (populated during enrichment).
    Slow path: parse script on-the-fly if SentenceBank has no data.
    If target_lang is provided, returns cached translation or translates on-demand and caches.

    Every spaCy call below goes through `run_nlp` (issue #143). This is an
    `async def`, so a parse called inline here runs on the event loop and stalls
    every other request in the process for its duration — and the slow path is a
    whole-script parse, 1.6-2.9s of it. The two whole-script paths additionally
    take an `nlp_slot`, so a run of cold movies sheds instead of queueing.
    """
    try:
        from src.services.lemmatization_service import get_nlp

        raw_sentences = []
        # True only when a parse was shed at the door — distinguishes "the NLP
        # queue was full" from "this word genuinely has no example sentence",
        # which otherwise look identical (an empty list) in logs and to clients.
        sentences_unavailable = False
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
            phrase_script_text = movie.movieScripts[0].cleanedScriptText

            # A split phrasal verb ("give it up" for "give up") can only be
            # found by the parser, so this walks the whole script — same cost
            # as the slow path below, and the same queue slot.
            def _extract_phrase():
                return sentence_service.extract_phrase_sentences(
                    phrase_script_text,
                    word,
                    get_nlp(),
                    max_examples,
                )

            try:
                with nlp_slot(MAX_PENDING_SENTENCE_PARSES):
                    sentences = await run_nlp(_extract_phrase)
            except NLPOverloaded:
                logger.warning(
                    "movie %s: NLP queue full, serving '%s' without sentences",
                    movie_id, word,
                )
                sentences = []
                sentences_unavailable = True

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
                "sentences_unavailable": sentences_unavailable,
            }

        surface = word.lower().strip()
        # Resolve the lemma exactly like /sentences/batch: prefer the lemma the
        # classifier recorded (it saw the word in full sentence context, so it's
        # accurate — bare-word spaCy mangles many forms) and fall back to a
        # single spaCy parse. Keeping this identical to the batch read path is
        # what makes the collapsed preview and the expanded sentence resolve to
        # the same SentenceBank row.
        classification = await db.wordclassification.find_first(
            where={
                "script": {"is": {"movieId": movie_id}},
                "word": {"equals": surface, "mode": "insensitive"},
            }
        )
        if classification and classification.lemma:
            lemma_text = classification.lemma.lower()
        else:
            # One word, ~0.6ms — but it still goes to the worker, because the
            # first call after a restart is a ~1.8s model load and there is no
            # way to tell from here which one this is. No queue slot: shedding
            # sub-millisecond work would only cost the caller its lemma.
            def _lemmatize_surface():
                doc = get_nlp()(surface)
                return doc[0].lemma_ if doc else surface

            lemma_text = await run_nlp(_lemmatize_surface)

        # Fast path: check SentenceBank via lemma link
        lemma_record = await db.lemma.find_first(where={"lemma": lemma_text})

        if lemma_record:
            # Include global LLM rows (movieId NULL, shared across movies) as
            # well as this movie's rows, then rank with the shared read-path
            # key so an AI-authored sentence wins over a subtitle extraction —
            # identical to /sentences/batch, so expanding a row never swaps the
            # AI sentence for the raw in-movie one.
            links = await db.sentencelemmalink.find_many(
                where={
                    "lemmaId": lemma_record.id,
                    "OR": [
                        {"sentence": {"is": {"movieId": None}}},
                        {"sentence": {"is": {"movieId": movie_id}}},
                    ],
                },
                include={"sentence": True},
            )
            links.sort(key=_sentence_link_sort_key)
            links = links[:max_examples]

            if links:
                # Use stored matched_form when present (populated at indexing
                # time). Fall back to spaCy only for legacy rows where
                # matched_form is NULL — and parse all of them in a single hop
                # via nlp.pipe, not one hop per sentence: each trip to the
                # worker costs a scheduling round-trip and a place in a queue
                # only one thread drains, so N hops is worse than blocking
                # (see utils/offload.py).
                legacy = [i for i, link in enumerate(links) if link.matchedForm is None]
                matched_by_index: Dict[int, str] = {}
                if legacy:
                    legacy_sentences = [links[i].sentence.sentence for i in legacy]

                    def _match_forms():
                        forms = []
                        for parsed in get_nlp().pipe(legacy_sentences):
                            form = word.lower()
                            for token in parsed:
                                if token.lemma_.lower() == lemma_text:
                                    form = token.text
                                    break
                            forms.append(form)
                        return forms

                    forms = await run_nlp(_match_forms)
                    matched_by_index = dict(zip(legacy, forms))

                for i, link in enumerate(links):
                    raw_sentences.append({
                        "sentence": link.sentence.sentence,
                        "word_position": link.wordPosition or 0,
                        "matched_form": (
                            link.matchedForm
                            if link.matchedForm is not None
                            else matched_by_index.get(i, word.lower())
                        ),
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
            script_text = script.cleanedScriptText

            # Both passes live in one closure so the retry rides the same trip
            # to the worker. Two hops would take two queue entries and let
            # another caller's script parse interleave between them.
            def _extract_by_lemma():
                nlp = get_nlp()
                found = sentence_service.extract_word_sentences_by_lemma(
                    script_text,
                    lemma_text,
                    nlp,
                    max_examples,
                    target_surface=surface_form,
                )
                # Fallback: if bare-word lemma disagrees with in-context lemma
                # (e.g., spaCy gives "unimpaire" for "unimpaired" in isolation),
                # retry treating the surface form itself as the lemma target.
                if not found and surface_form != lemma_text:
                    found = sentence_service.extract_word_sentences_by_lemma(
                        script_text,
                        surface_form,
                        nlp,
                        max_examples,
                        target_surface=surface_form,
                    )
                return found

            try:
                with nlp_slot(MAX_PENDING_SENTENCE_PARSES):
                    sentences = await run_nlp(_extract_by_lemma)
            except NLPOverloaded:
                logger.warning(
                    "movie %s: NLP queue full, serving '%s' without sentences",
                    movie_id, word,
                )
                sentences = []
                sentences_unavailable = True

            for sent, pos, form in sentences:
                raw_sentences.append({
                    "sentence": sent,
                    "word_position": pos,
                    "matched_form": form,
                })

        # Look up or create translations if target_lang provided. The reveal
        # (sentence translation + word gloss aligned to it) is cached per
        # (movie, word, sentence, lang) in word_sentence_examples so repeat
        # reveals — by anyone — cost no DeepL/LLM calls.
        if target_lang and raw_sentences:
            from src.services.translation_service import TranslationService
            ts = TranslationService(db)
            tgt = target_lang.upper()
            # UNKNOWN (#91) is not a level, so it takes the same "no usable
            # classification" default as a missing row — it must not reach
            # word_sentence_examples.cefr_level, which the saved-words export
            # renders verbatim.
            cefr_val = classification.cefrLevel if (classification and classification.cefrLevel) else "B1"
            if cefr_val == "UNKNOWN":
                cefr_val = "B1"
            for item in raw_sentences:
                cached_ex = None
                try:
                    cached_ex = await db.wordsentenceexample.find_first(
                        where={
                            "movieId": movie_id,
                            "word": surface,
                            "sentence": item["sentence"],
                            "targetLang": tgt,
                        }
                    )
                except Exception:
                    cached_ex = None
                if cached_ex and cached_ex.wordTranslation:
                    # Fully cached: sentence translation + aligned gloss.
                    item["translation"] = cached_ex.translation
                    item["word_translation"] = cached_ex.wordTranslation
                    continue

                # Sentence translation: reuse the cached row, else translate.
                if cached_ex and cached_ex.translation:
                    item["translation"] = cached_ex.translation
                else:
                    try:
                        result = await ts.get_translation(item["sentence"], tgt, "en")
                        if result and result.get("translated"):
                            item["translation"] = result["translated"]
                    except Exception as tx_err:
                        logger.warning(f"Sentence translation failed: {tx_err}")

                # Align the word gloss to the sentence translation (best-effort).
                gloss = await _aligned_word_gloss(
                    db, surface, item.get("sentence"), item.get("translation"), tgt
                )
                if gloss:
                    item["word_translation"] = gloss

                # Persist for next time (best-effort; unique-race tolerant).
                if item.get("translation"):
                    try:
                        if cached_ex:
                            await db.wordsentenceexample.update(
                                where={"id": cached_ex.id},
                                data={"translation": item["translation"], "wordTranslation": gloss},
                            )
                        else:
                            await db.wordsentenceexample.create(
                                data={
                                    "movieId": movie_id,
                                    "word": surface,
                                    "lemma": lemma_text,
                                    "cefrLevel": cefr_val,
                                    "sentence": item["sentence"],
                                    "translation": item["translation"],
                                    "wordTranslation": gloss,
                                    "targetLang": tgt,
                                    "wordPosition": item.get("word_position") or 0,
                                }
                            )
                    except Exception as up_err:
                        logger.debug(f"word_sentence_example persist skipped: {up_err}")

        return {
            "movie_id": movie_id,
            "word": word.lower(),
            "lemma": lemma_text,
            "sentences": raw_sentences,
            "total": len(raw_sentences),
            "sentences_unavailable": sentences_unavailable,
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
    current_user = Depends(get_current_active_user),
    _: None = Depends(_sentences_batch_throttle),
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

    # Query both global (movieId IS NULL) and movie-tied rows in one shot.
    # Global LLM rows are shared across every movie; movie-tied rows are
    # legacy data (subtitle extractions + the pre-global LLM backfill).
    t_links = time.perf_counter()
    links = await db.sentencelemmalink.find_many(
        where={
            "lemmaId": {"in": list(lemma_str_to_id.values())},
            "OR": [
                {"sentence": {"is": {"movieId": None}}},
                {"sentence": {"is": {"movieId": movie_id}}},
            ],
        },
        include={"sentence": True},
        order={"score": "desc"},
    )
    links_ms = (time.perf_counter() - t_links) * 1000

    # Group by lemma, then sort each bucket so the preferred example wins.
    # Priority: source (llm beats subtitle) → movie-tied beats global within
    # the same source (honors legacy per-movie LLM rows when present) →
    # higher score breaks ties. Cap at max_examples per lemma.
    by_lemma_id: Dict[int, list] = {}
    for link in links:
        by_lemma_id.setdefault(link.lemmaId, []).append(link)
    for lemma_id, bucket in by_lemma_id.items():
        bucket.sort(key=_sentence_link_sort_key)
        by_lemma_id[lemma_id] = bucket[: request.max_examples]

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

    # ─── Slow-path fallback (LLM generation) ────────────────────────────────
    # For words with no cached example sentence in this movie or globally,
    # ask Claude to author one. The sentence is stored globally (movieId
    # NULL) so the next movie that contains the same lemma serves the
    # cached row for free. If ANTHROPIC_API_KEY is unset we leave the words
    # as misses; the offline backfill script can fill them later. Spend is
    # capped by settings.llm_cost_cap_usd — once hit, slow-path is skipped.
    n_hit_slow = 0
    slow_path_ms = 0.0
    slow_path_state = "skipped(no-misses)"
    if missing_words:
        slow_path_state = "skipped(no-llm-key)"
        if get_settings().anthropic_api_key:
            t_slow = time.perf_counter()
            try:
                # Lazy import — the anthropic SDK may not be installed in
                # environments that don't generate sentences (CI, dev).
                from src.services.llm_sentence_service import (
                    CostCapExceeded,
                    LLMSentenceService,
                    ModelCallFailed,
                    WordRequest,
                )

                word_reqs = [
                    WordRequest(
                        word=w,
                        lemma=word_to_lemma[w],
                        cefr=None,  # CEFR lookup is cheap to add later
                    )
                    for w in missing_words
                    if word_to_lemma.get(w) in lemma_str_to_id
                ]
                if word_reqs:
                    llm = LLMSentenceService()
                    try:
                        llm_results = await llm.generate_and_store(
                            db,
                            words=word_reqs,
                            lemma_id_map=lemma_str_to_id,
                            context="batch_endpoint",
                        )
                        for word, payload in llm_results.items():
                            n_hit_slow += 1
                            results[word] = [payload]
                        slow_path_state = "fired"
                    except CostCapExceeded as cap_err:
                        logger.warning(f"[batch-sentences] {cap_err}")
                        slow_path_state = "skipped(cost-cap)"
                    except ModelCallFailed as call_err:
                        # #153 split this out of the all-None return below.
                        # Same outcome for the caller — no sentences, no
                        # error — but the log line now says the API was
                        # unreachable rather than claiming the slow path
                        # "fired" and found nothing.
                        logger.warning(
                            f"[batch-sentences] llm unavailable: {call_err}"
                        )
                        slow_path_state = "skipped(llm-unavailable)"
            except Exception as fallback_err:
                logger.warning(
                    f"[batch-sentences] llm slow-path failed: {fallback_err}",
                    exc_info=True,
                )
                slow_path_state = "errored"
            slow_path_ms = (time.perf_counter() - t_slow) * 1000

    total_ms = (time.perf_counter() - t_start) * 1000
    logger.info(
        f"[batch-sentences] movie={movie_id} "
        f"in={n_in} single={n_single} lemmas={len(unique_lemmas)} "
        f"lemma_rows={len(lemma_records)} links={len(links)} "
        f"hits_fast={n_hit_fast}/{n_single} hits_slow={n_hit_slow}/{len(missing_words) or 0} "
        f"slow_path={slow_path_state} legacy_null_matched_form={n_matched_form_null} "
        f"| timing classifications_q={lemma_ms:.0f}ms "
        f"lemma_q={lemma_q_ms:.0f}ms links_q={links_ms:.0f}ms "
        f"llm_slow_path={slow_path_ms:.0f}ms total={total_ms:.0f}ms"
    )

    return {"movie_id": movie_id, "results": results}


@router.get("/movies/{movie_id}/examples/{word}", response_model=WordExamplesResponse)
async def get_word_examples(
    movie_id: int,
    word: str,
    lang: str,
    db: Prisma = Depends(get_db),
    current_user = Depends(get_current_active_user),
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
