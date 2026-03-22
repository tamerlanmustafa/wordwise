"""
Gutendex API Client

Provides access to Project Gutenberg's public domain book catalog and texts.
No API key required - completely free to use.

API Documentation: https://gutendex.com/
GitHub: https://github.com/garethbjohnson/gutendex
"""

import logging
import aiohttp
import re
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# API Endpoints
GUTENDEX_API_URL = "https://gutendex.com/books"


@dataclass
class GutenbergBook:
    """Represents a book from Project Gutenberg via Gutendex"""
    id: int
    title: str
    authors: List[Dict[str, Any]] = field(default_factory=list)
    subjects: List[str] = field(default_factory=list)
    bookshelves: List[str] = field(default_factory=list)
    languages: List[str] = field(default_factory=list)
    copyright: Optional[bool] = None  # False = public domain in USA
    media_type: str = "Text"
    formats: Dict[str, str] = field(default_factory=dict)
    download_count: int = 0

    @property
    def primary_author(self) -> Optional[str]:
        """Get the first/primary author name"""
        if self.authors:
            return self.authors[0].get("name", "Unknown")
        return None

    @property
    def author_names(self) -> List[str]:
        """Get all author names"""
        return [a.get("name", "Unknown") for a in self.authors]

    @property
    def author_birth_year(self) -> Optional[int]:
        """Get the first author's birth year"""
        if self.authors:
            return self.authors[0].get("birth_year")
        return None

    @property
    def author_death_year(self) -> Optional[int]:
        """Get the first author's death year"""
        if self.authors:
            return self.authors[0].get("death_year")
        return None

    @property
    def plain_text_url(self) -> Optional[str]:
        """Get the URL for plain text (UTF-8) version"""
        # Try different plain text format keys
        for key in ["text/plain; charset=utf-8", "text/plain", "text/plain; charset=us-ascii"]:
            if key in self.formats:
                return self.formats[key]

        # Fallback: look for any .txt URL
        for key, url in self.formats.items():
            if "text/plain" in key or url.endswith(".txt"):
                return url

        return None

    @property
    def epub_url(self) -> Optional[str]:
        """Get the URL for EPUB version"""
        for key in ["application/epub+zip"]:
            if key in self.formats:
                return self.formats[key]
        return None

    @property
    def html_url(self) -> Optional[str]:
        """Get the URL for HTML version"""
        for key in ["text/html", "text/html; charset=utf-8"]:
            if key in self.formats:
                return self.formats[key]
        return None

    @property
    def cover_url(self) -> Optional[str]:
        """Get the cover image URL"""
        for key in ["image/jpeg"]:
            if key in self.formats:
                return self.formats[key]
        return None

    @property
    def is_public_domain(self) -> bool:
        """Check if the book is in public domain (USA)"""
        return self.copyright is False

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API response"""
        return {
            "id": self.id,
            "gutenberg_id": self.id,
            "title": self.title,
            "author": self.primary_author,
            "authors": self.author_names,
            "author_birth_year": self.author_birth_year,
            "author_death_year": self.author_death_year,
            "subjects": self.subjects[:10],
            "bookshelves": self.bookshelves,
            "languages": self.languages,
            "is_public_domain": self.is_public_domain,
            "download_count": self.download_count,
            "plain_text_url": self.plain_text_url,
            "epub_url": self.epub_url,
            "html_url": self.html_url,
            "cover_url": self.cover_url,
            "formats": self.formats,
        }


class GutendexClient:
    """
    Client for the Gutendex API (Project Gutenberg).

    Features:
    - Search books by title, author, or topic
    - Filter by language and copyright status
    - Get download URLs for various formats
    - Download full text of books
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
        query: Optional[str] = None,
        title: Optional[str] = None,
        author: Optional[str] = None,
        topic: Optional[str] = None,
        languages: Optional[List[str]] = None,
        copyright_status: Optional[bool] = None,
        page: int = 1
    ) -> Dict[str, Any]:
        """
        Search for books in Project Gutenberg.

        Args:
            query: General search query (searches title and author)
            title: Search by title
            author: Search by author name
            topic: Search by subject/bookshelf
            languages: List of language codes (e.g., ['en'])
            copyright_status: None=all, False=public domain, True=copyrighted
            page: Page number for pagination

        Returns:
            Dictionary with 'books' list, 'total' count, and pagination info
        """
        session = await self._get_session()

        params = {}

        # Build search parameters
        if query:
            params["search"] = query
        if title:
            # Gutendex uses 'search' for title search with special handling
            if "search" in params:
                params["search"] = f"{params['search']} {title}"
            else:
                params["search"] = title
        if author:
            if "search" in params:
                params["search"] = f"{params['search']} {author}"
            else:
                params["search"] = author
        if topic:
            params["topic"] = topic
        if languages:
            params["languages"] = ",".join(languages)
        if copyright_status is not None:
            params["copyright"] = "true" if copyright_status else "false"

        params["page"] = page

        try:
            logger.info(f"[Gutendex] Searching: {params}")

            async with session.get(GUTENDEX_API_URL, params=params) as response:
                if response.status != 200:
                    logger.error(f"[Gutendex] Search failed: {response.status}")
                    return {"books": [], "total": 0, "next": None, "previous": None}

                data = await response.json()

                books = []
                for result in data.get("results", []):
                    try:
                        book = GutenbergBook(
                            id=result.get("id", 0),
                            title=result.get("title", "Unknown"),
                            authors=result.get("authors", []),
                            subjects=result.get("subjects", []),
                            bookshelves=result.get("bookshelves", []),
                            languages=result.get("languages", []),
                            copyright=result.get("copyright"),
                            media_type=result.get("media_type", "Text"),
                            formats=result.get("formats", {}),
                            download_count=result.get("download_count", 0),
                        )
                        books.append(book)
                    except Exception as e:
                        logger.warning(f"[Gutendex] Failed to parse book: {e}")
                        continue

                logger.info(f"[Gutendex] Found {len(books)} books (total: {data.get('count', 0)})")

                return {
                    "books": [b.to_dict() for b in books],
                    "total": data.get("count", 0),
                    "next": data.get("next"),
                    "previous": data.get("previous"),
                }

        except aiohttp.ClientError as e:
            logger.error(f"[Gutendex] Request failed: {e}")
            return {"books": [], "total": 0, "next": None, "previous": None}
        except Exception as e:
            logger.error(f"[Gutendex] Unexpected error: {e}", exc_info=True)
            return {"books": [], "total": 0, "next": None, "previous": None}

    async def get_book(self, book_id: int) -> Optional[GutenbergBook]:
        """
        Get a specific book by Gutenberg ID.

        Args:
            book_id: The Project Gutenberg book ID

        Returns:
            GutenbergBook object or None if not found
        """
        session = await self._get_session()

        url = f"{GUTENDEX_API_URL}/{book_id}"

        try:
            logger.info(f"[Gutendex] Fetching book: {book_id}")

            async with session.get(url) as response:
                if response.status == 404:
                    logger.warning(f"[Gutendex] Book not found: {book_id}")
                    return None

                if response.status != 200:
                    logger.error(f"[Gutendex] Failed to fetch book: {response.status}")
                    return None

                data = await response.json()

                return GutenbergBook(
                    id=data.get("id", 0),
                    title=data.get("title", "Unknown"),
                    authors=data.get("authors", []),
                    subjects=data.get("subjects", []),
                    bookshelves=data.get("bookshelves", []),
                    languages=data.get("languages", []),
                    copyright=data.get("copyright"),
                    media_type=data.get("media_type", "Text"),
                    formats=data.get("formats", {}),
                    download_count=data.get("download_count", 0),
                )

        except aiohttp.ClientError as e:
            logger.error(f"[Gutendex] Request failed: {e}")
            return None
        except Exception as e:
            logger.error(f"[Gutendex] Unexpected error: {e}", exc_info=True)
            return None

    async def download_text(self, book: GutenbergBook) -> Optional[str]:
        """
        Download the full text of a book.

        Args:
            book: GutenbergBook object with format URLs

        Returns:
            Full text content or None if download fails
        """
        text_url = book.plain_text_url

        if not text_url:
            logger.warning(f"[Gutendex] No plain text URL for book {book.id}")
            return None

        session = await self._get_session()

        try:
            logger.info(f"[Gutendex] Downloading text for book {book.id}: {text_url}")

            async with session.get(text_url) as response:
                if response.status != 200:
                    logger.error(f"[Gutendex] Failed to download text: {response.status}")
                    return None

                text = await response.text(errors='ignore')

                # Clean up the text (remove Gutenberg header/footer)
                text = self._clean_gutenberg_text(text)

                logger.info(f"[Gutendex] Downloaded {len(text)} characters for book {book.id}")

                return text

        except aiohttp.ClientError as e:
            logger.error(f"[Gutendex] Download failed: {e}")
            return None
        except Exception as e:
            logger.error(f"[Gutendex] Unexpected error: {e}", exc_info=True)
            return None

    async def download_text_by_id(self, book_id: int) -> Optional[str]:
        """
        Download the full text of a book by its ID.

        Args:
            book_id: Project Gutenberg book ID

        Returns:
            Full text content or None if download fails
        """
        book = await self.get_book(book_id)
        if not book:
            return None
        return await self.download_text(book)

    def _clean_gutenberg_text(self, text: str) -> str:
        """
        Remove Project Gutenberg header and footer from text.

        The header typically starts with "The Project Gutenberg EBook"
        and the content starts after "*** START OF..."
        The footer starts with "*** END OF..."
        """
        # Find start of actual content
        start_markers = [
            r"\*\*\* START OF (THE|THIS) PROJECT GUTENBERG EBOOK",
            r"\*\*\*START OF (THE|THIS) PROJECT GUTENBERG EBOOK",
            r"START OF (THE|THIS) PROJECT GUTENBERG EBOOK",
        ]

        start_pos = 0
        for marker in start_markers:
            match = re.search(marker, text, re.IGNORECASE)
            if match:
                # Find end of the line containing the marker
                line_end = text.find("\n", match.end())
                if line_end != -1:
                    start_pos = line_end + 1
                break

        # Find end of actual content
        end_markers = [
            r"\*\*\* END OF (THE|THIS) PROJECT GUTENBERG EBOOK",
            r"\*\*\*END OF (THE|THIS) PROJECT GUTENBERG EBOOK",
            r"END OF (THE|THIS) PROJECT GUTENBERG EBOOK",
        ]

        end_pos = len(text)
        for marker in end_markers:
            match = re.search(marker, text, re.IGNORECASE)
            if match:
                end_pos = match.start()
                break

        cleaned = text[start_pos:end_pos].strip()

        return cleaned

    async def search_public_domain(
        self,
        query: str,
        languages: Optional[List[str]] = None,
        page: int = 1
    ) -> Dict[str, Any]:
        """
        Search for public domain books only.

        Convenience method that filters to copyright=False.
        """
        return await self.search_books(
            query=query,
            languages=languages or ["en"],
            copyright_status=False,
            page=page
        )


# Singleton instance
_client: Optional[GutendexClient] = None


def get_gutendex_client() -> GutendexClient:
    """Get the singleton Gutendex client instance"""
    global _client
    if _client is None:
        _client = GutendexClient()
    return _client
