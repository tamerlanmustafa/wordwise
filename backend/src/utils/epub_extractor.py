"""
EPUB Text Extractor

This module handles extracting text from EPUB e-book files.
Parses the EPUB structure and extracts clean text from all chapters.
"""

import io
import re
import logging
from typing import Dict, Tuple

from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


class EPUBExtractionError(Exception):
    """Raised when EPUB extraction fails"""
    pass


class EPUBExtractor:
    """
    Extracts text from EPUB e-book files.

    Features:
    - Parses EPUB structure (which is a ZIP with HTML files)
    - Extracts text from all chapters
    - Removes HTML tags and formatting
    - Validates minimum word count
    """

    MIN_VALID_WORD_COUNT = 1000

    def extract_from_bytes(
        self,
        epub_bytes: bytes,
        title: str = "Unknown"
    ) -> Dict[str, any]:
        """
        Extract text from EPUB file bytes.

        Args:
            epub_bytes: Raw EPUB file content
            title: Title for logging

        Returns:
            Dictionary with:
                - raw_text: Extracted text
                - cleaned_text: Normalized text
                - word_count: Number of words
                - is_valid: Quality check result
                - metadata: Additional extraction info

        Raises:
            EPUBExtractionError: If extraction fails
        """
        logger.info(f"[EPUB] Starting EPUB extraction for '{title}'")

        try:
            # Import ebooklib here to avoid import errors if not installed
            try:
                import ebooklib
                from ebooklib import epub
            except ImportError:
                raise EPUBExtractionError(
                    "ebooklib is not installed. Install with: pip install ebooklib"
                )

            # Read EPUB from bytes
            epub_file = io.BytesIO(epub_bytes)
            book = epub.read_epub(epub_file)

            # Extract text from all document items
            text_parts = []
            chapter_count = 0

            for item in book.get_items():
                if item.get_type() == ebooklib.ITEM_DOCUMENT:
                    chapter_count += 1
                    chapter_text = self._extract_text_from_html(
                        item.get_content().decode('utf-8', errors='ignore')
                    )
                    if chapter_text:
                        text_parts.append(chapter_text)

            # Join all text
            raw_text = "\n\n".join(text_parts)

            # Normalize
            cleaned_text = self._normalize_text(raw_text)

            # Count words
            word_count = self._count_words(cleaned_text)

            # Validate
            is_valid = word_count >= self.MIN_VALID_WORD_COUNT

            # Get book metadata
            book_title = book.get_metadata('DC', 'title')
            book_author = book.get_metadata('DC', 'creator')

            metadata = {
                "format": "epub",
                "chapter_count": chapter_count,
                "book_title": book_title[0][0] if book_title else None,
                "book_author": book_author[0][0] if book_author else None,
            }

            logger.info(
                f"[EPUB] Extraction complete for '{title}': "
                f"chapters={chapter_count}, words={word_count}, valid={is_valid}"
            )

            return {
                "raw_text": raw_text,
                "cleaned_text": cleaned_text,
                "word_count": word_count,
                "is_valid": is_valid,
                "is_complete": True,
                "metadata": metadata
            }

        except Exception as e:
            if isinstance(e, EPUBExtractionError):
                raise
            logger.error(f"[EPUB] Extraction failed for '{title}': {str(e)}", exc_info=True)
            raise EPUBExtractionError(f"Failed to extract EPUB for '{title}': {str(e)}")

    def _extract_text_from_html(self, html_content: str) -> str:
        """
        Extract clean text from HTML content.

        Removes all HTML tags and extracts only the text content.
        """
        if not html_content:
            return ""

        try:
            soup = BeautifulSoup(html_content, 'html.parser')

            # Remove script and style elements
            for element in soup(['script', 'style', 'head', 'meta', 'link']):
                element.decompose()

            # Get text
            text = soup.get_text(separator=' ')

            return text.strip()

        except Exception as e:
            logger.warning(f"[EPUB] Failed to parse HTML content: {str(e)}")
            return ""

    def _normalize_text(self, text: str) -> str:
        """
        Normalize extracted text.

        - Fix multiple spaces
        - Normalize line breaks
        - Remove control characters
        """
        if not text:
            return ""

        # Fix encoding issues
        text = text.encode('utf-8', errors='ignore').decode('utf-8')

        # Remove control characters except newlines/tabs
        text = re.sub(r'[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', text)

        # Normalize multiple spaces
        text = re.sub(r' {2,}', ' ', text)

        # Normalize multiple newlines
        text = re.sub(r'\n{4,}', '\n\n\n', text)

        # Strip leading/trailing whitespace on each line
        lines = [line.strip() for line in text.split('\n')]
        text = '\n'.join(lines)

        # Strip overall
        text = text.strip()

        return text

    def _count_words(self, text: str) -> int:
        """Count words in text"""
        if not text:
            return 0
        return len(re.findall(r'\b\w+\b', text))
