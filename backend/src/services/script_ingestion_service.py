"""
Script Ingestion Service - Main Orchestrator

Multi-source script fetching with database-first strategy and intelligent fallback logic
"""

import json
import logging
from typing import Dict, Optional, List, Tuple
from datetime import datetime

from prisma import Prisma
from prisma.enums import scriptsource

from ..utils.offload import Overloaded
from ..utils.pdf_extractor import PDFExtractor, PDFExtractionError
from ..utils.subtitle_parser import SubtitleParser, SubtitleParsingError
from ..utils.stands4_client import STANDS4Client, STANDS4Error
from ..utils.subtitle_api_client import SubtitleAPIClient, SubtitleAPIError
from ..utils.text_sanitize import sanitize_for_db
from ..database import get_db

logger = logging.getLogger(__name__)


class ScriptNotFoundError(Exception):
    """Every source was reachable and none had this movie's script.

    A *permanent* miss: the worker should park the job as dead and the API
    should return 404. This is deliberately distinct from a transient outage
    (one or more sources raised), which keeps a plain Exception so the worker
    retries on backoff. Conflating the two is what parked 571 retrievable
    films as 'dead' in the 2026-07 incident.
    """


class ScriptIngestionService:
    def __init__(self, db: Prisma):
        self.db = db
        self.pdf_extractor = PDFExtractor()
        self.subtitle_parser = SubtitleParser()
        # Lazy — STANDS4Client() raises when STANDS4_USER_ID/TOKEN are absent,
        # and constructing it here made *every* request 500 (even DB-cached
        # scripts). Deferring to first use lets the cache + subtitle sources
        # work without creds; the per-source try/except in get_or_fetch_script
        # then treats "no creds" as an unavailable source instead of an outage.
        self._stands4_client: Optional[STANDS4Client] = None
        self.subtitle_api_client = SubtitleAPIClient()
        logger.info("[ScriptIngestion] Service initialized")

    @property
    def stands4_client(self) -> STANDS4Client:
        if self._stands4_client is None:
            self._stands4_client = STANDS4Client()
        return self._stands4_client

    async def get_or_fetch_script(
        self,
        movie_title: Optional[str] = None,
        script_id: Optional[str] = None,
        movie_id: Optional[int] = None,
        tmdb_id: Optional[int] = None,
        year: Optional[int] = None,
        force_refresh: bool = False
    ) -> Dict[str, any]:
        search_key = script_id or movie_title
        logger.info(
            f"[ScriptIngestion] Processing '{search_key}' "
            f"(script_id={script_id}, movie_id={movie_id}, tmdb_id={tmdb_id}, year={year}, force_refresh={force_refresh})"
        )

        # If tmdb_id is provided, resolve it to a movie_id first — TMDB IDs are
        # unique, so this disambiguates titles like "The Dark Knight" vs
        # "The Dark Knight Rises".
        if tmdb_id and not movie_id:
            resolved = await self.db.movie.find_unique(where={"tmdbId": tmdb_id})
            if resolved:
                movie_id = resolved.id
                logger.info(f"[ScriptIngestion] Resolved tmdb_id={tmdb_id} → movie_id={movie_id}")

        # Priority 1: Check database cache first (fastest)
        if not force_refresh:
            cached_script = await self._get_from_database(movie_title, movie_id)
            if cached_script:
                logger.info(f"[ScriptIngestion] ✓ Loaded from database for '{movie_title}'")
                return {
                    **cached_script,
                    "from_cache": True
                }

        # Track whether any source *raised* (vs. cleanly returning "no match").
        # If a source errored we treat the overall failure as transient and let
        # the worker retry; only a clean miss from every source is a permanent
        # ScriptNotFoundError. (See the 2026-07 dead-jobs incident.)
        last_error: Optional[Exception] = None

        # Priority 2: Try subtitles (most movies, actual dialogue)
        if not force_refresh:
            logger.info(f"[ScriptIngestion] → Trying SUBTITLE_SRT for '{search_key}'")
            try:
                script_data = await self._fetch_from_subtitle_api(movie_title or search_key, year)
                if script_data and script_data.get("is_valid"):
                    logger.info(f"[ScriptIngestion] ✓ SUCCESS with SUBTITLE_SRT for '{movie_title}'")

                    saved_script = await self._save_to_database(
                        movie_title=movie_title,
                        movie_id=movie_id,
                        tmdb_id=tmdb_id,
                        source_used="SUBTITLE_SRT",
                        script_data=script_data
                    )

                    return {
                        **saved_script,
                        "from_cache": False
                    }
            except Exception as e:
                last_error = e
                logger.warning(f"[ScriptIngestion] ✗ SUBTITLE_SRT failed: {str(e)}")

        # Priority 3 & 4: Try STANDS4 sources
        logger.info(f"[ScriptIngestion] Subtitle and cache failed, trying STANDS4 sources...")

        sources = [
            ("STANDS4_PDF", self._fetch_from_stands4_pdf),
            ("STANDS4_API", self._fetch_from_stands4_api)
        ]

        for source_name, fetch_func in sources:
            try:
                logger.info(f"[ScriptIngestion] → Trying {source_name} for '{search_key}'")

                if script_id and source_name == "STANDS4_PDF":
                    script_data = await fetch_func(movie_title, year, script_id=script_id)
                else:
                    script_data = await fetch_func(movie_title or search_key, year)

                if script_data and script_data.get("is_valid"):
                    logger.info(f"[ScriptIngestion] ✓ SUCCESS with {source_name} for '{movie_title}'")

                    saved_script = await self._save_to_database(
                        movie_title=movie_title,
                        movie_id=movie_id,
                        tmdb_id=tmdb_id,
                        source_used=source_name,
                        script_data=script_data
                    )

                    return {
                        **saved_script,
                        "from_cache": False
                    }

                else:
                    logger.warning(f"[ScriptIngestion] ✗ {source_name} returned invalid data for '{movie_title}'")

            except Exception as e:
                last_error = e
                logger.warning(f"[ScriptIngestion] ✗ {source_name} failed for '{movie_title}': {str(e)}")
                continue

        # Every source has now been tried. Distinguish two outcomes that used
        # to be conflated as one permanent "all sources failed":
        #   • a source *raised* (network/timeout/5xx/no-creds) → transient; the
        #     script may well be retrievable later, so let the worker retry on
        #     backoff (plain Exception).
        #   • no source raised, every one cleanly reported no match → the movie
        #     genuinely isn't in any source → permanent ScriptNotFoundError
        #     (park the job / return 404).
        if last_error is not None:
            msg = f"All script sources errored for '{movie_title}': {last_error}"
            logger.error(f"[ScriptIngestion] {msg}")
            raise Exception(msg) from last_error

        msg = f"No script found for '{movie_title}' in any source"
        logger.error(f"[ScriptIngestion] {msg}")
        raise ScriptNotFoundError(msg)

    async def _is_classified(self, script_id: int) -> bool:
        """
        Whether this script already has CEFR word classifications.

        The mobile movie-open path used to call /api/cefr/classify-script and
        wait for it before it could ask for vocabulary, on every open — even
        though for an already-classified movie that call only re-reads what
        /vocabulary/full is about to return anyway (issue #122). Reporting this
        here lets the client drop a whole sequential stage. Counted rather than
        read off `is_preprocessed`, which #105 showed can be true for a script
        that has nothing stored.
        """
        try:
            return await self.db.wordclassification.count(
                where={"scriptId": script_id}
            ) > 0
        except Exception:
            # Only an optimization hint — never fail a fetch over it. False is
            # the safe answer: the client just keeps the old sequential path.
            logger.warning(f"[DB] classification count failed for script {script_id}", exc_info=True)
            return False

    async def _precompute_idioms(self, cleaned_text: Optional[str]):
        """
        Parse the idiom/phrasal-verb list for text about to be stored.

        Returns a Prisma `Json` value to write, or None to leave the column
        NULL — which the read path treats as "not computed yet" and heals on
        first use, so a parse failure here degrades to the old behaviour for
        one request instead of losing idioms for the movie.
        """
        if not cleaned_text:
            return None
        try:
            from prisma import Json

            from .script_idioms import compute_idioms, spacy_available

            # Never store a parse made without the model — the detector falls
            # back to substring matching, which is fine for one response and
            # wrong to keep forever. NULL just means the read path retries.
            if not await spacy_available():
                logger.warning("[DB] spaCy unavailable — leaving idioms NULL rather than storing a degraded parse")
                return None

            idioms = await compute_idioms(cleaned_text)
            logger.info(f"[DB] Precomputed {len(idioms)} idioms/phrasal verbs for script text")
            return Json(idioms)
        except Exception:
            logger.warning("[DB] Idiom precompute failed — leaving column NULL", exc_info=True)
            return None

    async def _get_from_database(
        self,
        movie_title: str,
        movie_id: Optional[int]
    ) -> Optional[Dict[str, any]]:
        try:
            if movie_id:
                script = await self.db.moviescript.find_unique(
                    where={"movieId": movie_id},
                    include={"movie": True}
                )
            else:
                movie = await self.db.movie.find_first(
                    where={"title": {"contains": movie_title, "mode": "insensitive"}},
                    include={"movieScripts": True}
                )

                if movie and movie.movieScripts:
                    script = movie.movieScripts[0]
                else:
                    script = None

            if not script:
                logger.info(f"[DB] No cached script found for '{movie_title}'")
                return None

            # Legacy rows persisted metadata without text — treat as cache miss so the pipeline refetches and overwrites.
            if not script.cleanedScriptText:
                logger.warning(
                    f"[DB] Cached script id={script.id} has empty cleanedScriptText "
                    f"(words={script.cleanedWordCount}) — treating as cache miss"
                )
                return None

            logger.info(f"[DB] Found cached script (source={script.sourceUsed}, words={script.cleanedWordCount})")

            return {
                "script_id": script.id,
                "movie_id": script.movieId,
                "source_used": script.sourceUsed,
                "cleaned_text": script.cleanedScriptText,
                "word_count": script.cleanedWordCount,
                "is_complete": script.isComplete,
                "is_truncated": script.isTruncated,
                "is_classified": await self._is_classified(script.id),
                "metadata": json.loads(script.processingMetadata) if script.processingMetadata else {}
            }

        except Exception as e:
            logger.error(f"[DB] Database lookup failed: {str(e)}", exc_info=True)
            return None

    async def _save_to_database(
        self,
        movie_title: str,
        movie_id: Optional[int],
        source_used: str,
        script_data: Dict[str, any],
        tmdb_id: Optional[int] = None,
    ) -> Dict[str, any]:
        try:
            # Postgres text columns reject NUL bytes (22021), and a source that
            # hands us one fails identically on every retry — a poison pill that
            # burns the job's whole retry budget (#88). Strip control bytes from
            # every string we're about to persist, once, so all sources are
            # covered regardless of which parser produced the text.
            script_data = sanitize_for_db(script_data)
            movie_title = sanitize_for_db(movie_title)

            if not movie_id:
                logger.info(f"[DB] Creating new movie record for '{movie_title}' (tmdb_id={tmdb_id})")

                metadata = script_data.get("metadata", {})
                actual_title = metadata.get("title", movie_title)
                year = metadata.get("year")
                if year and isinstance(year, str):
                    try:
                        year = int(year)
                    except ValueError:
                        year = 2000

                if not year:
                    year = 2000

                create_data = {
                    "title": movie_title,
                    "actualTitle": actual_title,
                    "year": year,
                    "description": metadata.get("synopsis", "")[:500] if metadata.get("synopsis") else None,
                }
                if tmdb_id:
                    create_data["tmdbId"] = tmdb_id

                movie = await self.db.movie.create(data=create_data)
                movie_id = movie.id

            logger.info(f"[DB] Saving script for movie_id={movie_id}, source={source_used}")

            existing = await self.db.moviescript.find_unique(
                where={"movieId": movie_id}
            )

            metadata_json = json.dumps(script_data.get("metadata", {}))

            # Idioms are derived from the text, so they are computed here, once,
            # in the same write that stores the text (issue #106) — rather than
            # on every later read of it. On the update path this also replaces
            # the previous script's idioms, which a refetch would otherwise
            # leave behind as stale derived data.
            idioms = await self._precompute_idioms(script_data.get("cleaned_text"))

            if existing:
                script = await self.db.moviescript.update(
                    where={"movieId": movie_id},
                    data={
                        "sourceUsed": getattr(scriptsource, source_used),
                        "cleanedScriptText": script_data.get("cleaned_text"),
                        "cleanedWordCount": script_data.get("word_count", 0),
                        "isTruncated": script_data.get("is_truncated", False),
                        "isComplete": script_data.get("is_complete", True),
                        "idioms": idioms,
                        "processingMetadata": metadata_json,
                        "fetchedAt": datetime.utcnow(),
                        "updatedAt": datetime.utcnow()
                    }
                )
            else:
                script = await self.db.moviescript.create(
                    data={
                        "movieId": movie_id,
                        "sourceUsed": getattr(scriptsource, source_used),
                        "cleanedScriptText": script_data.get("cleaned_text"),
                        "cleanedWordCount": script_data.get("word_count", 0),
                        "isTruncated": script_data.get("is_truncated", False),
                        "isComplete": script_data.get("is_complete", True),
                        "idioms": idioms,
                        "processingMetadata": metadata_json
                    }
                )

            logger.info(f"[DB] ✓ Script saved successfully (id={script.id})")

            return {
                "script_id": script.id,
                "movie_id": script.movieId,
                "source_used": script.sourceUsed,
                "cleaned_text": script.cleanedScriptText,
                "word_count": script.cleanedWordCount,
                "is_complete": script.isComplete,
                "is_truncated": script.isTruncated,
                "is_classified": await self._is_classified(script.id),
                "metadata": json.loads(script.processingMetadata) if script.processingMetadata else {}
            }



        except Exception as e:
            logger.error(f"[DB] Failed to save script: {str(e)}", exc_info=True)
            raise

    async def _fetch_from_stands4_pdf(
        self,
        movie_title: str,
        year: Optional[int],
        script_id: Optional[str] = None
    ) -> Optional[Dict[str, any]]:
        logger.info(f"[PDF] Attempting PDF fetch for '{movie_title}' (script_id={script_id})")

        try:
            stands4_metadata = {}

            if script_id:
                pdf_url = self.stands4_client.get_pdf_url_from_script_id(script_id)
                logger.info(f"[PDF] Using direct PDF URL from script_id {script_id}: {pdf_url}")
                stands4_metadata = {
                    "script_id": script_id,
                    "method": "direct_script_id"
                }
            else:
                stands4_data = await self.stands4_client.fetch_script(movie_title)

                if not stands4_data.get("has_pdf"):
                    logger.info(f"[PDF] No PDF available for '{movie_title}'")
                    return None

                pdf_url = stands4_data["pdf_url"]
                stands4_metadata = stands4_data.get("metadata", {})

            extraction_result = await self.pdf_extractor.download_and_extract(
                pdf_url=pdf_url,
                movie_title=movie_title
            )

            if not extraction_result["is_valid"]:
                logger.warning(
                    f"[PDF] PDF extracted but failed validation "
                    f"(words={extraction_result['word_count']} < 2000)"
                )
                return None

            return {
                "cleaned_text": extraction_result["cleaned_text"],
                "word_count": extraction_result["word_count"],
                "is_valid": True,
                "is_complete": extraction_result["is_complete"],
                "is_truncated": extraction_result["is_truncated"],
                "metadata": {
                    **stands4_metadata,
                    **extraction_result["metadata"],
                    "pdf_url": pdf_url
                }
            }

        except PDFExtractionError as e:
            logger.warning(f"[PDF] Extraction error: {str(e)}")
            return None
        except Exception as e:
            logger.error(f"[PDF] Unexpected error: {str(e)}", exc_info=True)
            return None

    async def _fetch_from_stands4_api(
        self,
        movie_title: str,
        year: Optional[int]
    ) -> Optional[Dict[str, any]]:
        logger.info(f"[STANDS4] Attempting API fetch for '{movie_title}'")

        try:
            stands4_data = await self.stands4_client.fetch_script(movie_title)

            if not stands4_data.get("has_script"):
                logger.info(f"[STANDS4] No script text available for '{movie_title}'")
                return None

            script_text = stands4_data["script_text"]
            word_count = len(script_text.split())

            if word_count < 1500:
                logger.warning(f"[STANDS4] Script too short (words={word_count})")
                return None

            return {
                "cleaned_text": script_text.strip(),
                "word_count": word_count,
                "is_valid": True,
                "is_complete": True,
                "is_truncated": False,
                "metadata": stands4_data.get("metadata", {})
            }

        except STANDS4Error as e:
            logger.warning(f"[STANDS4] API error: {str(e)}")
            return None
        except Exception as e:
            logger.error(f"[STANDS4] Unexpected error: {str(e)}", exc_info=True)
            return None

    async def _fetch_from_subtitle_api(
        self,
        movie_title: str,
        year: Optional[int]
    ) -> Optional[Dict[str, any]]:
        logger.info(f"[Subtitle] Attempting subtitle fetch for '{movie_title}'")

        try:
            subtitle_data = await self.subtitle_api_client.fetch_subtitle(
                movie_title=movie_title,
                year=year,
                language="en"
            )

            if not subtitle_data or not subtitle_data.get("subtitle_content"):
                logger.info(f"[Subtitle] No subtitle available for '{movie_title}'")
                return None

            subtitle_format = subtitle_data.get("format", "srt")

            if subtitle_format == "vtt":
                parsed = self.subtitle_parser.parse_vtt(
                    subtitle_data["subtitle_content"],
                    movie_title
                )
            else:
                parsed = self.subtitle_parser.parse_srt(
                    subtitle_data["subtitle_content"],
                    movie_title
                )

            if not parsed["is_valid"]:
                logger.warning(
                    f"[Subtitle] Subtitle parsed but failed validation "
                    f"(words={parsed['word_count']} < 1000)"
                )
                return None

            return {
                "cleaned_text": parsed["cleaned_text"],
                "word_count": parsed["word_count"],
                "is_valid": True,
                "is_complete": True,
                "is_truncated": False,
                "metadata": {
                    **subtitle_data.get("metadata", {}),
                    **parsed["metadata"]
                }
            }

        except Overloaded:
            # Returning None here would say "no provider had this movie", which
            # is how a job gets parked dead. We never reached a provider — let
            # it out so `get_or_fetch_script` records it as transient.
            raise
        except SubtitleParsingError as e:
            logger.warning(f"[Subtitle] Parsing error: {str(e)}")
            return None
        except SubtitleAPIError as e:
            logger.warning(f"[Subtitle] API error: {str(e)}")
            return None
        except Exception as e:
            logger.error(f"[Subtitle] Unexpected error: {str(e)}", exc_info=True)
            return None

    async def _fetch_synopsis_fallback(
        self,
        movie_title: str,
        year: Optional[int]
    ) -> Optional[Dict[str, any]]:
        logger.info(f"[Synopsis] Attempting synopsis fetch for '{movie_title}' (LAST RESORT)")

        try:
            stands4_data = await self.stands4_client.fetch_script(movie_title)

            synopsis = stands4_data.get("synopsis")

            if not synopsis or len(synopsis) < 100:
                logger.warning(f"[Synopsis] No adequate synopsis for '{movie_title}'")
                return None

            word_count = len(synopsis.split())

            logger.warning(
                f"[Synopsis] Using synopsis as LAST RESORT for '{movie_title}' "
                f"(words={word_count})"
            )

            return {
                "cleaned_text": synopsis.strip(),
                "word_count": word_count,
                "is_valid": True,
                "is_complete": False,
                "is_truncated": False,
                "metadata": {
                    **stands4_data.get("metadata", {}),
                    "warning": "This is only a synopsis, not a full script"
                }
            }

        except Exception as e:
            logger.error(f"[Synopsis] Failed: {str(e)}", exc_info=True)
            return None

    async def close(self):
        await self.pdf_extractor.close()
        await self.stands4_client.close()
        await self.subtitle_api_client.close()
