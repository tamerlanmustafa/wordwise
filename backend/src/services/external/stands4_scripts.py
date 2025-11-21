"""
STANDS4 Scripts API client for fetching movie scripts.
API Documentation: https://www.stands4.com/services/v2/scripts.php
"""

import httpx
import logging
from typing import Optional, List, Dict, Any
from pydantic import BaseModel
import os
from dotenv import load_dotenv
from ...utils.script_logger import save_api_response, save_script_content, log_html_extraction

load_dotenv()

logger = logging.getLogger(__name__)


class ScriptResult(BaseModel):
    """Model for a single script result from STANDS4 API"""
    title: str
    subtitle: Optional[str] = None
    writer: Optional[str] = None
    link: str


class STANDS4ScriptsClient:
    """Client for interacting with STANDS4 Scripts API"""

    def __init__(self):
        self.base_url = os.getenv("SCRIPTS_URL", "https://www.stands4.com/services/v2/scripts.php")
        self.user_id = os.getenv("USER_ID")
        self.token = os.getenv("TOKEN")

        if not self.user_id or not self.token:
            raise ValueError("USER_ID and TOKEN must be set in environment variables")

    async def search_script(
        self,
        term: str,
        format: str = "json"
    ) -> List[ScriptResult]:
        """
        Search for movie scripts by term.

        Args:
            term: The movie title to search for
            format: Response format ('json' or 'xml'), defaults to 'json'

        Returns:
            List of ScriptResult objects

        Raises:
            httpx.HTTPError: If the API request fails
        """
        params = {
            "uid": self.user_id,
            "tokenid": self.token,
            "term": term,
            "format": format
        }

        logger.info(f"[STANDS4] ========== Searching for: '{term}' ==========")
        logger.info(f"[STANDS4] API URL: {self.base_url}")
        logger.info(f"[STANDS4] Parameters: {params}")

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(self.base_url, params=params)
            response.raise_for_status()

            # Log raw response details
            logger.info(f"[STANDS4] Response Status: {response.status_code}")
            logger.info(f"[STANDS4] Response Headers: {dict(response.headers)}")
            logger.info(f"[STANDS4] Response Content-Type: {response.headers.get('content-type')}")
            logger.info(f"[STANDS4] Raw Response Length: {len(response.text)} characters")

            # Save raw response text
            raw_text = response.text
            logger.info(f"[STANDS4] Raw Response Preview (first 500 chars):\n{raw_text[:500]}")

            # Parse JSON response
            try:
                data = response.json()
                logger.info(f"[STANDS4] JSON Parsing: SUCCESS")
                logger.info(f"[STANDS4] JSON Keys: {list(data.keys())}")
                logger.info(f"[STANDS4] Full JSON Response:\n{data}")
            except Exception as e:
                logger.error(f"[STANDS4] Failed to parse JSON response: {e}")
                logger.error(f"[STANDS4] Raw response (first 1000 chars): {raw_text[:1000]}")
                return []

            # Save to logs directory
            try:
                save_api_response(term, data, raw_text)
            except Exception as e:
                logger.error(f"[STANDS4] Failed to save API response: {e}")

            # Parse the response - API returns {'result': {...}} for single result
            # or {'result': [{...}, {...}]} for multiple results
            if "result" in data:
                results = data["result"]
                logger.info(f"[STANDS4] Found 'result' key in response")
                logger.info(f"[STANDS4] Result type: {type(results)}")

                # Handle single result (not in a list)
                if isinstance(results, dict):
                    logger.info(f"[STANDS4] Single result (dict), converting to list")
                    results = [results]

                logger.info(f"[STANDS4] Total results: {len(results)}")

                # Log each result
                for i, result in enumerate(results, 1):
                    logger.info(f"[STANDS4] Result #{i}:")
                    logger.info(f"  - Title: {result.get('title')}")
                    logger.info(f"  - Subtitle length: {len(result.get('subtitle', '')) if result.get('subtitle') else 0} chars")
                    logger.info(f"  - Writer: {result.get('writer')}")
                    logger.info(f"  - Link: {result.get('link')}")

                    # Check if subtitle is actually a script or just a synopsis
                    subtitle = result.get('subtitle', '')
                    if subtitle:
                        word_count = len(subtitle.split())
                        logger.info(f"  - Subtitle word count: {word_count}")
                        if word_count < 100:
                            logger.warning(f"  - WARNING: Subtitle is very short ({word_count} words) - likely a synopsis, not a script!")

                return [ScriptResult(**result) for result in results]

            logger.warning(f"[STANDS4] No 'result' key found in API response")
            logger.warning(f"[STANDS4] Available keys: {list(data.keys())}")
            return []

    async def get_script_details(self, term: str) -> Optional[ScriptResult]:
        """
        Get the first (most relevant) script result for a term.

        Args:
            term: The movie title to search for

        Returns:
            ScriptResult object or None if not found
        """
        results = await self.search_script(term)
        return results[0] if results else None

    async def fetch_full_script(self, script_url: str, movie_title: str) -> Optional[str]:
        """
        Fetch the full script content from the script URL.

        IMPORTANT: STANDS4 API only returns metadata (title, synopsis, link).
        The 'subtitle' field is NOT the full script - it's just a synopsis!

        To get the actual script, you need to:
        1. Scrape the HTML from the script_url
        2. Parse the HTML to extract the script content
        3. Look for <pre> tags or script dialogue sections

        Args:
            script_url: URL to the script page
            movie_title: Title of the movie for logging

        Returns:
            Full script text or None if not found
        """
        logger.info(f"[STANDS4] ========== Fetching full script from URL ==========")
        logger.info(f"[STANDS4] Movie: {movie_title}")
        logger.info(f"[STANDS4] URL: {script_url}")

        try:
            async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
                response = await client.get(script_url)
                response.raise_for_status()

                html_content = response.text
                logger.info(f"[STANDS4] HTML Response Length: {len(html_content)} characters")
                logger.info(f"[STANDS4] HTML Preview (first 500 chars):\n{html_content[:500]}")

                # Check what's in the HTML
                extracted_fields = {
                    "full_html": html_content,
                    "title": None,
                    "synopsis": None,
                    "script_pre": None,
                    "script_div": None
                }

                # Try to extract script from <pre> tag
                if '<pre>' in html_content:
                    start = html_content.find('<pre>') + 5
                    end = html_content.find('</pre>')
                    if end > start:
                        extracted_fields["script_pre"] = html_content[start:end]
                        logger.info(f"[STANDS4] Found <pre> tag with {len(extracted_fields['script_pre'])} characters")

                # Try to extract from script div
                if 'class="script"' in html_content:
                    logger.info(f"[STANDS4] Found class='script' in HTML")

                # Log HTML extraction
                log_html_extraction(html_content, extracted_fields)

                # For now, warn that we can't extract the full script
                logger.warning(f"[STANDS4] ⚠️  IMPORTANT: STANDS4 API does not provide full scripts!")
                logger.warning(f"[STANDS4] The 'subtitle' field is just a SYNOPSIS (200-300 words)")
                logger.warning(f"[STANDS4] You need to scrape the HTML from the link to get the full script")
                logger.warning(f"[STANDS4] Or use a different script provider (imsdb.com, screenplays-online.de, etc.)")

                # Return the HTML for further processing
                return html_content

        except Exception as e:
            logger.error(f"[STANDS4] Failed to fetch script from URL: {e}")
            return None


# Convenience function for easy import
async def fetch_movie_script(movie_title: str) -> Optional[Dict[str, Any]]:
    """
    Fetch movie script details from STANDS4 API.

    Args:
        movie_title: The title of the movie to search for

    Returns:
        Dictionary with script details or None if not found
    """
    client = STANDS4ScriptsClient()
    result = await client.get_script_details(movie_title)

    if result:
        logger.info(f"[STANDS4] ========== FINAL RESULT FOR '{movie_title}' ==========")
        logger.info(f"[STANDS4] Title: {result.title}")
        logger.info(f"[STANDS4] Writer: {result.writer}")
        logger.info(f"[STANDS4] Link: {result.link}")

        # IMPORTANT: Log that subtitle is NOT the full script
        if result.subtitle:
            subtitle_words = len(result.subtitle.split())
            logger.warning(f"[STANDS4] Subtitle (SYNOPSIS): {subtitle_words} words")
            logger.warning(f"[STANDS4] ⚠️  This is NOT the full script, just a synopsis!")
            logger.warning(f"[STANDS4] Full scripts typically have 10,000-30,000+ words")

        return {
            "title": result.title,
            "subtitle": result.subtitle,
            "writer": result.writer,
            "link": result.link
        }

    return None
