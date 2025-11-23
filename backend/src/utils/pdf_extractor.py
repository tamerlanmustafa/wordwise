"""
PDF Extraction Utility for Movie Scripts

This module handles downloading and extracting text from STANDS4 PDF scripts.
It includes validation, normalization, and truncation detection.
"""

import io
import re
import logging
from typing import Dict, Optional, Tuple
import pdfplumber
import httpx
from pypdf import PdfReader

logger = logging.getLogger(__name__)


class PDFExtractionError(Exception):
    """Raised when PDF extraction fails"""
    pass


class PDFExtractor:
    """
    Handles PDF downloading and text extraction with quality validation.

    Features:
    - Downloads PDFs from URLs
    - Extracts text using pdfplumber (primary) and pypdf (fallback)
    - Normalizes spacing, page breaks, and encoding
    - Detects truncated or incomplete PDFs
    - Validates minimum word count (>2000 words)
    """

    MIN_VALID_WORD_COUNT = 2000
    MAX_DOWNLOAD_SIZE_MB = 50

    def __init__(self):
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(60.0, connect=10.0),
            follow_redirects=True
        )

    async def download_and_extract(
        self,
        pdf_url: str,
        movie_title: str
    ) -> Dict[str, any]:
        """
        Download PDF and extract text with full validation.

        Args:
            pdf_url: URL to the PDF file
            movie_title: Movie title for logging

        Returns:
            Dictionary with:
                - raw_text: Extracted text
                - word_count: Number of words
                - is_truncated: Whether PDF appears incomplete
                - is_valid: Whether extraction succeeded with quality check
                - metadata: Additional extraction info

        Raises:
            PDFExtractionError: If download or extraction fails
        """
        logger.info(f"[PDF] Starting PDF download for '{movie_title}' from {pdf_url}")

        try:
            # Download PDF
            pdf_bytes = await self._download_pdf(pdf_url, movie_title)

            # Extract text using primary method (pdfplumber)
            raw_text, metadata = await self._extract_with_pdfplumber(pdf_bytes, movie_title)

            # Fallback to pypdf if pdfplumber fails or yields poor results
            if not raw_text or len(raw_text.strip()) < 100:
                logger.warning(f"[PDF] pdfplumber yielded poor results for '{movie_title}', trying pypdf")
                raw_text, fallback_metadata = await self._extract_with_pypdf(pdf_bytes, movie_title)
                metadata.update({"fallback_used": "pypdf", **fallback_metadata})

            # Normalize and clean text
            normalized_text = self._normalize_text(raw_text)

            # Count words
            word_count = self._count_words(normalized_text)

            # Detect truncation
            is_truncated = self._detect_truncation(normalized_text, metadata)

            # Validate quality
            is_valid = word_count >= self.MIN_VALID_WORD_COUNT

            logger.info(
                f"[PDF] Extraction complete for '{movie_title}': "
                f"words={word_count}, valid={is_valid}, truncated={is_truncated}"
            )

            return {
                "raw_text": raw_text,
                "cleaned_text": normalized_text,
                "word_count": word_count,
                "is_truncated": is_truncated,
                "is_valid": is_valid,
                "is_complete": not is_truncated and is_valid,
                "metadata": metadata
            }

        except Exception as e:
            logger.error(f"[PDF] Extraction failed for '{movie_title}': {str(e)}", exc_info=True)
            raise PDFExtractionError(f"Failed to extract PDF for '{movie_title}': {str(e)}")

    async def _download_pdf(self, url: str, movie_title: str) -> bytes:
        """Download PDF from URL with size validation"""
        try:
            # First attempt: try downloading directly
            response = await self.client.get(url)
            response.raise_for_status()

            # Check if response is HTML (iframe page) instead of PDF
            if response.content.startswith(b'<html') or response.content.startswith(b'<!DOCTYPE'):
                # This is an HTML page with an iframe - extract the real PDF URL
                logger.info(f"[PDF] URL returned HTML, extracting iframe PDF URL...")

                # Parse HTML to find iframe src with the PDF
                html_content = response.text
                import re

                # Look for iframe with PDF viewer
                # Example: src="https://drive.google.com/viewerng/viewer?embedded=true&url=www.scripts.com/script-pdf-body.php?id=301"
                iframe_match = re.search(r'<iframe[^>]*src=["\']([^"\']*script-pdf[^"\']*)["\']', html_content, re.IGNORECASE)

                if iframe_match:
                    iframe_url = iframe_match.group(1)
                    logger.info(f"[PDF] Found iframe URL: {iframe_url}")

                    # Extract the actual PDF URL from Google Drive viewer
                    # Format: https://drive.google.com/viewerng/viewer?embedded=true&url=www.scripts.com/script-pdf-body.php?id=301
                    pdf_match = re.search(r'[?&]url=([^&]+)', iframe_url)
                    if pdf_match:
                        actual_pdf_url = pdf_match.group(1)
                        # Add https:// if missing
                        if not actual_pdf_url.startswith('http'):
                            actual_pdf_url = f"https://{actual_pdf_url}"

                        logger.info(f"[PDF] Extracted actual PDF URL: {actual_pdf_url}")

                        # Now download the actual PDF
                        pdf_response = await self.client.get(actual_pdf_url)
                        pdf_response.raise_for_status()
                        response = pdf_response

            # Check size
            content_length = len(response.content)
            max_bytes = self.MAX_DOWNLOAD_SIZE_MB * 1024 * 1024

            if content_length > max_bytes:
                raise PDFExtractionError(
                    f"PDF too large: {content_length / 1024 / 1024:.1f}MB > {self.MAX_DOWNLOAD_SIZE_MB}MB"
                )

            # Verify it's actually a PDF
            if not response.content.startswith(b'%PDF'):
                raise PDFExtractionError("Downloaded file is not a valid PDF")

            logger.info(f"[PDF] Downloaded {content_length / 1024:.1f}KB for '{movie_title}'")
            return response.content

        except httpx.HTTPError as e:
            raise PDFExtractionError(f"Failed to download PDF: {str(e)}")

    async def _extract_with_pdfplumber(
        self,
        pdf_bytes: bytes,
        movie_title: str
    ) -> Tuple[str, Dict]:
        """Extract text using pdfplumber (higher quality)"""
        try:
            pdf_file = io.BytesIO(pdf_bytes)
            text_parts = []
            metadata = {"method": "pdfplumber", "pages": 0}

            with pdfplumber.open(pdf_file) as pdf:
                metadata["pages"] = len(pdf.pages)

                for page_num, page in enumerate(pdf.pages, 1):
                    page_text = page.extract_text()
                    if page_text:
                        text_parts.append(page_text)

                    # Log progress for large PDFs
                    if page_num % 20 == 0:
                        logger.debug(f"[PDF] Processed {page_num}/{len(pdf.pages)} pages for '{movie_title}'")

            full_text = "\n\n".join(text_parts)
            logger.info(f"[PDF] pdfplumber extracted {len(full_text)} chars from {metadata['pages']} pages")

            return full_text, metadata

        except Exception as e:
            logger.warning(f"[PDF] pdfplumber extraction failed: {str(e)}")
            return "", {"method": "pdfplumber", "error": str(e)}

    async def _extract_with_pypdf(
        self,
        pdf_bytes: bytes,
        movie_title: str
    ) -> Tuple[str, Dict]:
        """Extract text using pypdf (fallback method)"""
        try:
            pdf_file = io.BytesIO(pdf_bytes)
            reader = PdfReader(pdf_file)

            text_parts = []
            metadata = {"method": "pypdf", "pages": len(reader.pages)}

            for page_num, page in enumerate(reader.pages, 1):
                page_text = page.extract_text()
                if page_text:
                    text_parts.append(page_text)

            full_text = "\n\n".join(text_parts)
            logger.info(f"[PDF] pypdf extracted {len(full_text)} chars from {metadata['pages']} pages")

            return full_text, metadata

        except Exception as e:
            logger.warning(f"[PDF] pypdf extraction failed: {str(e)}")
            return "", {"method": "pypdf", "error": str(e)}

    def _normalize_text(self, text: str) -> str:
        """
        Normalize extracted PDF text.

        - Fix multiple spaces
        - Normalize line breaks
        - Remove page numbers and headers
        - Fix common encoding issues
        """
        if not text:
            return ""

        # Fix encoding issues
        text = text.encode('utf-8', errors='ignore').decode('utf-8')

        # Remove form feed and other control characters except newlines/tabs
        text = re.sub(r'[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', text)

        # Normalize multiple spaces
        text = re.sub(r' {2,}', ' ', text)

        # Normalize multiple newlines (keep paragraph breaks)
        text = re.sub(r'\n{4,}', '\n\n\n', text)

        # Remove common page number patterns
        text = re.sub(r'^\s*\d+\s*$', '', text, flags=re.MULTILINE)

        # Remove common header/footer patterns
        text = re.sub(r'^\s*Page \d+ of \d+\s*$', '', text, flags=re.MULTILINE)

        # Strip leading/trailing whitespace
        text = text.strip()

        return text

    def _count_words(self, text: str) -> int:
        """Count words in text"""
        if not text:
            return 0
        return len(re.findall(r'\b\w+\b', text))

    def _detect_truncation(self, text: str, metadata: Dict) -> bool:
        """
        Detect if PDF appears truncated or incomplete.

        Indicators:
        - Ends abruptly mid-sentence
        - Very short compared to typical scripts
        - Missing common ending markers
        """
        if not text:
            return True

        # Check if text ends mid-sentence (no period, question mark, etc.)
        last_100_chars = text[-100:].strip()
        ends_properly = bool(re.search(r'[.!?"\']$', last_100_chars))

        # Check for common script endings
        has_ending_marker = bool(re.search(
            r'(THE END|FADE OUT|CREDITS|FIN|END OF SCRIPT)',
            text[-500:],
            re.IGNORECASE
        ))

        # If very short and doesn't end properly, likely truncated
        word_count = self._count_words(text)
        if word_count < 5000 and not ends_properly:
            return True

        # If missing ending marker and doesn't end with punctuation
        if not has_ending_marker and not ends_properly:
            logger.warning(f"[PDF] Possible truncation detected: no ending marker, improper ending")
            return True

        return False

    async def close(self):
        """Close HTTP client"""
        await self.client.aclose()
