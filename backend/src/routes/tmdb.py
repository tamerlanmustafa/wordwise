from fastapi import APIRouter, Depends, Query
from typing import List, Dict, Any
from ..utils.rate_limit import rate_limit
from ..utils.tmdb_client import TMDBClient
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tmdb", tags=["tmdb"])

# Stays public (the web search bar autocompletes before login), but every
# call burns TMDB quota — throttle per user/IP so it can't be farmed.
_autocomplete_throttle = rate_limit(30, 60.0, scope="tmdb-autocomplete")


@router.get("/autocomplete")
async def autocomplete_movies(
    q: str = Query(..., min_length=1, description="Search query"),
    limit: int = Query(5, ge=1, le=10, description="Max results"),
    _: None = Depends(_autocomplete_throttle),
) -> List[Dict[str, Any]]:
    client = TMDBClient()
    try:
        return await client.autocomplete(q, limit)
    finally:
        await client.close()
