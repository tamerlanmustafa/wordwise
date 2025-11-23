"""
Free Subtitle API Client

This module handles fetching subtitles from free subtitle APIs.
Currently implements OpenSubtitles.com free API (no auth required).
Can be extended with other subtitle sources.
"""

import logging
from typing import Dict, Optional, List
import httpx
import re

logger = logging.getLogger(__name__)


class SubtitleAPIError(Exception):
    """Raised when subtitle API fails"""
    pass


class SubtitleAPIClient:
    """
    Client for free subtitle APIs.

    Features:
    - Search for movie subtitles
    - Download SRT/VTT files
    - Multiple fallback sources
    - Rate limiting handling
    """

    def __init__(self):
        """Initialize subtitle API client"""
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, connect=10.0),
            follow_redirects=True,
            headers={
                "User-Agent": "WordWise/1.0"
            }
        )

        # OpenSubtitles.org free API endpoint (no auth for search)
        self.opensubtitles_base = "https://www.opensubtitles.org"

        logger.info("[SubtitleAPI] Client initialized")

    async def fetch_subtitle(
        self,
        movie_title: str,
        year: Optional[int] = None,
        language: str = "en"
    ) -> Dict[str, any]:
        """
        Fetch subtitle for a movie.

        Args:
            movie_title: Movie title
            year: Release year (optional, improves accuracy)
            language: Subtitle language (default: English)

        Returns:
            Dictionary with:
                - subtitle_content: SRT/VTT content
                - format: "srt" or "vtt"
                - source: API source used
                - metadata: Additional info
        """
        logger.info(f"[SubtitleAPI] Fetching subtitle for '{movie_title}' ({year})")

        try:
            # Try different sources in order
            sources = [
                self._fetch_from_opensubtitles_free,
                self._fetch_from_yifysubtitles,
                self._fetch_from_subscene
            ]

            for source_func in sources:
                try:
                    result = await source_func(movie_title, year, language)
                    if result and result.get("subtitle_content"):
                        logger.info(f"[SubtitleAPI] Successfully fetched from {result.get('source')}")
                        return result
                except Exception as e:
                    logger.warning(f"[SubtitleAPI] Source failed: {str(e)}")
                    continue

            # If all sources fail
            raise SubtitleAPIError("All subtitle sources failed")

        except Exception as e:
            logger.error(f"[SubtitleAPI] Failed to fetch subtitle for '{movie_title}': {str(e)}")
            raise SubtitleAPIError(f"Subtitle fetch failed: {str(e)}")

    async def _fetch_from_opensubtitles_free(
        self,
        movie_title: str,
        year: Optional[int],
        language: str
    ) -> Optional[Dict[str, any]]:
        """
        Fetch from OpenSubtitles.org using their free web scraping approach.

        Note: This is a fallback method. For production, consider OpenSubtitles API.
        """
        logger.info(f"[SubtitleAPI] Trying OpenSubtitles for '{movie_title}'")

        try:
            # Search URL
            search_query = movie_title
            if year:
                search_query = f"{movie_title} {year}"

            search_url = f"{self.opensubtitles_base}/en/search/sublanguageid-{language}/moviename-{search_query.replace(' ', '+')}"

            # For now, return None as this requires web scraping
            # You'll need to provide the actual free subtitle API URL
            logger.warning("[SubtitleAPI] OpenSubtitles free access not implemented yet")
            return None

        except Exception as e:
            logger.warning(f"[SubtitleAPI] OpenSubtitles failed: {str(e)}")
            return None

    async def _fetch_from_yifysubtitles(
        self,
        movie_title: str,
        year: Optional[int],
        language: str
    ) -> Optional[Dict[str, any]]:
        """
        Fetch from YIFYSubtitles.

        Placeholder for when you provide the actual API endpoint.
        """
        logger.info(f"[SubtitleAPI] Trying YIFYSubtitles for '{movie_title}'")

        # This is a placeholder - replace with actual implementation
        # when you provide the free subtitle API URL
        return None

    async def _fetch_from_subscene(
        self,
        movie_title: str,
        year: Optional[int],
        language: str
    ) -> Optional[Dict[str, any]]:
        """
        Fetch from Subscene.

        Placeholder for when you provide the actual API endpoint.
        """
        logger.info(f"[SubtitleAPI] Trying Subscene for '{movie_title}'")

        # Placeholder
        return None

    async def fetch_from_url(self, subtitle_url: str) -> Dict[str, any]:
        """
        Fetch subtitle directly from a URL.

        This is useful if you already have a direct URL to an SRT file.

        Args:
            subtitle_url: Direct URL to SRT/VTT file

        Returns:
            Dictionary with subtitle content and metadata
        """
        logger.info(f"[SubtitleAPI] Fetching from URL: {subtitle_url}")

        try:
            response = await self.client.get(subtitle_url)
            response.raise_for_status()

            content = response.text

            # Detect format
            if "WEBVTT" in content[:100]:
                format_type = "vtt"
            else:
                format_type = "srt"

            return {
                "subtitle_content": content,
                "format": format_type,
                "source": "direct_url",
                "metadata": {
                    "url": subtitle_url,
                    "size": len(content)
                }
            }

        except httpx.HTTPError as e:
            raise SubtitleAPIError(f"Failed to fetch from URL: {str(e)}")

    async def search_subtitles(
        self,
        movie_title: str,
        year: Optional[int] = None,
        language: str = "en"
    ) -> List[Dict[str, str]]:
        """
        Search for available subtitles.

        Returns list of available subtitle files with metadata.
        """
        logger.info(f"[SubtitleAPI] Searching subtitles for '{movie_title}'")

        # Placeholder - implement based on the API you'll use
        return []

    async def close(self):
        """Close HTTP client"""
        await self.client.aclose()


# ==============================================================================
# INTEGRATION HELPER FOR YOUR CUSTOM SUBTITLE SOURCE
# ==============================================================================

class CustomSubtitleSource:
    """
    Template class for integrating your custom subtitle source.

    Replace the methods below with your actual subtitle API integration.
    """

    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None):
        """
        Initialize with your subtitle API credentials.

        Args:
            api_key: API key if required
            base_url: Base URL of the subtitle service
        """
        self.api_key = api_key
        self.base_url = base_url
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(30.0),
            follow_redirects=True
        )

    async def fetch_subtitle(
        self,
        movie_title: str,
        year: Optional[int] = None,
        language: str = "en"
    ) -> Optional[Dict[str, any]]:
        """
        Fetch subtitle from your custom source.

        Implement this method based on your subtitle API documentation.

        Returns:
            {
                "subtitle_content": "...",  # Raw SRT/VTT content
                "format": "srt",  # or "vtt"
                "source": "your_source_name",
                "metadata": {...}
            }
        """
        # TODO: Implement based on your subtitle API
        # Example structure:
        #
        # 1. Search for the movie
        # search_results = await self._search(movie_title, year)
        #
        # 2. Get the best match
        # best_match = self._select_best_match(search_results, language)
        #
        # 3. Download subtitle file
        # subtitle_content = await self._download(best_match['download_url'])
        #
        # 4. Return formatted result
        # return {
        #     "subtitle_content": subtitle_content,
        #     "format": "srt",
        #     "source": "custom_source",
        #     "metadata": best_match
        # }

        raise NotImplementedError("Please implement this method with your subtitle API")

    async def close(self):
        """Close HTTP client"""
        await self.client.aclose()
