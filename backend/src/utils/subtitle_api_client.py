"""
Free Subtitle API Client

This module handles fetching subtitles using Subliminal library.
"""

import logging
from typing import Dict, Optional, List
import httpx
import tempfile
import os
from pathlib import Path

logger = logging.getLogger(__name__)


class SubtitleAPIError(Exception):
    """Raised when subtitle API fails"""
    pass


class SubtitleAPIClient:
    """
    Client for subtitle fetching using Subliminal.

    Features:
    - Search for movie subtitles using Subliminal
    - Download SRT files
    - Automatic provider fallback
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

        logger.info("[SubtitleAPI] Client initialized")

    async def fetch_subtitle(
        self,
        movie_title: str,
        year: Optional[int] = None,
        language: str = "en"
    ) -> Dict[str, any]:
        """
        Fetch subtitle for a movie using Subliminal.

        Args:
            movie_title: Movie title
            year: Release year (optional, improves accuracy)
            language: Subtitle language (default: English)

        Returns:
            Dictionary with:
                - subtitle_content: SRT content
                - format: "srt"
                - source: "subliminal"
                - metadata: Additional info
        """
        logger.info(f"[SubtitleAPI] Fetching subtitle for '{movie_title}' ({year})")

        try:
            result = await self.fetch_subtitle_subliminal(movie_title, year, language)
            if result and result.get("subtitle_content"):
                logger.info(f"[SubtitleAPI] Successfully fetched from Subliminal")
                return result

            raise SubtitleAPIError("Subliminal failed to find subtitles")

        except Exception as e:
            logger.error(f"[SubtitleAPI] Failed to fetch subtitle for '{movie_title}': {str(e)}")
            raise SubtitleAPIError(f"Subtitle fetch failed: {str(e)}")

    async def fetch_subtitle_subliminal(
        self,
        movie_title: str,
        year: Optional[int] = None,
        language: str = "en"
    ) -> Optional[Dict[str, any]]:
        """
        Fetch subtitle using Subliminal library.

        Args:
            movie_title: Movie title
            year: Release year (optional)
            language: Subtitle language code (default: "en")

        Returns:
            Dictionary with subtitle_content, format, and metadata or None
        """
        logger.info(f"[Subliminal] Searching for '{movie_title}' ({year})")

        try:
            from subliminal import download_best_subtitles, save_subtitles, scan_video
            from subliminal import region
            from babelfish import Language

            # Configure cache (only if not already configured)
            try:
                region.configure('dogpile.cache.memory')
            except Exception:
                pass  # Already configured

            # Create temporary directory for fake video file
            with tempfile.TemporaryDirectory() as temp_dir:
                # Build fake video filename
                if year:
                    fake_filename = f"{movie_title} ({year}).mkv"
                else:
                    fake_filename = f"{movie_title}.mkv"

                fake_video_path = Path(temp_dir) / fake_filename
                fake_video_path.touch()

                # Scan the fake video
                video = scan_video(str(fake_video_path))

                # Download best subtitles
                # Convert 2-letter language code to 3-letter ISO 639-3 code
                lang_map = {"en": "eng", "es": "spa", "fr": "fra", "de": "deu", "it": "ita", "pt": "por"}
                lang_code = lang_map.get(language, "eng")

                # Use only opensubtitles provider (faster, no pagination issues)
                subtitles = download_best_subtitles([video], {Language(lang_code)}, providers=['opensubtitles'])

                if not subtitles or video not in subtitles or not subtitles[video]:
                    logger.info(f"[Subliminal] No subtitles found")
                    return None

                # Get the best subtitle
                best_subtitle = subtitles[video][0]
                logger.info(f"[Subliminal] Found subtitle from {best_subtitle.provider_name}")

                # Save subtitle to get content
                save_subtitles(video, subtitles[video])

                # Read the saved subtitle file
                subtitle_path = fake_video_path.with_suffix('.srt')

                if not subtitle_path.exists():
                    # Try different extensions
                    for ext in ['.en.srt', f'.{language}.srt']:
                        alt_path = fake_video_path.with_suffix(ext)
                        if alt_path.exists():
                            subtitle_path = alt_path
                            break

                if not subtitle_path.exists():
                    logger.error(f"[Subliminal] Subtitle file not created")
                    return None

                # Read subtitle content (try UTF-8 first, fallback to Latin-1)
                try:
                    with open(subtitle_path, 'r', encoding='utf-8') as f:
                        subtitle_content = f.read()
                except UnicodeDecodeError:
                    with open(subtitle_path, 'r', encoding='latin-1') as f:
                        subtitle_content = f.read()

                logger.info(f"[Subliminal] ✓ Subtitle downloaded ({len(subtitle_content)} bytes)")

                return {
                    "subtitle_content": subtitle_content,
                    "format": "srt",
                    "source": "subliminal",
                    "metadata": {
                        "provider": best_subtitle.provider_name,
                        "language": language,
                        "title": movie_title,
                        "year": year
                    }
                }

        except ImportError:
            logger.error("[Subliminal] Library not installed. Run: pip install subliminal")
            return None
        except Exception as e:
            logger.error(f"[Subliminal] Error: {str(e)}")
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

    async def close(self):
        """Close HTTP client"""
        await self.client.aclose()
