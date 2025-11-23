"""
Subtitle (SRT/VTT) Parser and Dialogue Extractor

This module handles parsing subtitle files and extracting clean dialogue text.
Removes timestamps, formatting, and extracts only spoken dialogue.
"""

import re
import logging
from typing import List, Dict, Optional
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


class SubtitleParsingError(Exception):
    """Raised when subtitle parsing fails"""
    pass


class SubtitleParser:
    """
    Parses SRT and VTT subtitle files and extracts dialogue.

    Features:
    - Removes timestamps and numbering
    - Cleans HTML tags and formatting codes
    - Removes speaker labels and sound effects
    - Deduplicates repeated lines
    - Validates dialogue quality
    """

    MIN_VALID_WORD_COUNT = 1000  # Subtitles have less text than full scripts

    def __init__(self):
        # Patterns for cleaning
        self.timestamp_pattern = re.compile(
            r'\d{1,2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,\.]\d{3}'
        )
        self.sequence_number_pattern = re.compile(r'^\d+$')
        self.speaker_label_pattern = re.compile(r'^[A-Z][A-Z\s]+:', re.MULTILINE)
        self.sound_effect_pattern = re.compile(r'\[.*?\]|\(.*?\)|♪.*?♪')
        self.html_tag_pattern = re.compile(r'<[^>]+>')

    def parse_srt(self, srt_content: str, movie_title: str) -> Dict[str, any]:
        """
        Parse SRT subtitle file and extract dialogue.

        Args:
            srt_content: Raw SRT file content
            movie_title: Movie title for logging

        Returns:
            Dictionary with:
                - raw_text: Original subtitle content
                - cleaned_text: Extracted dialogue
                - dialogue_lines: List of individual dialogue lines
                - word_count: Number of words
                - is_valid: Quality check result
                - metadata: Processing info
        """
        logger.info(f"[SRT] Starting SRT parsing for '{movie_title}'")

        try:
            # Split into subtitle blocks
            blocks = self._split_srt_blocks(srt_content)

            # Extract dialogue from each block
            dialogue_lines = []
            for block in blocks:
                dialogue = self._extract_dialogue_from_block(block)
                if dialogue:
                    dialogue_lines.append(dialogue)

            # Remove duplicates (consecutive repeated lines)
            dialogue_lines = self._deduplicate_lines(dialogue_lines)

            # Join into full text
            cleaned_text = "\n".join(dialogue_lines)

            # Count words
            word_count = self._count_words(cleaned_text)

            # Validate
            is_valid = word_count >= self.MIN_VALID_WORD_COUNT

            metadata = {
                "format": "srt",
                "total_blocks": len(blocks),
                "dialogue_lines": len(dialogue_lines),
                "avg_line_length": len(cleaned_text) / len(dialogue_lines) if dialogue_lines else 0
            }

            logger.info(
                f"[SRT] Parsing complete for '{movie_title}': "
                f"blocks={len(blocks)}, lines={len(dialogue_lines)}, words={word_count}, valid={is_valid}"
            )

            return {
                "raw_text": srt_content,
                "cleaned_text": cleaned_text,
                "dialogue_lines": dialogue_lines,
                "word_count": word_count,
                "is_valid": is_valid,
                "is_complete": True,  # Subtitles are always complete (just dialogue)
                "metadata": metadata
            }

        except Exception as e:
            logger.error(f"[SRT] Parsing failed for '{movie_title}': {str(e)}", exc_info=True)
            raise SubtitleParsingError(f"Failed to parse SRT for '{movie_title}': {str(e)}")

    def parse_vtt(self, vtt_content: str, movie_title: str) -> Dict[str, any]:
        """
        Parse VTT (WebVTT) subtitle file.

        VTT is similar to SRT but with additional features.
        """
        logger.info(f"[VTT] Starting VTT parsing for '{movie_title}'")

        try:
            # Remove WEBVTT header
            content = re.sub(r'^WEBVTT.*?\n\n', '', vtt_content, flags=re.MULTILINE)

            # Remove style blocks
            content = re.sub(r'STYLE\s*\n.*?(?=\n\n)', '', content, flags=re.DOTALL)

            # Remove NOTE blocks
            content = re.sub(r'NOTE\s*\n.*?(?=\n\n)', '', content, flags=re.DOTALL)

            # Now parse as SRT
            result = self.parse_srt(content, movie_title)
            result["metadata"]["format"] = "vtt"

            return result

        except Exception as e:
            logger.error(f"[VTT] Parsing failed for '{movie_title}': {str(e)}", exc_info=True)
            raise SubtitleParsingError(f"Failed to parse VTT for '{movie_title}': {str(e)}")

    def _split_srt_blocks(self, content: str) -> List[str]:
        """Split SRT content into individual subtitle blocks"""
        # Normalize line endings
        content = content.replace('\r\n', '\n').replace('\r', '\n')

        # Split by double newlines (block separator)
        blocks = re.split(r'\n\n+', content)

        # Filter out empty blocks
        blocks = [block.strip() for block in blocks if block.strip()]

        return blocks

    def _extract_dialogue_from_block(self, block: str) -> Optional[str]:
        """
        Extract dialogue from a single SRT block.

        Block format:
        1
        00:00:01,000 --> 00:00:03,000
        This is the dialogue

        Returns only the dialogue part, cleaned.
        """
        lines = block.split('\n')

        # Skip sequence number (first line)
        # Skip timestamp (second line)
        # Everything else is dialogue
        dialogue_lines = []

        for i, line in enumerate(lines):
            # Skip sequence numbers
            if i == 0 and self.sequence_number_pattern.match(line.strip()):
                continue

            # Skip timestamps
            if self.timestamp_pattern.search(line):
                continue

            # Skip empty lines
            if not line.strip():
                continue

            # This is dialogue
            dialogue_lines.append(line.strip())

        if not dialogue_lines:
            return None

        # Join multi-line dialogue
        dialogue = " ".join(dialogue_lines)

        # Clean the dialogue
        dialogue = self._clean_dialogue_line(dialogue)

        return dialogue if dialogue else None

    def _clean_dialogue_line(self, line: str) -> str:
        """
        Clean a single dialogue line.

        - Remove HTML tags
        - Remove sound effects [brackets] and (parentheses)
        - Remove speaker labels
        - Remove formatting codes
        - Normalize spacing
        """
        if not line:
            return ""

        # Remove HTML tags (some subtitles use <i>, <b>, etc.)
        line = self.html_tag_pattern.sub('', line)

        # Use BeautifulSoup for any remaining HTML entities
        line = BeautifulSoup(line, "html.parser").get_text()

        # Remove sound effects and descriptions
        line = self.sound_effect_pattern.sub('', line)

        # Remove speaker labels (e.g., "JOHN: Hello")
        line = self.speaker_label_pattern.sub('', line)

        # Remove subtitle formatting codes
        line = re.sub(r'\{\\.*?\}', '', line)  # {\an8} style codes

        # Remove extra dashes used in some subtitles
        line = re.sub(r'^-\s*', '', line)
        line = re.sub(r'\s*-$', '', line)

        # Normalize whitespace
        line = re.sub(r'\s+', ' ', line)

        # Strip
        line = line.strip()

        # Remove if too short (likely garbage)
        if len(line) < 2:
            return ""

        return line

    def _deduplicate_lines(self, lines: List[str]) -> List[str]:
        """
        Remove consecutive duplicate lines.

        Subtitles often repeat lines across blocks due to timing.
        """
        if not lines:
            return []

        deduplicated = [lines[0]]

        for i in range(1, len(lines)):
            # Only add if different from previous line
            if lines[i] != lines[i - 1]:
                deduplicated.append(lines[i])

        return deduplicated

    def _count_words(self, text: str) -> int:
        """Count words in text"""
        if not text:
            return 0
        return len(re.findall(r'\b\w+\b', text))

    def detect_subtitle_format(self, content: str) -> str:
        """
        Detect whether content is SRT or VTT format.

        Returns:
            "srt", "vtt", or "unknown"
        """
        # Check for WEBVTT header
        if content.strip().startswith('WEBVTT'):
            return "vtt"

        # Check for SRT pattern (sequence number followed by timestamp)
        srt_pattern = r'^\d+\s*\n\d{1,2}:\d{2}:\d{2}'
        if re.match(srt_pattern, content.strip(), re.MULTILINE):
            return "srt"

        # Check for timestamp pattern anywhere
        if self.timestamp_pattern.search(content):
            return "srt"  # Default to SRT if timestamps found

        return "unknown"
