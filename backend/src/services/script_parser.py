"""
Script Parser - MAXIMUM SPEED OPTIMIZATION

Pure regex processing with aggressive pre-cleaning
"""

import re
from typing import List, Dict


class ScriptParser:
    def __init__(self):
        pass

    @staticmethod
    def aggressive_preclean(text: str) -> str:
        text = text.lower()
        text = text.replace("'", "'").replace("'", "'")
        text = text.replace(""", '"').replace(""", '"')
        text = re.sub(r'[^\w\s]', ' ', text)
        text = re.sub(r'\d+', '', text)
        text = re.sub(r'\s+', ' ', text).strip()
        return text

    def parse_srt(self, srt_content: str) -> str:
        text = re.sub(r'^\d+\s*$', '', srt_content, flags=re.MULTILINE)
        text = re.sub(r'\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}', '', text)
        text = re.sub(r'<[^>]+>', '', text)
        text = re.sub(r'\{[^}]+\}', '', text)
        text = re.sub(r'\n+', ' ', text)
        text = re.sub(r'\s+', ' ', text).strip()
        return text

    def parse_txt(self, txt_content: str) -> str:
        text = re.sub(r'\([^)]{0,200}\)', '', txt_content)
        text = re.sub(r'\[[^\]]{0,200}\]', '', text)
        text = re.sub(r'^(SCENE|INT\.|EXT\.|FADE|CUT TO|DISSOLVE).*$', '', text, flags=re.MULTILINE)
        text = re.sub(r'\n+', ' ', text)
        text = re.sub(r'\s+', ' ', text).strip()
        return text

    def extract_dialogue(self, script_text: str) -> List[str]:
        lines = re.split(r'\n+', script_text)
        dialogue = []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            if line.startswith(('SCENE', 'INT.', 'EXT.', 'FADE', 'CUT TO', 'DISSOLVE')):
                continue
            if line.isupper() and len(line.split()) <= 3:
                continue
            if line and (line[0].isupper() or line.startswith('"')):
                dialogue.append(line)
        return dialogue

    def clean_text(self, text: str) -> str:
        text = text.lower()
        text = text.replace("'", "'").replace("'", "'")
        text = text.replace(""", '"').replace(""", '"')
        text = re.sub(r'[—–−]', ' ', text)
        text = re.sub(r'[^a-z\s\']', ' ', text)
        text = re.sub(r'\s+', ' ', text)
        return text.strip()

    def normalize_script_text(self, text: str) -> str:
        text = re.sub(r'\s+', ' ', text)
        text = re.sub(r'[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]', '', text)
        text = text.replace('\r\n', '\n').replace('\r', '\n')
        text = text.replace("'", "'").replace("'", "'")
        text = text.replace(""", '"').replace(""", '"')
        text = re.sub(r'\n\s*\n', '\n', text)
        text = text.strip()
        return text

    def count_words(self, text: str) -> int:
        normalized = self.clean_text(text)
        words = normalized.split()
        words = [w for w in words if len(w) >= 2]
        return len(words)

    def extract_metadata(self, text: str) -> Dict[str, any]:
        lines = text.split('\n')
        line_count = len(lines)
        word_count = self.count_words(text)
        avg_line_length = sum(len(line) for line in lines) / line_count if line_count > 0 else 0
        return {
            'line_count': line_count,
            'word_count': word_count,
            'avg_line_length': round(avg_line_length, 2),
            'has_dialogue': any(line.strip() and not line.strip().startswith(('SCENE', 'INT.', 'EXT.')) for line in lines[:100])
        }
