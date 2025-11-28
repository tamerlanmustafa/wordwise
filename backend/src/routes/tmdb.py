from fastapi import APIRouter, Query
from typing import List, Dict, Any
from ..utils.tmdb_client import TMDBClient
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tmdb", tags=["tmdb"])


@router.get("/autocomplete")
async def autocomplete_movies(
    q: str = Query(..., min_length=1, description="Search query"),
    limit: int = Query(5, ge=1, le=10, description="Max results")
) -> List[Dict[str, Any]]:
    client = TMDBClient()
    try:
        return await client.autocomplete(q, limit)
    finally:
        await client.close()
