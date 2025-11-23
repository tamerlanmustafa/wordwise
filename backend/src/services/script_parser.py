"""
Script Parser - OPTIMIZED FOR SPEED

Fast script parsing with minimal dependencies and aggressive text normalization.
"""

import re
from typing import List, Dict


class ScriptParser:
    """
    OPTIMIZED script parser with fast regex-based processing

    NO NLTK dependencies - uses pure Python regex for speed
    """

    def __init__(self):
        """Initialize parser"""
        pass

    def parse_srt(self, srt_content: str) -> str:
        """
        Parse SRT subtitle file and extract text (OPTIMIZED)

        Fast regex-based approach, no external dependencies
        """
        # Remove subtitle numbers (standalone lines with just digits)
        text = re.sub(r'^\d+\s*$', '', srt_content, flags=re.MULTILINE)

        # Remove timestamps (format: 00:00:00,000 --> 00:00:00,000)
        text = re.sub(r'\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}', '', text)

        # Remove HTML tags
        text = re.sub(r'<[^>]+>', '', text)

        # Remove formatting tags (e.g., {b}, {i}, etc.)
        text = re.sub(r'\{[^}]+\}', '', text)

        # Replace multiple newlines with single space
        text = re.sub(r'\n+', ' ', text)

        # Normalize whitespace
        text = re.sub(r'\s+', ' ', text).strip()

        return text

    def parse_txt(self, txt_content: str) -> str:
        """
        Parse plain text script (OPTIMIZED)

        Fast regex-based approach
        """
        # Remove stage directions in parentheses
        text = re.sub(r'\([^)]{0,200}\)', '', txt_content)

        # Remove scene descriptions in brackets
        text = re.sub(r'\[[^\]]{0,200}\]', '', text)

        # Remove script formatting markers
        text = re.sub(r'^(SCENE|INT\.|EXT\.|FADE|CUT TO|DISSOLVE).*$', '', text, flags=re.MULTILINE)

        # Replace multiple newlines with single space
        text = re.sub(r'\n+', ' ', text)

        # Normalize whitespace
        text = re.sub(r'\s+', ' ', text).strip()

        return text

    def extract_dialogue(self, script_text: str) -> List[str]:
        """
        Extract dialogue from script text (OPTIMIZED)

        Returns list of dialogue lines
        """
        # Split by newlines
        lines = re.split(r'\n+', script_text)
        dialogue = []

        for line in lines:
            line = line.strip()

            # Skip empty lines
            if not line:
                continue

            # Skip common script elements
            if line.startswith(('SCENE', 'INT.', 'EXT.', 'FADE', 'CUT TO', 'DISSOLVE')):
                continue

            # Skip character names (ALL CAPS)
            if line.isupper() and len(line.split()) <= 3:
                continue

            # Add line if it looks like dialogue
            if line and (line[0].isupper() or line.startswith('"')):
                dialogue.append(line)

        return dialogue

    def clean_text(self, text: str) -> str:
        """
        Clean and normalize text (OPTIMIZED)

        This is the FAST version used for all script processing.
        """
        # Lowercase
        text = text.lower()

        # Fix curly quotes and apostrophes (common in PDFs)
        text = text.replace("'", "'").replace("'", "'")
        text = text.replace(""", '"').replace(""", '"')

        # Replace em-dashes and en-dashes with spaces
        text = re.sub(r'[—–−]', ' ', text)

        # Remove special characters but keep apostrophes (for contractions)
        text = re.sub(r'[^a-z\s\']', ' ', text)

        # Collapse multiple spaces
        text = re.sub(r'\s+', ' ', text)

        return text.strip()

    def normalize_script_text(self, text: str) -> str:
        """
        Full script normalization pipeline (OPTIMIZED)

        This is called on all scripts before storage.
        """
        # Remove excessive whitespace
        text = re.sub(r'\s+', ' ', text)

        # Remove null bytes and other control characters
        text = re.sub(r'[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]', '', text)

        # Fix common encoding issues
        text = text.replace('\r\n', '\n').replace('\r', '\n')

        # Normalize unicode quotes
        text = text.replace("'", "'").replace("'", "'")
        text = text.replace(""", '"').replace(""", '"')

        # Collapse multiple newlines
        text = re.sub(r'\n\s*\n', '\n', text)

        # Strip leading/trailing whitespace
        text = text.strip()

        return text

    def count_words(self, text: str) -> int:
        """
        Fast word count (OPTIMIZED)

        Uses simple whitespace splitting instead of complex tokenization.
        """
        # Normalize text first
        normalized = self.clean_text(text)

        # Split on whitespace
        words = normalized.split()

        # Filter out very short tokens (< 2 chars)
        words = [w for w in words if len(w) >= 2]

        return len(words)

    def extract_metadata(self, text: str) -> Dict[str, any]:
        """
        Extract metadata from script text (OPTIMIZED)

        Returns basic metadata without heavy processing.
        """
        # Count lines
        lines = text.split('\n')
        line_count = len(lines)

        # Count words (fast)
        word_count = self.count_words(text)

        # Calculate average line length
        avg_line_length = sum(len(line) for line in lines) / line_count if line_count > 0 else 0

        return {
            'line_count': line_count,
            'word_count': word_count,
            'avg_line_length': round(avg_line_length, 2),
            'has_dialogue': any(line.strip() and not line.strip().startswith(('SCENE', 'INT.', 'EXT.')) for line in lines[:100])
        }
