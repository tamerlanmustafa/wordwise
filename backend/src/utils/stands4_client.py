"""
STANDS4 API Client for Script Fetching

This module handles all interactions with the STANDS4 API:
- Script text retrieval
- PDF URL fetching
- Synopsis fallback
"""

import re
import logging
from typing import Dict, Optional, List
import httpx
from bs4 import BeautifulSoup
import os

logger = logging.getLogger(__name__)


class STANDS4Error(Exception):
    """Raised when STANDS4 API fails"""
    pass


class STANDS4Client:
    """
    Client for STANDS4 Scripts API.

    Features:
    - Fetch script text via API
    - Get PDF URLs for full scripts
    - Retrieve synopsis as fallback
    - Handle rate limiting and errors
    """

    def __init__(
        self,
        user_id: Optional[str] = None,
        token: Optional[str] = None,
        scripts_url: Optional[str] = None
    ):
        """
        Initialize STANDS4 client.

        Args:
            user_id: STANDS4 user ID (from env if not provided)
            token: STANDS4 API token (from env if not provided)
            scripts_url: STANDS4 scripts API URL (from env if not provided)
        """
        self.user_id = user_id or os.getenv("USER_ID")
        self.token = token or os.getenv("TOKEN")
        self.scripts_url = scripts_url or os.getenv("SCRIPTS_URL", "https://www.stands4.com/services/v2/scripts.php")

        if not self.user_id or not self.token:
            raise ValueError("STANDS4 credentials (USER_ID and TOKEN) are required")

        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, connect=10.0),
            follow_redirects=True
        )

        logger.info(f"[STANDS4] Client initialized with user_id={self.user_id}")

    async def fetch_script(self, movie_title: str) -> Dict[str, any]:
        """
        Fetch script data from STANDS4 API.

        Args:
            movie_title: Movie title to search

        Returns:
            Dictionary with:
                - script_text: Script content (if available)
                - pdf_url: URL to full PDF (if available)
                - synopsis: Movie synopsis (if available)
                - has_script: Whether full script text is available
                - has_pdf: Whether PDF is available
                - metadata: Additional API response data
        """
        logger.info(f"[STANDS4] Fetching script for '{movie_title}'")

        try:
            # Build API request
            params = {
                "uid": self.user_id,
                "tokenid": self.token,
                "term": movie_title,
                "format": "json"
            }

            # Make request
            response = await self.client.get(self.scripts_url, params=params)
            response.raise_for_status()

            # Parse response
            data = response.json()

            # Extract script data
            result = self._parse_api_response(data, movie_title)

            logger.info(
                f"[STANDS4] Response for '{movie_title}': "
                f"has_script={result['has_script']}, has_pdf={result['has_pdf']}"
            )

            return result

        except httpx.HTTPError as e:
            logger.error(f"[STANDS4] HTTP error for '{movie_title}': {str(e)}")
            raise STANDS4Error(f"STANDS4 API request failed: {str(e)}")
        except Exception as e:
            logger.error(f"[STANDS4] Unexpected error for '{movie_title}': {str(e)}", exc_info=True)
            raise STANDS4Error(f"STANDS4 API error: {str(e)}")

    async def search_movie(self, movie_title: str) -> List[Dict[str, str]]:
        """
        Search for movies matching the title.

        Returns list of matches with title, year, and other metadata.
        """
        logger.info(f"[STANDS4] Searching for '{movie_title}'")

        try:
            params = {
                "uid": self.user_id,
                "tokenid": self.token,
                "term": movie_title,
                "format": "json"
            }

            response = await self.client.get(self.scripts_url, params=params)
            response.raise_for_status()

            data = response.json()

            # Extract all results
            results = []
            if "result" in data:
                # Handle both single result and list of results
                result_data = data["result"]
                if isinstance(result_data, list):
                    results = result_data
                elif isinstance(result_data, dict):
                    results = [result_data]

            return results

        except Exception as e:
            logger.error(f"[STANDS4] Search failed for '{movie_title}': {str(e)}")
            return []

    def _parse_api_response(self, data: Dict, movie_title: str) -> Dict[str, any]:
        """
        Parse STANDS4 API response and extract relevant data.

        The API returns various fields that may contain:
        - Full script text
        - PDF URL
        - Synopsis
        - Metadata
        """
        result = {
            "script_text": None,
            "pdf_url": None,
            "synopsis": None,
            "has_script": False,
            "has_pdf": False,
            "metadata": {}
        }

        # Check if we have results
        if "result" not in data:
            logger.warning(f"[STANDS4] No results found for '{movie_title}'")
            return result

        # Get first result (or the only result)
        api_result = data["result"]
        if isinstance(api_result, list):
            if not api_result:
                return result
            api_result = api_result[0]

        # Extract script text
        script_text = api_result.get("script", "") or api_result.get("text", "")
        if script_text and len(script_text.strip()) > 100:
            result["script_text"] = script_text
            result["has_script"] = True

        # Extract PDF URL - construct from script link
        # STANDS4 API returns link like: https://www.scripts.com/script/301
        # We need to extract the ID and build: https://www.scripts.com/script-pdf/301

        script_link = api_result.get("link", "")
        script_id = None

        if script_link:
            # Extract ID from link (e.g., "https://www.scripts.com/script/301" -> "301")
            # Also handle formats like "https://www.scripts.com/script/interstellar_301" -> "301"
            import re
            match = re.search(r'/script/[^/]*?_?(\d+)$', script_link)
            if match:
                script_id = match.group(1)

        # Also check for direct fields
        if not script_id:
            script_id = api_result.get("id", "") or api_result.get("script_id", "")

        # Also check for direct PDF URL in the response
        pdf_url = api_result.get("pdf_url", "") or api_result.get("pdf", "")

        if script_id:
            # Construct actual PDF URL: https://www.scripts.com/script-pdf-body.php?id={id}
            # NOT /script-pdf/{id} which is just an HTML page with an iframe
            result["pdf_url"] = f"https://www.scripts.com/script-pdf-body.php?id={script_id}"
            result["has_pdf"] = True
            logger.info(f"[STANDS4] Constructed PDF URL from script ID {script_id}: {result['pdf_url']}")
        elif pdf_url and pdf_url.startswith("http"):
            result["pdf_url"] = pdf_url
            result["has_pdf"] = True
        elif pdf_url and pdf_url.startswith("/"):
            # Relative URL - make it absolute
            result["pdf_url"] = f"https://www.scripts.com{pdf_url}"
            result["has_pdf"] = True

        # Extract synopsis (STANDS4 calls it "subtitle")
        synopsis = (
            api_result.get("subtitle", "") or
            api_result.get("synopsis", "") or
            api_result.get("summary", "")
        )
        if synopsis:
            result["synopsis"] = synopsis

        # Store other metadata
        result["metadata"] = {
            "title": api_result.get("title", movie_title),
            "year": api_result.get("year", ""),
            "author": api_result.get("author", "") or api_result.get("writer", ""),
            "genre": api_result.get("genre", ""),
            "script_id": script_id,
            "link": script_link
        }

        return result

    async def get_pdf_url(self, movie_title: str) -> Optional[str]:
        """
        Get PDF URL for a movie script.

        This is a convenience method that fetches and extracts just the PDF URL.
        """
        try:
            result = await self.fetch_script(movie_title)
            return result.get("pdf_url")
        except Exception as e:
            logger.warning(f"[STANDS4] Failed to get PDF URL for '{movie_title}': {str(e)}")
            return None

    async def get_script_text(self, movie_title: str) -> Optional[str]:
        """
        Get script text from API.

        This is a convenience method that fetches and extracts just the script text.
        """
        try:
            result = await self.fetch_script(movie_title)
            return result.get("script_text")
        except Exception as e:
            logger.warning(f"[STANDS4] Failed to get script text for '{movie_title}': {str(e)}")
            return None

    async def get_synopsis(self, movie_title: str) -> Optional[str]:
        """
        Get synopsis as fallback when script is unavailable.

        This is a convenience method that fetches and extracts just the synopsis.
        """
        try:
            result = await self.fetch_script(movie_title)
            return result.get("synopsis")
        except Exception as e:
            logger.warning(f"[STANDS4] Failed to get synopsis for '{movie_title}': {str(e)}")
            return None

    async def close(self):
        """Close HTTP client"""
        await self.client.aclose()
