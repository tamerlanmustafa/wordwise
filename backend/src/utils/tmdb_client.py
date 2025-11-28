"""
TMDB (The Movie Database) API Client

Fetches movie metadata (poster, year, overview, genres) for UI display only.
NEVER used for scripts, subtitles, or vocabulary extraction.
"""

import httpx
import logging
from typing import Optional, Dict, Any, List
from ..config import get_settings

logger = logging.getLogger(__name__)

TMDB_BASE_URL = "https://api.themoviedb.org/3"
TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500"


class TMDBClient:
    """Client for fetching movie metadata from TMDB API"""

    def __init__(self):
        settings = get_settings()
        self.api_key = settings.tmdb_api_key
        self.client = httpx.AsyncClient(timeout=10.0)

    async def close(self):
        """Close the HTTP client"""
        await self.client.aclose()

    async def autocomplete(self, query: str, limit: int = 5) -> List[Dict[str, Any]]:
        """
        Lightweight autocomplete search for movies.

        Args:
            query: Search query
            limit: Maximum number of results (default 5)

        Returns:
            List of movie suggestions with minimal metadata:
            [{
                "id": int,
                "title": str,
                "year": int or None,
                "poster": str (full URL) or None
            }]
        """
        if not self.api_key or not query:
            return []

        try:
            search_url = f"{TMDB_BASE_URL}/search/movie"
            params = {
                "api_key": self.api_key,
                "query": query,
                "language": "en-US",
                "page": 1
            }

            response = await self.client.get(search_url, params=params)
            response.raise_for_status()
            data = response.json()

            results = data.get("results", [])[:limit]

            suggestions = []
            for movie in results:
                release_date = movie.get("release_date")
                year = None
                if release_date:
                    try:
                        year = int(release_date.split("-")[0])
                    except (ValueError, IndexError):
                        pass

                poster_path = movie.get("poster_path")
                poster_url = f"{TMDB_IMAGE_BASE_URL}{poster_path}" if poster_path else None

                suggestions.append({
                    "id": movie.get("id"),
                    "title": movie.get("title"),
                    "year": year,
                    "poster": poster_url
                })

            return suggestions

        except Exception as e:
            logger.error(f"[TMDB] Autocomplete error for '{query}': {e}")
            return []

    async def get_movie_metadata(self, title: str) -> Optional[Dict[str, Any]]:
        """
        Fetch movie metadata from TMDB.

        Args:
            title: Movie title to search for

        Returns:
            Dictionary with metadata:
            {
                "id": int,
                "title": str,
                "year": int or None,
                "poster": str (full URL) or None,
                "overview": str,
                "genres": [str],
                "popularity": float
            }
            Returns None if no results found or on error.

        Note:
            - Picks highest-popularity result from search
            - Never blocks or affects script ingestion
            - Failures are logged but silent (returns None)
        """
        if not self.api_key:
            logger.warning("[TMDB] API key not configured, skipping metadata fetch")
            return None

        try:
            # Search for movie by title
            search_url = f"{TMDB_BASE_URL}/search/movie"
            params = {
                "api_key": self.api_key,
                "query": title,
                "language": "en-US",
                "page": 1
            }

            logger.info(f"[TMDB] Searching for movie: '{title}'")
            response = await self.client.get(search_url, params=params)
            response.raise_for_status()
            data = response.json()

            results = data.get("results", [])
            if not results:
                logger.info(f"[TMDB] No results found for '{title}'")
                return None

            # Pick highest-popularity result
            movie = max(results, key=lambda m: m.get("popularity", 0))
            movie_id = movie.get("id")

            logger.info(f"[TMDB] Found movie: '{movie.get('title')}' (ID: {movie_id}, popularity: {movie.get('popularity')})")

            # Fetch detailed movie info (for genres)
            details_url = f"{TMDB_BASE_URL}/movie/{movie_id}"
            details_params = {
                "api_key": self.api_key,
                "language": "en-US"
            }

            details_response = await self.client.get(details_url, params=details_params)
            details_response.raise_for_status()
            details = details_response.json()

            # Extract metadata
            release_date = movie.get("release_date") or details.get("release_date")
            year = None
            if release_date:
                try:
                    year = int(release_date.split("-")[0])
                except (ValueError, IndexError):
                    year = None

            poster_path = movie.get("poster_path") or details.get("poster_path")
            poster_url = f"{TMDB_IMAGE_BASE_URL}{poster_path}" if poster_path else None

            genres = [g.get("name") for g in details.get("genres", [])]

            metadata = {
                "id": movie_id,
                "title": details.get("title") or movie.get("title"),
                "year": year,
                "poster": poster_url,
                "overview": details.get("overview", ""),
                "genres": genres,
                "popularity": movie.get("popularity", 0.0)
            }

            logger.info(f"[TMDB] ✓ Metadata fetched: {metadata['title']} ({metadata['year']})")
            return metadata

        except httpx.HTTPStatusError as e:
            logger.error(f"[TMDB] HTTP error fetching metadata for '{title}': {e.response.status_code}")
            return None
        except httpx.RequestError as e:
            logger.error(f"[TMDB] Network error fetching metadata for '{title}': {e}")
            return None
        except Exception as e:
            logger.error(f"[TMDB] Unexpected error fetching metadata for '{title}': {e}", exc_info=True)
            return None


async def get_movie_metadata(title: str) -> Optional[Dict[str, Any]]:
    """
    Convenience function to fetch movie metadata.

    Args:
        title: Movie title to search for

    Returns:
        Movie metadata dict or None if not found/error
    """
    client = TMDBClient()
    try:
        return await client.get_movie_metadata(title)
    finally:
        await client.close()
