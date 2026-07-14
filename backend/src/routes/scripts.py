"""
Script Ingestion API Endpoints

Provides endpoints for fetching, retrieving, and managing movie scripts.
"""

import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import JSONResponse

from ..database import get_db
from ..middleware.auth import get_admin_user, get_current_active_user
from ..services.script_ingestion_service import ScriptIngestionService, ScriptNotFoundError
from ..schemas.script import (
    ScriptResponse,
    ScriptFetchRequest,
    ScriptSearchResponse,
)
from ..utils.rate_limit import rate_limit
from prisma import Prisma

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/scripts", tags=["scripts"])

# Both endpoints fan out to paid upstream APIs (STANDS4, OpenSubtitles, TMDB)
# and /fetch also persists Movie/MovieScript rows, so they must never be
# reachable anonymously or unthrottled. The background worker no longer goes
# through this route — it calls ScriptIngestionService directly (see
# workers/processor.py), same as it already does for classification.
_fetch_throttle = rate_limit(5, 60.0, scope="scripts-fetch")
_search_throttle = rate_limit(20, 60.0, scope="scripts-search")


# =============================================================================
# MAIN ENDPOINTS
# =============================================================================

@router.post("/fetch", response_model=ScriptResponse)
async def fetch_script(
    request: ScriptFetchRequest,
    db: Prisma = Depends(get_db),
    current_user=Depends(get_current_active_user),
    _: None = Depends(_fetch_throttle),
):
    """
    Fetch or retrieve a movie script.

    This endpoint implements the complete ingestion pipeline:
    1. Checks database first (unless force_refresh=True)
    2. If not cached, tries sources in priority order:
       - STANDS4 PDF (full script)
       - STANDS4 API (script text)
       - Subtitle API (SRT dialogue)
       - Synopsis (last resort)
    3. Saves result to database for future use

    Args:
        request: ScriptFetchRequest with movie_title, optional year, force_refresh

    Returns:
        ScriptResponse with complete script data

    Raises:
        404: Movie not found in any source
        500: Processing error
    """
    logger.info(
        f"[API] Script fetch request: title='{request.movie_title}', "
        f"force_refresh={request.force_refresh}"
    )

    try:
        # Initialize ingestion service
        service = ScriptIngestionService(db)

        # Fetch script
        result = await service.get_or_fetch_script(
            movie_title=request.movie_title,
            script_id=request.script_id,
            movie_id=request.movie_id,
            tmdb_id=request.tmdb_id,
            year=request.year,
            force_refresh=request.force_refresh
        )

        # Clean up
        await service.close()

        logger.info(
            f"[API] ✓ Script fetched successfully for '{request.movie_title}' "
            f"(source={result['source_used']}, from_cache={result['from_cache']})"
        )

        return ScriptResponse(**result)

    except ScriptNotFoundError as e:
        # We reached every source and none had this movie — a permanent miss,
        # so 404 (the worker parks the job as dead on the same signal). A
        # transient outage raises a plain Exception instead → 500 below, which
        # the worker retries on backoff. Keyed on exception type, not error
        # strings, so a source's own "not found" text can't be misclassified.
        logger.info(f"[API] Script not found for '{request.movie_title}': {e}")
        raise HTTPException(
            status_code=404,
            detail=f"Script not found for movie '{request.movie_title}': {e}"
        )
    except Exception as e:
        logger.error(f"[API] Script fetch failed for '{request.movie_title}': {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch script: {str(e)}"
        )




@router.get("/search")
async def search_movies(
    query: str = Query(..., min_length=1, description="Movie title to search"),
    db: Prisma = Depends(get_db),
    current_user=Depends(get_current_active_user),
    _: None = Depends(_search_throttle),
):
    """
    Search for movies matching the query.

    Returns matching movies from STANDS4 with TMDB metadata (poster, year, overview).
    TMDB is used ONLY for UI metadata - NOT for scripts or vocabulary.

    If no results are found, user can still type any movie title and fetch it -
    the ingestion pipeline will try Subliminal (OpenSubtitles) first for actual
    movie subtitles/dialogue.

    Args:
        query: Movie title to search

    Returns:
        Dictionary with:
        - query: Search query
        - results: List of STANDS4 movies
        - total: Number of results
        - tmdb_metadata: TMDB metadata (poster, year, overview, genres) or None
    """
    logger.info(f"[API] Movie search: query='{query}'")

    try:
        import asyncio
        from ..utils.stands4_client import STANDS4Client
        from ..utils.tmdb_client import TMDBClient

        # Initialize clients
        stands4 = STANDS4Client()
        tmdb = TMDBClient()

        # Run STANDS4 search and TMDB metadata fetch in parallel
        stands4_task = stands4.search_movie(query)
        tmdb_task = tmdb.get_movie_metadata(query)

        # Wait for both to complete
        stands4_results, tmdb_metadata = await asyncio.gather(
            stands4_task,
            tmdb_task,
            return_exceptions=True
        )

        # Handle STANDS4 results
        if isinstance(stands4_results, Exception):
            logger.warning(f"[API] STANDS4 search failed: {stands4_results}")
            stands4_results = []
        else:
            logger.info(f"[API] Found {len(stands4_results)} STANDS4 results for '{query}'")

        # Handle TMDB metadata (failures are silent)
        if isinstance(tmdb_metadata, Exception):
            logger.warning(f"[API] TMDB metadata fetch failed: {tmdb_metadata}")
            tmdb_metadata = None
        elif tmdb_metadata:
            logger.info(f"[API] ✓ TMDB metadata: {tmdb_metadata.get('title')} ({tmdb_metadata.get('year')})")

        # Close clients
        await stands4.client.aclose()
        await tmdb.close()

        return {
            "query": query,
            "results": stands4_results,
            "total": len(stands4_results),
            "tmdb_metadata": tmdb_metadata
        }

    except Exception as e:
        logger.error(f"[API] Search failed for '{query}': {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Search failed: {str(e)}"
        )


@router.delete("/{script_id}")
async def delete_script(
    script_id: int,
    db: Prisma = Depends(get_db),
    admin_user = Depends(get_admin_user),
):
    """
    Delete a script from the database.

    Useful for removing invalid or outdated scripts.

    Args:
        script_id: Database ID of the script to delete

    Returns:
        Success message
    """
    logger.info(f"[API] Deleting script id={script_id}")

    try:
        script = await db.moviescript.find_unique(where={"id": script_id})

        if not script:
            raise HTTPException(
                status_code=404,
                detail=f"Script {script_id} not found"
            )

        await db.moviescript.delete(where={"id": script_id})

        logger.info(f"[API] ✓ Script {script_id} deleted successfully")

        return JSONResponse(
            status_code=200,
            content={"message": f"Script {script_id} deleted successfully"}
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[API] Failed to delete script {script_id}: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete script: {str(e)}"
        )
