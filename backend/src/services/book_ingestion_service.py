"""
Book Ingestion Service

Combines Open Library metadata with Gutenberg text to create a unified
book search and ingestion pipeline.

Flow:
1. User searches for a book
2. Search both Open Library (metadata) and Gutendex (text availability)
3. Match results to show books with available public domain text
4. When user selects a book, download text and process through CEFR
"""

import logging
import re
from typing import Optional, List, Dict, Any, Tuple
from difflib import SequenceMatcher

from .open_library_client import get_open_library_client, OpenLibraryClient
from .gutendex_client import get_gutendex_client, GutendexClient

logger = logging.getLogger(__name__)


def normalize_title(title: str) -> str:
    """Normalize a title for comparison"""
    # Remove subtitles (after colon or dash)
    title = re.split(r'[:\-–—]', title)[0]
    # Lowercase
    title = title.lower()
    # Remove articles
    title = re.sub(r'^(the|a|an)\s+', '', title)
    # Remove punctuation
    title = re.sub(r'[^\w\s]', '', title)
    # Remove extra whitespace
    title = ' '.join(title.split())
    return title


def normalize_author(author: str) -> str:
    """Normalize an author name for comparison"""
    # Lowercase
    author = author.lower()
    # Remove punctuation except periods (for initials)
    author = re.sub(r'[^\w\s.]', '', author)
    # Handle "Last, First" format
    if ',' in author:
        parts = author.split(',')
        if len(parts) == 2:
            author = f"{parts[1].strip()} {parts[0].strip()}"
    # Remove extra whitespace
    author = ' '.join(author.split())
    return author


def similarity_score(s1: str, s2: str) -> float:
    """Calculate similarity between two strings (0-1)"""
    return SequenceMatcher(None, s1, s2).ratio()


class BookIngestionService:
    """
    Service for searching and ingesting public domain books.

    Combines:
    - Open Library: Rich metadata, covers, descriptions
    - Gutendex/Gutenberg: Actual book text (public domain)
    """

    def __init__(self):
        self.open_library = get_open_library_client()
        self.gutendex = get_gutendex_client()

    async def search_books(
        self,
        query: str,
        limit: int = 20,
        public_domain_only: bool = True
    ) -> Dict[str, Any]:
        """
        Search for books, combining metadata from Open Library
        with text availability from Gutenberg.

        Args:
            query: Search query (title, author, or general)
            limit: Maximum results
            public_domain_only: If True, only return books with available text

        Returns:
            Dictionary with 'books' list and metadata
        """
        logger.info(f"[BookIngestion] Searching for: {query}")

        # Search both sources in parallel (conceptually - we'll do sequentially for now)
        # First, search Gutendex for books with available text
        gutendex_results = await self.gutendex.search_public_domain(
            query=query,
            languages=["en"],
            page=1
        )

        gutenberg_books = gutendex_results.get("books", [])

        if not gutenberg_books:
            logger.info("[BookIngestion] No Gutenberg results, falling back to Open Library only")
            # Search Open Library for pre-1929 books
            ol_results = await self.open_library.search_public_domain_books(
                query=query,
                limit=limit
            )
            return {
                "books": ol_results.get("books", []),
                "total": ol_results.get("total", 0),
                "source": "open_library_only",
                "has_text": False
            }

        # Enhance Gutenberg books with Open Library metadata (covers, descriptions)
        enhanced_books = []
        for gb in gutenberg_books[:limit]:
            enhanced = await self._enhance_with_open_library(gb)
            enhanced_books.append(enhanced)

        return {
            "books": enhanced_books,
            "total": gutendex_results.get("total", 0),
            "source": "gutenberg_with_metadata",
            "has_text": True
        }

    async def _enhance_with_open_library(self, gutenberg_book: Dict[str, Any]) -> Dict[str, Any]:
        """
        Enhance a Gutenberg book with Open Library metadata.

        Tries to find the matching book in Open Library to get:
        - Better cover images
        - Book description
        - Additional metadata
        """
        title = gutenberg_book.get("title", "")
        author = gutenberg_book.get("author", "")

        # Build search query
        search_query = title
        if author:
            search_query = f"{title} {author}"

        try:
            ol_results = await self.open_library.search_books(
                query=search_query,
                limit=5
            )

            ol_books = ol_results.get("books", [])

            # Find best match
            best_match = None
            best_score = 0.0

            norm_title = normalize_title(title)
            norm_author = normalize_author(author) if author else ""

            for ol_book in ol_books:
                ol_title = normalize_title(ol_book.get("title", ""))
                ol_author = normalize_author(ol_book.get("author", "") or "")

                # Calculate match score
                title_score = similarity_score(norm_title, ol_title)
                author_score = similarity_score(norm_author, ol_author) if norm_author else 1.0

                # Combined score (title more important)
                score = title_score * 0.7 + author_score * 0.3

                if score > best_score and score > 0.6:
                    best_score = score
                    best_match = ol_book

            if best_match:
                # Merge the data
                return {
                    **gutenberg_book,
                    "open_library_key": best_match.get("key"),
                    "open_library_work_id": best_match.get("work_id"),
                    "cover_small": best_match.get("cover_small") or gutenberg_book.get("cover_url"),
                    "cover_medium": best_match.get("cover_medium") or gutenberg_book.get("cover_url"),
                    "cover_large": best_match.get("cover_large") or gutenberg_book.get("cover_url"),
                    "first_publish_year": best_match.get("first_publish_year") or gutenberg_book.get("author_death_year"),
                    "subjects": best_match.get("subjects") or gutenberg_book.get("subjects"),
                    "page_count": best_match.get("page_count"),
                    "match_score": best_score,
                }
            else:
                # Return Gutenberg data as-is
                return {
                    **gutenberg_book,
                    "cover_small": gutenberg_book.get("cover_url"),
                    "cover_medium": gutenberg_book.get("cover_url"),
                    "cover_large": gutenberg_book.get("cover_url"),
                }

        except Exception as e:
            logger.warning(f"[BookIngestion] Failed to enhance book: {e}")
            return gutenberg_book

    async def get_book_text(self, gutenberg_id: int) -> Optional[str]:
        """
        Download the full text of a book from Project Gutenberg.

        Args:
            gutenberg_id: The Gutenberg book ID

        Returns:
            Full book text or None if not available
        """
        return await self.gutendex.download_text_by_id(gutenberg_id)

    async def get_book_details(self, gutenberg_id: int) -> Optional[Dict[str, Any]]:
        """
        Get detailed information about a book.

        Args:
            gutenberg_id: The Gutenberg book ID

        Returns:
            Book details with metadata from both sources
        """
        # Get Gutenberg book info
        book = await self.gutendex.get_book(gutenberg_id)
        if not book:
            return None

        book_dict = book.to_dict()

        # Enhance with Open Library
        enhanced = await self._enhance_with_open_library(book_dict)

        # Try to get description from Open Library work
        if enhanced.get("open_library_work_id"):
            work = await self.open_library.get_work(enhanced["open_library_work_id"])
            if work and work.get("description"):
                enhanced["description"] = work["description"]

        return enhanced


# Singleton instance
_service: Optional[BookIngestionService] = None


def get_book_ingestion_service() -> BookIngestionService:
    """Get the singleton book ingestion service instance"""
    global _service
    if _service is None:
        _service = BookIngestionService()
    return _service
