"""
Open Library API Client

Provides access to Open Library's book metadata, covers, and search functionality.
No API key required - completely free to use.

API Documentation: https://openlibrary.org/developers/api
"""

import logging
import aiohttp
from typing import Optional, List, Dict, Any
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# API Endpoints
OPEN_LIBRARY_SEARCH_URL = "https://openlibrary.org/search.json"
OPEN_LIBRARY_WORKS_URL = "https://openlibrary.org/works"
OPEN_LIBRARY_COVERS_URL = "https://covers.openlibrary.org/b"


@dataclass
class OpenLibraryBook:
    """Represents a book from Open Library"""
    key: str  # Open Library work key (e.g., "/works/OL45804W")
    title: str
    author_name: Optional[List[str]] = None
    author_key: Optional[List[str]] = None
    first_publish_year: Optional[int] = None
    cover_i: Optional[int] = None  # Cover ID for constructing cover URL
    isbn: Optional[List[str]] = None
    publisher: Optional[List[str]] = None
    subject: Optional[List[str]] = None
    language: Optional[List[str]] = None
    number_of_pages_median: Optional[int] = None
    edition_count: Optional[int] = None

    @property
    def work_id(self) -> str:
        """Extract the work ID from the key"""
        return self.key.replace("/works/", "")

    @property
    def cover_url_small(self) -> Optional[str]:
        """Get small cover URL (45px width)"""
        if self.cover_i:
            return f"{OPEN_LIBRARY_COVERS_URL}/id/{self.cover_i}-S.jpg"
        return None

    @property
    def cover_url_medium(self) -> Optional[str]:
        """Get medium cover URL (180px width)"""
        if self.cover_i:
            return f"{OPEN_LIBRARY_COVERS_URL}/id/{self.cover_i}-M.jpg"
        return None

    @property
    def cover_url_large(self) -> Optional[str]:
        """Get large cover URL (360px width)"""
        if self.cover_i:
            return f"{OPEN_LIBRARY_COVERS_URL}/id/{self.cover_i}-L.jpg"
        return None

    @property
    def primary_author(self) -> Optional[str]:
        """Get the first/primary author name"""
        if self.author_name and len(self.author_name) > 0:
            return self.author_name[0]
        return None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API response"""
        return {
            "key": self.key,
            "work_id": self.work_id,
            "title": self.title,
            "author": self.primary_author,
            "authors": self.author_name or [],
            "first_publish_year": self.first_publish_year,
            "cover_small": self.cover_url_small,
            "cover_medium": self.cover_url_medium,
            "cover_large": self.cover_url_large,
            "isbn": self.isbn[0] if self.isbn else None,
            "isbns": self.isbn or [],
            "publishers": self.publisher or [],
            "subjects": (self.subject or [])[:10],  # Limit subjects
            "languages": self.language or [],
            "page_count": self.number_of_pages_median,
            "edition_count": self.edition_count,
        }


class OpenLibraryClient:
    """
    Client for the Open Library API.

    Features:
    - Search books by title, author, or general query
    - Get book details by work ID
    - Get cover images in multiple sizes
    - No API key required
    """

    def __init__(self, timeout: int = 30):
        self.timeout = aiohttp.ClientTimeout(total=timeout)
        self._session: Optional[aiohttp.ClientSession] = None

    async def _get_session(self) -> aiohttp.ClientSession:
        """Get or create aiohttp session"""
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(timeout=self.timeout)
        return self._session

    async def close(self):
        """Close the aiohttp session"""
        if self._session and not self._session.closed:
            await self._session.close()

    async def search_books(
        self,
        query: str,
        limit: int = 20,
        offset: int = 0,
        title: Optional[str] = None,
        author: Optional[str] = None,
        language: Optional[str] = None,
        public_domain_only: bool = False
    ) -> Dict[str, Any]:
        """
        Search for books in Open Library.

        Args:
            query: General search query
            limit: Maximum results to return
            offset: Offset for pagination
            title: Search by title specifically
            author: Search by author specifically
            language: Filter by language code (e.g., 'eng')
            public_domain_only: If True, filter to books published before 1929

        Returns:
            Dictionary with 'books' list and 'total' count
        """
        session = await self._get_session()

        params = {
            "limit": limit,
            "offset": offset,
            "fields": "key,title,author_name,author_key,first_publish_year,cover_i,isbn,publisher,subject,language,number_of_pages_median,edition_count",
        }

        # Build search query
        if title:
            params["title"] = title
        elif author:
            params["author"] = author
        elif query:
            params["q"] = query
        else:
            return {"books": [], "total": 0}

        # Add language filter
        if language:
            params["language"] = language

        # For public domain, filter to pre-1929 publications
        if public_domain_only:
            params["first_publish_year"] = "[* TO 1928]"

        try:
            logger.info(f"[OpenLibrary] Searching: {params}")

            async with session.get(OPEN_LIBRARY_SEARCH_URL, params=params) as response:
                if response.status != 200:
                    logger.error(f"[OpenLibrary] Search failed: {response.status}")
                    return {"books": [], "total": 0}

                data = await response.json()

                books = []
                for doc in data.get("docs", []):
                    try:
                        book = OpenLibraryBook(
                            key=doc.get("key", ""),
                            title=doc.get("title", "Unknown"),
                            author_name=doc.get("author_name"),
                            author_key=doc.get("author_key"),
                            first_publish_year=doc.get("first_publish_year"),
                            cover_i=doc.get("cover_i"),
                            isbn=doc.get("isbn"),
                            publisher=doc.get("publisher"),
                            subject=doc.get("subject"),
                            language=doc.get("language"),
                            number_of_pages_median=doc.get("number_of_pages_median"),
                            edition_count=doc.get("edition_count"),
                        )
                        books.append(book)
                    except Exception as e:
                        logger.warning(f"[OpenLibrary] Failed to parse book: {e}")
                        continue

                logger.info(f"[OpenLibrary] Found {len(books)} books (total: {data.get('numFound', 0)})")

                return {
                    "books": [b.to_dict() for b in books],
                    "total": data.get("numFound", 0),
                }

        except aiohttp.ClientError as e:
            logger.error(f"[OpenLibrary] Request failed: {e}")
            return {"books": [], "total": 0}
        except Exception as e:
            logger.error(f"[OpenLibrary] Unexpected error: {e}", exc_info=True)
            return {"books": [], "total": 0}

    async def get_work(self, work_id: str) -> Optional[Dict[str, Any]]:
        """
        Get detailed information about a specific work.

        Args:
            work_id: The Open Library work ID (e.g., "OL45804W")

        Returns:
            Work details dictionary or None if not found
        """
        session = await self._get_session()

        # Ensure work_id has proper format
        if not work_id.startswith("OL"):
            work_id = f"OL{work_id}"

        url = f"{OPEN_LIBRARY_WORKS_URL}/{work_id}.json"

        try:
            logger.info(f"[OpenLibrary] Fetching work: {work_id}")

            async with session.get(url) as response:
                if response.status == 404:
                    logger.warning(f"[OpenLibrary] Work not found: {work_id}")
                    return None

                if response.status != 200:
                    logger.error(f"[OpenLibrary] Failed to fetch work: {response.status}")
                    return None

                data = await response.json()

                # Extract description
                description = None
                if "description" in data:
                    if isinstance(data["description"], str):
                        description = data["description"]
                    elif isinstance(data["description"], dict):
                        description = data["description"].get("value", "")

                # Get covers
                covers = data.get("covers", [])
                cover_id = covers[0] if covers else None

                return {
                    "key": data.get("key"),
                    "title": data.get("title"),
                    "description": description,
                    "subjects": data.get("subjects", [])[:20],
                    "cover_id": cover_id,
                    "cover_small": f"{OPEN_LIBRARY_COVERS_URL}/id/{cover_id}-S.jpg" if cover_id else None,
                    "cover_medium": f"{OPEN_LIBRARY_COVERS_URL}/id/{cover_id}-M.jpg" if cover_id else None,
                    "cover_large": f"{OPEN_LIBRARY_COVERS_URL}/id/{cover_id}-L.jpg" if cover_id else None,
                    "first_publish_date": data.get("first_publish_date"),
                    "created": data.get("created", {}).get("value") if isinstance(data.get("created"), dict) else None,
                }

        except aiohttp.ClientError as e:
            logger.error(f"[OpenLibrary] Request failed: {e}")
            return None
        except Exception as e:
            logger.error(f"[OpenLibrary] Unexpected error: {e}", exc_info=True)
            return None

    async def search_public_domain_books(
        self,
        query: str,
        limit: int = 20,
        offset: int = 0
    ) -> Dict[str, Any]:
        """
        Search for public domain books (published before 1929).

        This is a convenience method that wraps search_books with
        the public_domain_only flag set to True.
        """
        return await self.search_books(
            query=query,
            limit=limit,
            offset=offset,
            language="eng",  # Focus on English books
            public_domain_only=True
        )


# Singleton instance
_client: Optional[OpenLibraryClient] = None


def get_open_library_client() -> OpenLibraryClient:
    """Get the singleton Open Library client instance"""
    global _client
    if _client is None:
        _client = OpenLibraryClient()
    return _client
