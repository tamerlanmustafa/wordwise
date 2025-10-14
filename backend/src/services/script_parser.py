import re
from typing import List, Dict
import nltk
from nltk.tokenize import word_tokenize
from nltk.corpus import stopwords
from nltk.stem import WordNetLemmatizer

# Download required NLTK data
try:
    nltk.data.find('tokenizers/punkt')
except LookupError:
    nltk.download('punkt')

try:
    nltk.data.find('corpora/stopwords')
except LookupError:
    nltk.download('stopwords')

try:
    nltk.data.find('corpora/wordnet')
except LookupError:
    nltk.download('wordnet')

try:
    nltk.data.find('taggers/averaged_perceptron_tagger')
except LookupError:
    nltk.download('averaged_perceptron_tagger')


class ScriptParser:
    """Parse movie scripts and extract dialogue"""
    
    def __init__(self):
        self.stop_words = set(stopwords.words('english'))
        self.lemmatizer = WordNetLemmatizer()
    
    def parse_srt(self, srt_content: str) -> str:
        """Parse SRT subtitle file and extract text"""
        # Remove SRT formatting (timestamps, line numbers)
        text = re.sub(r'\d+', '', srt_content)
        text = re.sub(r'\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}', '', text)
        text = re.sub(r'<[^>]+>', '', text)  # Remove HTML tags
        text = re.sub(r'\n+', ' ', text)  # Replace newlines with spaces
        text = re.sub(r'\s+', ' ', text)  # Normalize whitespace
        
        return text.strip()
    
    def parse_txt(self, txt_content: str) -> str:
        """Parse plain text script"""
        # Remove common script formatting
        text = re.sub(r'\(.*?\)', '', txt_content)  # Remove stage directions
        text = re.sub(r'\[.*?\]', '', text)  # Remove scene descriptions
        text = re.sub(r'\n+', ' ', text)  # Replace newlines with spaces
        text = re.sub(r'\s+', ' ', text)  # Normalize whitespace
        
        return text.strip()
    
    def extract_dialogue(self, script_text: str) -> List[str]:
        """Extract dialogue from script text"""
        # Split by common dialogue patterns
        lines = re.split(r'\n+', script_text)
        dialogue = []
        
        for line in lines:
            line = line.strip()
            # Skip empty lines and common script elements
            if line and not line.startswith(('SCENE', 'INT.', 'EXT.', 'FADE')):
                # Check if line looks like dialogue (starts with uppercase character or quote)
                if line[0].isupper() or line.startswith('"'):
                    dialogue.append(line)
        
        return dialogue
    
    def clean_text(self, text: str) -> str:
        """Clean and normalize text"""
        # Convert to lowercase
        text = text.lower()
        # Remove special characters but keep apostrophes
        text = re.sub(r'[^a-z\s\']', '', text)
        # Normalize whitespace
        text = re.sub(r'\s+', ' ', text)
        
        return text.strip()


