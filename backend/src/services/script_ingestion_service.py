"""
Script Ingestion Service - Main Orchestrator

This is the core service that orchestrates multi-source script fetching
with database-first strategy and intelligent fallback logic.
"""

import json
import logging
from typing import Dict, Optional, List, Tuple
from datetime import datetime

from prisma import Prisma
from prisma.enums import scriptsource

from ..utils.pdf_extractor import PDFExtractor, PDFExtractionError
from ..utils.subtitle_parser import SubtitleParser, SubtitleParsingError
from ..utils.stands4_client import STANDS4Client, STANDS4Error
from ..utils.subtitle_api_client import SubtitleAPIClient, SubtitleAPIError
from ..database import get_db

logger = logging.getLogger(__name__)


class ScriptIngestionService:
    """
    Main orchestrator for script ingestion with multi-source fallback.

    Priority Order:
    1. Check database first (unless force_refresh=True)
    2. STANDS4 PDF (highest quality - full script)
    3. STANDS4 Script API (good quality - may be incomplete)
    4. Free Subtitle API - SRT (dialogue only - lower quality but acceptable)
    5. STANDS4 Synopsis (last resort - very low quality)

    Features:
    - Database-first strategy to minimize API calls
    - Intelligent fallback with quality validation
    - Comprehensive logging and error handling
    - Metadata tracking for debugging
    """

    def __init__(self, db: Prisma):
        """
        Initialize ingestion service.

        Args:
            db: Prisma database instance
        """
        self.db = db
        self.pdf_extractor = PDFExtractor()
        self.subtitle_parser = SubtitleParser()
        self.stands4_client = STANDS4Client()
        self.subtitle_api_client = SubtitleAPIClient()

        logger.info("[ScriptIngestion] Service initialized")

    async def get_or_fetch_script(
        self,
        movie_title: Optional[str] = None,
        script_id: Optional[str] = None,
        movie_id: Optional[int] = None,
        year: Optional[int] = None,
        force_refresh: bool = False
    ) -> Dict[str, any]:
        """
        Main entry point: Get script from DB or fetch from external sources.

        This is the core function that implements the complete ingestion pipeline.

        Args:
            movie_title: Movie title to search (optional if script_id provided)
            script_id: STANDS4 script ID from search results (preferred)
            movie_id: Database movie ID (if known)
            year: Movie release year (improves search accuracy)
            force_refresh: If True, bypass cache and refetch

        Returns:
            Dictionary with:
                - script_id: Database ID of the script
                - movie_id: Associated movie ID
                - source_used: Which source provided the script
                - cleaned_text: Final cleaned script text
                - word_count: Word count
                - is_complete: Quality indicator
                - from_cache: Whether loaded from DB
                - metadata: Additional info

        Raises:
            Exception: If all sources fail
        """
        search_key = script_id or movie_title
        logger.info(
            f"[ScriptIngestion] Processing '{search_key}' "
            f"(script_id={script_id}, movie_id={movie_id}, year={year}, force_refresh={force_refresh})"
        )

        # ======================================================================
        # STEP 1: Check database first (unless force_refresh)
        # ======================================================================
        if not force_refresh:
            cached_script = await self._get_from_database(movie_title, movie_id)
            if cached_script:
                logger.info(f"[ScriptIngestion] ✓ Loaded from database for '{movie_title}'")
                return {
                    **cached_script,
                    "from_cache": True
                }

        logger.info(f"[ScriptIngestion] No cached script for '{search_key}', fetching from sources...")

        # ======================================================================
        # STEP 2: Try each source in priority order
        # ======================================================================
        sources = [
            ("STANDS4_PDF", self._fetch_from_stands4_pdf),
            ("STANDS4_API", self._fetch_from_stands4_api),
            ("SUBTITLE_SRT", self._fetch_from_subtitle_api),
            ("SYNOPSIS", self._fetch_synopsis_fallback)
        ]

        last_error = None

        for source_name, fetch_func in sources:
            try:
                logger.info(f"[ScriptIngestion] → Trying {source_name} for '{search_key}'")

                # Pass script_id to fetch functions if available
                if script_id and source_name == "STANDS4_PDF":
                    script_data = await fetch_func(movie_title, year, script_id=script_id)
                else:
                    script_data = await fetch_func(movie_title or search_key, year)

                if script_data and script_data.get("is_valid"):
                    # Success! Save to database
                    logger.info(f"[ScriptIngestion] ✓ SUCCESS with {source_name} for '{movie_title}'")

                    saved_script = await self._save_to_database(
                        movie_title=movie_title,
                        movie_id=movie_id,
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

        # ======================================================================
        # STEP 3: All sources failed
        # ======================================================================
        error_msg = f"All sources failed for '{movie_title}'"
        if last_error:
            error_msg += f": {str(last_error)}"

        logger.error(f"[ScriptIngestion] {error_msg}")
        raise Exception(error_msg)

    # ==========================================================================
    # DATABASE OPERATIONS
    # ==========================================================================

    async def _get_from_database(
        self,
        movie_title: str,
        movie_id: Optional[int]
    ) -> Optional[Dict[str, any]]:
        """
        Retrieve script from database.

        Args:
            movie_title: Movie title
            movie_id: Movie ID if known

        Returns:
            Script data if found, None otherwise
        """
        try:
            # If we have movie_id, use it directly
            if movie_id:
                script = await self.db.moviescript.find_unique(
                    where={"movieId": movie_id},
                    include={"movie": True}
                )
            else:
                # Search by title
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

            logger.info(f"[DB] Found cached script (source={script.sourceUsed}, words={script.cleanedWordCount})")

            return {
                "script_id": script.id,
                "movie_id": script.movieId,
                "source_used": script.sourceUsed,
                "cleaned_text": script.cleanedScriptText,
                "word_count": script.cleanedWordCount,
                "is_complete": script.isComplete,
                "is_truncated": script.isTruncated,
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
        script_data: Dict[str, any]
    ) -> Dict[str, any]:
        """
        Save script to database.

        Creates movie record if needed, then creates script record.

        Args:
            movie_title: Movie title
            movie_id: Movie ID (creates new if None)
            source_used: Source name
            script_data: Script content and metadata

        Returns:
            Saved script data
        """
        try:
            # Ensure we have a movie record
            if not movie_id:
                logger.info(f"[DB] Creating new movie record for '{movie_title}'")

                # Extract metadata
                metadata = script_data.get("metadata", {})

                # Get actual title from metadata (falls back to movie_title)
                actual_title = metadata.get("title", movie_title)

                # Extract year from metadata if available
                year = metadata.get("year")
                if year and isinstance(year, str):
                    try:
                        year = int(year)
                    except ValueError:
                        year = 2000  # Default

                if not year:
                    year = 2000

                movie = await self.db.movie.create(
                    data={
                        "title": movie_title,
                        "actualTitle": actual_title,
                        "year": year,
                        "description": metadata.get("synopsis", "")[:500] if metadata.get("synopsis") else None,
                    }
                )
                movie_id = movie.id

            # Save script
            logger.info(f"[DB] Saving script for movie_id={movie_id}, source={source_used}")

            # Check if script already exists (for force_refresh case)
            existing = await self.db.moviescript.find_unique(
                where={"movieId": movie_id}
            )

            metadata_json = json.dumps(script_data.get("metadata", {}))

            if existing:
                # Update existing
                script = await self.db.moviescript.update(
                    where={"movieId": movie_id},
                    data={
                        "sourceUsed": getattr(scriptsource, source_used),
                        "cleanedScriptText": script_data.get("cleaned_text"),
                        "cleanedWordCount": script_data.get("word_count", 0),
                        "isTruncated": script_data.get("is_truncated", False),
                        "isComplete": script_data.get("is_complete", True),
                        "processingMetadata": metadata_json,
                        "fetchedAt": datetime.utcnow(),
                        "updatedAt": datetime.utcnow()
                    }
                )
            else:
                # Create new
                script = await self.db.moviescript.create(
                    data={
                        "movieId": movie_id,
                        "sourceUsed": getattr(scriptsource, source_used),
                        "cleanedScriptText": script_data.get("cleaned_text"),
                        "cleanedWordCount": script_data.get("word_count", 0),
                        "isTruncated": script_data.get("is_truncated", False),
                        "isComplete": script_data.get("is_complete", True),
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
                "metadata": json.loads(script.processingMetadata) if script.processingMetadata else {}
            }



        except Exception as e:
            logger.error(f"[DB] Failed to save script: {str(e)}", exc_info=True)
            raise

    # ==========================================================================
    # SOURCE FETCHERS
    # ==========================================================================

    async def _fetch_from_stands4_pdf(
        self,
        movie_title: str,
        year: Optional[int],
        script_id: Optional[str] = None
    ) -> Optional[Dict[str, any]]:
        """
        Fetch and extract from STANDS4 PDF.

        Priority 1 - Highest quality source.
        """
        logger.info(f"[PDF] Attempting PDF fetch for '{movie_title}' (script_id={script_id})")

        try:
            stands4_metadata = {}

            # Get PDF URL - directly from script_id if available
            if script_id:
                pdf_url = self.stands4_client.get_pdf_url_from_script_id(script_id)
                logger.info(f"[PDF] Using direct PDF URL from script_id {script_id}: {pdf_url}")
                stands4_metadata = {
                    "script_id": script_id,
                    "method": "direct_script_id"
                }
            else:
                # Get PDF URL from STANDS4 API search
                stands4_data = await self.stands4_client.fetch_script(movie_title)

                if not stands4_data.get("has_pdf"):
                    logger.info(f"[PDF] No PDF available for '{movie_title}'")
                    return None

                pdf_url = stands4_data["pdf_url"]
                stands4_metadata = stands4_data.get("metadata", {})

            # Download and extract PDF
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

            # Success!
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
        """
        Fetch from STANDS4 Script API.

        Priority 2 - Good quality, but may be incomplete.
        """
        logger.info(f"[STANDS4] Attempting API fetch for '{movie_title}'")

        try:
            stands4_data = await self.stands4_client.fetch_script(movie_title)

            if not stands4_data.get("has_script"):
                logger.info(f"[STANDS4] No script text available for '{movie_title}'")
                return None

            script_text = stands4_data["script_text"]

            # Count words
            word_count = len(script_text.split())

            # Validate minimum quality (lower threshold for API than PDF)
            if word_count < 1500:
                logger.warning(f"[STANDS4] Script too short (words={word_count})")
                return None

            # Success!
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
        """
        Fetch from free subtitle API (SRT).

        Priority 3 - Dialogue only, but acceptable quality.
        """
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

            # Parse subtitle based on format
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

            # Success!
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
        """
        Fallback to synopsis (last resort).

        Priority 4 - Very low quality, only use if nothing else available.
        """
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
                "is_valid": True,  # Accept synopsis as last resort
                "is_complete": False,  # Mark as incomplete
                "is_truncated": False,
                "metadata": {
                    **stands4_data.get("metadata", {}),
                    "warning": "This is only a synopsis, not a full script"
                }
            }

        except Exception as e:
            logger.error(f"[Synopsis] Failed: {str(e)}", exc_info=True)
            return None

    # ==========================================================================
    # CLEANUP
    # ==========================================================================

    async def close(self):
        """Close all clients"""
        await self.pdf_extractor.close()
        await self.stands4_client.close()
        await self.subtitle_api_client.close()
