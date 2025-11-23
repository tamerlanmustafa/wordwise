"""
Script Ingestion API Endpoints

Provides endpoints for fetching, retrieving, and managing movie scripts.
"""

import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import JSONResponse

from ..database import get_db
from ..services.script_ingestion_service import ScriptIngestionService
from ..schemas.script import (
    ScriptResponse,
    ScriptFetchRequest,
    ScriptSearchResponse,
    ScriptStatsResponse
)
from prisma import Prisma

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/scripts", tags=["scripts"])


# =============================================================================
# MAIN ENDPOINTS
# =============================================================================

@router.post("/fetch", response_model=ScriptResponse)
async def fetch_script(
    request: ScriptFetchRequest,
    db: Prisma = Depends(get_db)
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

    except Exception as e:
        logger.error(f"[API] Script fetch failed for '{request.movie_title}': {str(e)}", exc_info=True)

        if "not found" in str(e).lower() or "no results" in str(e).lower():
            raise HTTPException(
                status_code=404,
                detail=f"Script not found for movie '{request.movie_title}': {str(e)}"
            )
        else:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to fetch script: {str(e)}"
            )


@router.get("/get", response_model=ScriptResponse)
async def get_script(
    title: str = Query(..., min_length=1, description="Movie title"),
    movie_id: Optional[int] = Query(None, description="Movie database ID"),
    db: Prisma = Depends(get_db)
):
    """
    Get a script from the database ONLY (no external fetching).

    Use this endpoint to check if a script is already cached without
    triggering any external API calls.

    Args:
        title: Movie title
        movie_id: Optional movie database ID

    Returns:
        ScriptResponse if found in database

    Raises:
        404: Script not found in database
    """
    logger.info(f"[API] Script get request: title='{title}', movie_id={movie_id}")

    try:
        # Search database
        if movie_id:
            script = await db.moviescript.find_unique(
                where={"movieId": movie_id},
                include={"movie": True}
            )
        else:
            movie = await db.movie.find_first(
                where={"title": {"contains": title, "mode": "insensitive"}},
                include={"movieScripts": True}
            )

            if movie and movie.movieScripts:
                script = movie.movieScripts[0]
            else:
                script = None

        if not script:
            raise HTTPException(
                status_code=404,
                detail=f"No cached script found for '{title}'"
            )

        logger.info(f"[API] ✓ Script found in database for '{title}'")

        return ScriptResponse(
            script_id=script.id,
            movie_id=script.movieId,
            source_used=script.sourceUsed,
            cleaned_text=script.cleanedScriptText or "",
            word_count=script.cleanedWordCount or 0,
            is_complete=script.isComplete,
            is_truncated=script.isTruncated,
            from_cache=True,
            metadata={},
            fetched_at=script.fetchedAt
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[API] Failed to get script for '{title}': {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve script: {str(e)}"
        )


@router.get("/search")
async def search_movies(
    query: str = Query(..., min_length=1, description="Movie title to search"),
    db: Prisma = Depends(get_db)
):
    """
    Search for movies matching the query.

    Returns ALL matching movies from STANDS4 so the user can select the exact one.
    This fixes the issue where "Titanic" returns "National Geographic: Secrets of the Titanic".

    Args:
        query: Movie title to search

    Returns:
        List of matching movies with:
        - id: Script ID
        - title: Movie title
        - year: Release year
        - subtitle: Description
        - author: Writer/director
        - genre: Genre
        - link: Script page URL
    """
    logger.info(f"[API] Movie search: query='{query}'")

    try:
        # Initialize STANDS4 client
        from ..utils.stands4_client import STANDS4Client
        stands4 = STANDS4Client()

        # Search STANDS4 for ALL matching movies
        results = await stands4.search_movie(query)

        # Close client
        await stands4.client.aclose()

        logger.info(f"[API] Found {len(results)} movies matching '{query}'")

        return {
            "query": query,
            "results": results,
            "total": len(results)
        }

    except Exception as e:
        logger.error(f"[API] Search failed for '{query}': {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Search failed: {str(e)}"
        )


# =============================================================================
# STATISTICS & ADMIN ENDPOINTS
# =============================================================================

@router.get("/stats", response_model=ScriptStatsResponse)
async def get_script_stats(db: Prisma = Depends(get_db)):
    """
    Get statistics about the script library.

    Returns:
        ScriptStatsResponse with aggregate statistics
    """
    logger.info("[API] Fetching script statistics")

    try:
        # Get all scripts
        scripts = await db.moviescript.find_many()

        if not scripts:
            return ScriptStatsResponse(
                total_scripts=0,
                by_source={},
                total_words=0,
                avg_words_per_script=0,
                complete_scripts=0,
                truncated_scripts=0
            )

        # Calculate stats
        by_source = {}
        total_words = 0
        complete_count = 0
        truncated_count = 0

        for script in scripts:
            # Count by source
            source = script.sourceUsed
            by_source[source] = by_source.get(source, 0) + 1

            # Sum words
            total_words += script.cleanedWordCount or 0

            # Count complete/truncated
            if script.isComplete:
                complete_count += 1
            if script.isTruncated:
                truncated_count += 1

        avg_words = total_words / len(scripts) if scripts else 0

        return ScriptStatsResponse(
            total_scripts=len(scripts),
            by_source=by_source,
            total_words=total_words,
            avg_words_per_script=round(avg_words, 2),
            complete_scripts=complete_count,
            truncated_scripts=truncated_count
        )

    except Exception as e:
        logger.error(f"[API] Failed to fetch stats: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch statistics: {str(e)}"
        )


@router.delete("/{script_id}")
async def delete_script(
    script_id: int,
    db: Prisma = Depends(get_db)
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
