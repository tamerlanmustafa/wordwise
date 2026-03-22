"""
Page Extractor Service

Extracts page markers and text segments from various book formats.
Gutenberg books may have page markers in:
- EPUB: <span epub:type="pagebreak"> or similar markers
- HTML: <!-- page X -->, <a name="page_X">, etc.
- TXT: [Page X], {p. X}, or line-based markers

Since most Gutenberg books are from scanned sources, page markers
are often preserved from the original printed editions.
"""

import logging
import re
import zipfile
import io
from typing import Optional, List, Dict, Any, Tuple
from dataclasses import dataclass
from bs4 import BeautifulSoup
import ebooklib
from ebooklib import epub

logger = logging.getLogger(__name__)


@dataclass
class PageSegment:
    """Represents a page of text from a book"""
    page_number: int
    start_position: int  # Character position in full text
    end_position: int
    text: str
    chapter: Optional[str] = None


@dataclass
class PageExtractionResult:
    """Result of page extraction from a book"""
    success: bool
    method: str  # 'epub_pagebreak', 'html_markers', 'text_markers', 'chapter_based', 'estimated'
    total_pages: int
    pages: List[PageSegment]
    full_text: str
    warnings: List[str]


class PageExtractor:
    """
    Extracts page information from book files.

    Supports multiple strategies:
    1. EPUB with explicit page markers
    2. HTML with page comments or anchors
    3. Text files with [Page X] markers
    4. Chapter-based segmentation (fallback)
    5. Word-count based estimation (last resort)
    """

    # Common page marker patterns in text files
    TEXT_PAGE_PATTERNS = [
        r'\[Page\s+(\d+)\]',  # [Page 123]
        r'\{p\.\s*(\d+)\}',   # {p. 123}
        r'\[p\.\s*(\d+)\]',   # [p. 123]
        r'—\s*Page\s+(\d+)\s*—',  # — Page 123 —
        r'\*\*\*\s*PAGE\s+(\d+)\s*\*\*\*',  # *** PAGE 123 ***
        r'^\s*(\d+)\s*$',     # Just a number on its own line (page number)
    ]

    # HTML page marker patterns
    HTML_PAGE_PATTERNS = [
        r'<!--\s*page\s+(\d+)\s*-->',  # <!-- page 123 -->
        r'<a\s+name=["\']?page[_-]?(\d+)["\']?',  # <a name="page_123">
        r'<span[^>]*id=["\']?page[_-]?(\d+)["\']?',  # <span id="page-123">
        r'<div[^>]*class=["\']?pagenum["\']?[^>]*>(\d+)',  # <div class="pagenum">123
        r'<span[^>]*class=["\']?pagenum["\']?[^>]*>(\d+)',  # <span class="pagenum">123
    ]

    def __init__(self):
        pass

    async def extract_from_epub(self, epub_content: bytes) -> PageExtractionResult:
        """
        Extract pages from EPUB file content.

        EPUB files may contain:
        - epub:type="pagebreak" spans
        - Page number anchors
        - Chapter divisions
        """
        warnings = []
        pages = []
        full_text_parts = []

        try:
            book = epub.read_epub(io.BytesIO(epub_content))

            # First pass: collect all text and look for page markers
            all_content = []
            page_markers = []  # List of (position, page_number)
            current_position = 0

            for item in book.get_items():
                if item.get_type() == ebooklib.ITEM_DOCUMENT:
                    content = item.get_content().decode('utf-8', errors='ignore')
                    soup = BeautifulSoup(content, 'html.parser')

                    # Look for page break markers
                    # Common patterns: epub:type="pagebreak", class="pagebreak", etc.
                    for pagebreak in soup.find_all(attrs={'epub:type': 'pagebreak'}):
                        page_num = self._extract_page_number_from_element(pagebreak)
                        if page_num:
                            page_markers.append((current_position + len(''.join(all_content)), page_num))

                    # Also check for span/div with pagenum class
                    for pagenum in soup.find_all(class_=re.compile(r'pagenum|page-number|pageno')):
                        page_num = self._extract_page_number_from_element(pagenum)
                        if page_num:
                            page_markers.append((current_position + len(''.join(all_content)), page_num))

                    # Extract text
                    text = soup.get_text(separator='\n', strip=True)
                    all_content.append(text)
                    current_position += len(text) + 1  # +1 for separator

            full_text = '\n'.join(all_content)

            if page_markers:
                # Sort markers by position
                page_markers.sort(key=lambda x: x[0])

                # Create page segments
                for i, (pos, page_num) in enumerate(page_markers):
                    end_pos = page_markers[i + 1][0] if i + 1 < len(page_markers) else len(full_text)
                    pages.append(PageSegment(
                        page_number=page_num,
                        start_position=pos,
                        end_position=end_pos,
                        text=full_text[pos:end_pos].strip()
                    ))

                return PageExtractionResult(
                    success=True,
                    method='epub_pagebreak',
                    total_pages=len(pages),
                    pages=pages,
                    full_text=full_text,
                    warnings=warnings
                )
            else:
                warnings.append("No page markers found in EPUB")
                # Fall back to chapter-based or estimated
                return self._create_estimated_pages(full_text, warnings, 'epub_estimated')

        except Exception as e:
            logger.error(f"[PageExtractor] EPUB extraction failed: {e}", exc_info=True)
            return PageExtractionResult(
                success=False,
                method='epub_failed',
                total_pages=0,
                pages=[],
                full_text='',
                warnings=[f"EPUB extraction failed: {str(e)}"]
            )

    def _extract_page_number_from_element(self, element) -> Optional[int]:
        """Extract page number from an HTML element"""
        # Check title attribute
        title = element.get('title', '')
        if title:
            match = re.search(r'(\d+)', title)
            if match:
                return int(match.group(1))

        # Check id attribute
        elem_id = element.get('id', '')
        if elem_id:
            match = re.search(r'(\d+)', elem_id)
            if match:
                return int(match.group(1))

        # Check text content
        text = element.get_text(strip=True)
        if text and text.isdigit():
            return int(text)

        return None

    async def extract_from_html(self, html_content: str) -> PageExtractionResult:
        """
        Extract pages from HTML content.
        """
        warnings = []
        pages = []

        try:
            soup = BeautifulSoup(html_content, 'html.parser')
            full_text = soup.get_text(separator='\n', strip=True)

            # Look for page markers in raw HTML
            page_markers = []

            for pattern in self.HTML_PAGE_PATTERNS:
                for match in re.finditer(pattern, html_content, re.IGNORECASE):
                    page_num = int(match.group(1))
                    # Find approximate position in plain text
                    html_pos = match.start()
                    # Estimate text position (rough approximation)
                    text_before_html = soup.get_text(separator='\n', strip=True)[:html_pos]
                    text_pos = len(re.sub(r'<[^>]+>', '', html_content[:html_pos]))
                    page_markers.append((text_pos, page_num))

            # Also check for pagenum spans/divs
            for pagenum in soup.find_all(class_=re.compile(r'pagenum|page-number|pageno')):
                page_num = self._extract_page_number_from_element(pagenum)
                if page_num:
                    # Find position in text
                    page_markers.append((0, page_num))  # Simplified - would need better position tracking

            if page_markers:
                # Deduplicate and sort
                page_markers = list(set(page_markers))
                page_markers.sort(key=lambda x: x[1])  # Sort by page number

                # Create segments (simplified - uses page number order)
                for i, (_, page_num) in enumerate(page_markers):
                    pages.append(PageSegment(
                        page_number=page_num,
                        start_position=0,  # Simplified
                        end_position=0,
                        text=''  # Would need better extraction
                    ))

                return PageExtractionResult(
                    success=True,
                    method='html_markers',
                    total_pages=len(pages),
                    pages=pages,
                    full_text=full_text,
                    warnings=warnings
                )
            else:
                warnings.append("No page markers found in HTML")
                return self._create_estimated_pages(full_text, warnings, 'html_estimated')

        except Exception as e:
            logger.error(f"[PageExtractor] HTML extraction failed: {e}", exc_info=True)
            return PageExtractionResult(
                success=False,
                method='html_failed',
                total_pages=0,
                pages=[],
                full_text='',
                warnings=[f"HTML extraction failed: {str(e)}"]
            )

    async def extract_from_text(self, text_content: str) -> PageExtractionResult:
        """
        Extract pages from plain text content.
        """
        warnings = []
        page_markers = []

        try:
            # Try each pattern
            for pattern in self.TEXT_PAGE_PATTERNS:
                for match in re.finditer(pattern, text_content, re.MULTILINE | re.IGNORECASE):
                    page_num = int(match.group(1))
                    pos = match.start()
                    page_markers.append((pos, page_num))

            if page_markers:
                # Deduplicate and sort by position
                seen = set()
                unique_markers = []
                for pos, page_num in sorted(page_markers, key=lambda x: x[0]):
                    if page_num not in seen:
                        seen.add(page_num)
                        unique_markers.append((pos, page_num))

                page_markers = unique_markers

                # Create page segments
                pages = []
                for i, (pos, page_num) in enumerate(page_markers):
                    end_pos = page_markers[i + 1][0] if i + 1 < len(page_markers) else len(text_content)
                    pages.append(PageSegment(
                        page_number=page_num,
                        start_position=pos,
                        end_position=end_pos,
                        text=text_content[pos:end_pos].strip()
                    ))

                return PageExtractionResult(
                    success=True,
                    method='text_markers',
                    total_pages=len(pages),
                    pages=pages,
                    full_text=text_content,
                    warnings=warnings
                )
            else:
                warnings.append("No page markers found in text")
                return self._create_estimated_pages(text_content, warnings, 'text_estimated')

        except Exception as e:
            logger.error(f"[PageExtractor] Text extraction failed: {e}", exc_info=True)
            return PageExtractionResult(
                success=False,
                method='text_failed',
                total_pages=0,
                pages=[],
                full_text=text_content,
                warnings=[f"Text extraction failed: {str(e)}"]
            )

    def _create_estimated_pages(
        self,
        text: str,
        warnings: List[str],
        method: str,
        words_per_page: int = 250
    ) -> PageExtractionResult:
        """
        Create estimated pages based on word count.
        Average book page has about 250 words.
        """
        words = text.split()
        total_words = len(words)
        estimated_pages = max(1, total_words // words_per_page)

        pages = []
        words_per_segment = len(words) // estimated_pages if estimated_pages > 0 else len(words)

        current_pos = 0
        for i in range(estimated_pages):
            start_word = i * words_per_segment
            end_word = min((i + 1) * words_per_segment, len(words))

            page_words = words[start_word:end_word]
            page_text = ' '.join(page_words)

            # Find actual character positions
            start_pos = text.find(page_words[0], current_pos) if page_words else current_pos
            end_pos = start_pos + len(page_text)

            pages.append(PageSegment(
                page_number=i + 1,
                start_position=start_pos,
                end_position=end_pos,
                text=page_text
            ))

            current_pos = end_pos

        warnings.append(f"Using estimated pages ({words_per_page} words per page)")

        return PageExtractionResult(
            success=True,
            method=method,
            total_pages=estimated_pages,
            pages=pages,
            full_text=text,
            warnings=warnings
        )

    def get_words_for_page_range(
        self,
        pages: List[PageSegment],
        start_page: int,
        end_page: int
    ) -> str:
        """
        Get the combined text for a range of pages.
        """
        selected_pages = [p for p in pages if start_page <= p.page_number <= end_page]
        return '\n'.join(p.text for p in selected_pages)


# Singleton instance
_extractor: Optional[PageExtractor] = None


def get_page_extractor() -> PageExtractor:
    """Get the singleton page extractor instance"""
    global _extractor
    if _extractor is None:
        _extractor = PageExtractor()
    return _extractor
