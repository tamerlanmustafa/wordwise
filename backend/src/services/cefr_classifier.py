"""
Hybrid CEFR Difficulty Classifier - MAXIMUM SPEED OPTIMIZATION

NO spaCy - uses NLTK WordNetLemmatizer for maximum speed
LRU caching to prevent memory leaks
Aggressive pre-cleaning before tokenization
"""

import logging
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
from enum import Enum
import json
from pathlib import Path
import re
from functools import lru_cache
from nltk.stem import WordNetLemmatizer
from nltk.corpus import wordnet
import nltk

logger = logging.getLogger(__name__)

# Download NLTK data if needed
try:
    nltk.data.find('corpora/wordnet')
except LookupError:
    nltk.download('wordnet', quiet=True)

try:
    nltk.data.find('corpora/omw-1.4')
except LookupError:
    nltk.download('omw-1.4', quiet=True)

# LRU CACHE SIZES - prevent unbounded memory growth
LEMMA_CACHE_SIZE = 50000
CEFR_CACHE_SIZE = 50000
FREQUENCY_CACHE_SIZE = 50000


class LRUCache:
    """Simple LRU cache with max size for mutable values like WordClassification."""

    def __init__(self, maxsize: int = 10000):
        from collections import OrderedDict
        self._cache: 'OrderedDict[str, any]' = OrderedDict()
        self._maxsize = maxsize

    def get(self, key: str) -> Optional[any]:
        if key in self._cache:
            # Move to end (most recently used)
            self._cache.move_to_end(key)
            return self._cache[key]
        return None

    def set(self, key: str, value: any) -> None:
        if key in self._cache:
            self._cache.move_to_end(key)
        self._cache[key] = value
        # Evict oldest if over capacity
        while len(self._cache) > self._maxsize:
            self._cache.popitem(last=False)

    def __contains__(self, key: str) -> bool:
        return key in self._cache

    def __len__(self) -> int:
        return len(self._cache)


# GLOBAL LRU CACHES (bounded memory)
_GLOBAL_LEMMA_CACHE: LRUCache = LRUCache(maxsize=LEMMA_CACHE_SIZE)
_GLOBAL_CEFR_CACHE: LRUCache = LRUCache(maxsize=CEFR_CACHE_SIZE)
_GLOBAL_FREQUENCY_CACHE: LRUCache = LRUCache(maxsize=FREQUENCY_CACHE_SIZE)

# Common phrasal verbs with CEFR levels
# Format: { 'phrasal_verb': 'CEFR_level' }
# Phrasal verbs often have idiomatic meanings that differ from their components
PHRASAL_VERBS = {
    # A2 level - Basic phrasal verbs
    'get up': 'A2', 'wake up': 'A2', 'sit down': 'A2', 'stand up': 'A2',
    'look at': 'A2', 'look for': 'A2', 'turn on': 'A2', 'turn off': 'A2',
    'put on': 'A2', 'take off': 'A2', 'come in': 'A2', 'go out': 'A2',
    'pick up': 'A2', 'put down': 'A2', 'come back': 'A2', 'go back': 'A2',

    # B1 level - Intermediate phrasal verbs
    'give up': 'B1', 'look after': 'B1', 'look out': 'B1', 'find out': 'B1',
    'grow up': 'B1', 'set up': 'B1', 'take care': 'B1', 'make up': 'B1',
    'bring up': 'B1', 'carry on': 'B1', 'come on': 'B1', 'go on': 'B1',
    'hold on': 'B1', 'hang up': 'B1', 'keep on': 'B1', 'fill in': 'B1',
    'look up': 'B1', 'run out': 'B1', 'sort out': 'B1', 'work out': 'B1',
    'check in': 'B1', 'check out': 'B1', 'log in': 'B1', 'log out': 'B1',
    'sign up': 'B1', 'sign in': 'B1', 'break down': 'B1', 'break up': 'B1',

    # B2 level - Upper-intermediate phrasal verbs
    'come up with': 'B2', 'look forward to': 'B2', 'put up with': 'B2',
    'get along with': 'B2', 'run into': 'B2', 'figure out': 'B2',
    'turn out': 'B2', 'point out': 'B2', 'turn up': 'B2', 'show up': 'B2',
    'take over': 'B2', 'take up': 'B2', 'take on': 'B2', 'bring about': 'B2',
    'carry out': 'B2', 'cut down': 'B2', 'cut off': 'B2', 'deal with': 'B2',
    'end up': 'B2', 'get away': 'B2', 'get over': 'B2', 'get through': 'B2',
    'go through': 'B2', 'hand in': 'B2', 'hang out': 'B2', 'let down': 'B2',
    'look into': 'B2', 'make out': 'B2', 'pass away': 'B2', 'pull off': 'B2',
    'put off': 'B2', 'set off': 'B2', 'settle down': 'B2', 'show off': 'B2',
    'slow down': 'B2', 'speed up': 'B2', 'stick to': 'B2', 'throw away': 'B2',
    'try on': 'B2', 'turn down': 'B2', 'wear out': 'B2', 'wind up': 'B2',

    # C1 level - Advanced phrasal verbs
    'back out': 'C1', 'bail out': 'C1', 'black out': 'C1', 'blow up': 'C1',
    'break into': 'C1', 'brush up': 'C1', 'call off': 'C1', 'catch on': 'C1',
    'cave in': 'C1', 'come across': 'C1', 'come down to': 'C1', 'crack down': 'C1',
    'do away with': 'C1', 'draw up': 'C1', 'fall through': 'C1', 'get by': 'C1',
    'give in': 'C1', 'go about': 'C1', 'hold up': 'C1', 'iron out': 'C1',
    'kick off': 'C1', 'knock out': 'C1', 'lay off': 'C1', 'live up to': 'C1',
    'phase out': 'C1', 'play down': 'C1', 'pull through': 'C1', 'rule out': 'C1',
    'scale back': 'C1', 'send off': 'C1', 'step down': 'C1', 'sum up': 'C1',
    'take apart': 'C1', 'touch on': 'C1', 'track down': 'C1', 'wipe out': 'C1',
    'write off': 'C1', 'zero in': 'C1',

    # C2 level - Highly idiomatic phrasal verbs
    'bank on': 'C2', 'bear out': 'C2', 'boil down to': 'C2', 'breeze through': 'C2',
    'brush off': 'C2', 'buy into': 'C2', 'clam up': 'C2', 'clamp down': 'C2',
    'dawn on': 'C2', 'dish out': 'C2', 'dole out': 'C2', 'egg on': 'C2',
    'eke out': 'C2', 'fend off': 'C2', 'ferret out': 'C2', 'fizzle out': 'C2',
    'fork out': 'C2', 'gun for': 'C2', 'hash out': 'C2', 'home in': 'C2',
    'lash out': 'C2', 'latch onto': 'C2', 'level with': 'C2', 'mull over': 'C2',
    'pan out': 'C2', 'phase in': 'C2', 'pine for': 'C2', 'play up': 'C2',
    'pore over': 'C2', 'rack up': 'C2', 'ramp up': 'C2', 'rein in': 'C2',
    'root out': 'C2', 'rustle up': 'C2', 'screw up': 'C2', 'seize up': 'C2',
    'shell out': 'C2', 'shore up': 'C2', 'shrug off': 'C2', 'size up': 'C2',
    'siphon off': 'C2', 'stake out': 'C2', 'stave off': 'C2', 'tee off': 'C2',
    'tuck away': 'C2', 'usher in': 'C2', 'ward off': 'C2', 'whittle down': 'C2',
}

# Common idioms with CEFR levels
# These are fixed expressions whose meaning cannot be derived from components
COMMON_IDIOMS = {
    # B1 level idioms
    'piece of cake': 'B1', 'break a leg': 'B1', 'under the weather': 'B1',
    'once in a while': 'B1', 'on the other hand': 'B1', 'at the end of the day': 'B1',
    'as soon as possible': 'B1', 'in the long run': 'B1', 'make sense': 'B1',
    'by the way': 'B1', 'in fact': 'B1', 'after all': 'B1',

    # B2 level idioms
    'hit the nail on the head': 'B2', 'spill the beans': 'B2', 'let the cat out of the bag': 'B2',
    'beat around the bush': 'B2', 'bite off more than you can chew': 'B2',
    'a blessing in disguise': 'B2', 'burn the midnight oil': 'B2', 'cost an arm and a leg': 'B2',
    'get out of hand': 'B2', 'go the extra mile': 'B2', 'in hot water': 'B2',
    'kill two birds with one stone': 'B2', 'miss the boat': 'B2', 'on the ball': 'B2',
    'pull someones leg': 'B2', 'take it with a grain of salt': 'B2', 'under pressure': 'B2',
    'when pigs fly': 'B2', 'the ball is in your court': 'B2', 'back to square one': 'B2',

    # C1 level idioms
    'add fuel to the fire': 'C1', 'at the drop of a hat': 'C1', 'a chip on your shoulder': 'C1',
    'barking up the wrong tree': 'C1', 'between a rock and a hard place': 'C1',
    'bite the bullet': 'C1', 'break the ice': 'C1', 'cut to the chase': 'C1',
    'devil advocate': 'C1', 'every cloud has a silver lining': 'C1',
    'fit as a fiddle': 'C1', 'get your act together': 'C1', 'go down in flames': 'C1',
    'have a ball': 'C1', 'hit the ground running': 'C1', 'in the same boat': 'C1',
    'jump on the bandwagon': 'C1', 'keep your chin up': 'C1', 'leave no stone unturned': 'C1',
    'make a long story short': 'C1', 'no pain no gain': 'C1', 'on thin ice': 'C1',
    'once in a blue moon': 'C1', 'play it by ear': 'C1', 'put your foot in your mouth': 'C1',
    'rain cats and dogs': 'C1', 'see eye to eye': 'C1', 'the last straw': 'C1',
    'throw in the towel': 'C1', 'up in the air': 'C1', 'wrap your head around': 'C1',

    # C2 level idioms (highly idiomatic, culture-specific)
    'a penny for your thoughts': 'C2', 'ace up your sleeve': 'C2',
    'all bark and no bite': 'C2', 'beat a dead horse': 'C2', 'behind the eight ball': 'C2',
    'blow off steam': 'C2', 'burn bridges': 'C2', 'by the skin of your teeth': 'C2',
    'cry over spilt milk': 'C2', 'cut corners': 'C2', 'dead ringer': 'C2',
    'down to the wire': 'C2', 'draw a blank': 'C2', 'drop the ball': 'C2',
    'face the music': 'C2', 'get cold feet': 'C2', 'give the cold shoulder': 'C2',
    'go bananas': 'C2', 'hand over fist': 'C2', 'have an axe to grind': 'C2',
    'hit below the belt': 'C2', 'in a pickle': 'C2', 'jump the gun': 'C2',
    'keep tabs on': 'C2', 'kick the bucket': 'C2', 'let sleeping dogs lie': 'C2',
    'make ends meet': 'C2', 'off the hook': 'C2', 'on cloud nine': 'C2',
    'out of the blue': 'C2', 'pull strings': 'C2', 'ring a bell': 'C2',
    'sit on the fence': 'C2', 'spick and span': 'C2', 'steal someones thunder': 'C2',
    'take the bull by the horns': 'C2', 'through thick and thin': 'C2',
    'under the table': 'C2', 'up the creek': 'C2', 'wet behind the ears': 'C2',
}


# Kids vocabulary whitelist - playful, fantasy, onomatopoeia words that are conceptually simple
# Despite low corpus frequency, these are A2-level for kids
KIDS_SIMPLE_VOCAB = {
    # Creatures & fantasy
    'ogre', 'goblin', 'troll', 'fairy', 'pixie', 'dragon', 'unicorn', 'elf', 'dwarf',
    'monster', 'beast', 'creature', 'wizard', 'witch', 'ghost', 'vampire', 'zombie',
    # Noises / onomatopoeia
    'roar', 'bang', 'boom', 'pow', 'zap', 'swoosh', 'splat', 'growl', 'hiss', 'buzz',
    'crash', 'smash', 'snap', 'pop', 'whoosh', 'thud', 'thump', 'clang', 'ding',
    'meow', 'woof', 'bark', 'chirp', 'tweet', 'quack', 'moo', 'oink', 'neigh',
    # Playful verbs
    'giggle', 'tickle', 'wiggle', 'sneak', 'peek', 'boo', 'hop', 'skip', 'bounce',
    'chase', 'hide', 'seek', 'grab', 'toss', 'catch', 'splash', 'dash', 'zoom',
    # Magic / fantasy items
    'spell', 'potion', 'wand', 'curse', 'magic', 'enchanted', 'charm', 'jinx',
    # Common fantasy places/things kids know
    'castle', 'kingdom', 'throne', 'crown', 'sword', 'shield', 'armor', 'dungeon',
    'tower', 'palace', 'prince', 'princess', 'knight', 'hero', 'villain',
    # Adventure/action words
    'adventure', 'quest', 'treasure', 'battle', 'rescue', 'escape', 'brave',
    # Emotions/reactions (playful)
    'yay', 'hooray', 'yippee', 'uh-oh', 'oops', 'wow', 'ouch', 'eww', 'yuck',
    # Common adjectives in kids movies
    'silly', 'funny', 'scary', 'spooky', 'creepy', 'weird', 'crazy', 'wild',
    'awesome', 'cool', 'neat', 'super', 'mega', 'giant', 'tiny', 'huge',
    # Animals common in kids movies
    'bunny', 'kitty', 'puppy', 'pony', 'tiger', 'lion', 'bear', 'wolf',
    'elephant', 'giraffe', 'monkey', 'zebra', 'penguin', 'dolphin',
    # Nature/weather
    'rainbow', 'snowflake', 'thunder', 'lightning', 'storm', 'sunshine',
    # Toys/play
    'toy', 'doll', 'teddy', 'robot', 'rocket', 'spaceship',
    # Food (playful)
    'yummy', 'cookie', 'candy', 'cake', 'ice cream', 'pizza', 'chocolate',
    # Action verbs
    'fly', 'jump', 'run', 'swim', 'climb', 'slide', 'swing', 'ride',
    # Fantasy concepts
    'dream', 'wish', 'believe', 'imagine', 'pretend', 'wonder'
}


class CEFRLevel(str, Enum):
    A1 = "A1"
    A2 = "A2"
    B1 = "B1"
    B2 = "B2"
    C1 = "C1"
    C2 = "C2"
    UNKNOWN = "UNKNOWN"


class ClassificationSource(str, Enum):
    OXFORD_3000 = "oxford_3000"
    OXFORD_5000 = "oxford_5000"
    EFLLEX = "efllex"
    EVP = "evp"
    FREQUENCY_BACKOFF = "frequency_backoff"
    EMBEDDING_CLASSIFIER = "embedding_classifier"
    FALLBACK = "fallback"


@dataclass
class WordClassification:
    word: str
    lemma: str
    pos: str
    cefr_level: CEFRLevel
    confidence: float
    source: ClassificationSource
    frequency_rank: Optional[int] = None
    zipf_score: Optional[float] = None  # Zipf frequency (0-7 scale, higher = more common)
    is_multi_word: bool = False
    alternatives: Optional[List[Tuple[CEFRLevel, float]]] = None


def detect_phrasal_verbs_and_idioms(text: str) -> List[Tuple[str, str, str]]:
    """
    Detect phrasal verbs and idioms in text.

    Args:
        text: The input text to analyze

    Returns:
        List of tuples: (expression, type, cefr_level)
        where type is 'phrasal_verb' or 'idiom'
    """
    text_lower = text.lower()
    detected = []

    # Check for phrasal verbs (sorted by length to match longer ones first)
    for pv, level in sorted(PHRASAL_VERBS.items(), key=lambda x: -len(x[0])):
        if pv in text_lower:
            detected.append((pv, 'phrasal_verb', level))

    # Check for idioms (sorted by length to match longer ones first)
    for idiom, level in sorted(COMMON_IDIOMS.items(), key=lambda x: -len(x[0])):
        if idiom in text_lower:
            detected.append((idiom, 'idiom', level))

    return detected


def count_phrasal_verbs_and_idioms(text: str) -> Dict[str, int]:
    """
    Count phrasal verbs and idioms by CEFR level.

    Args:
        text: The input text to analyze

    Returns:
        Dictionary with counts by level: {'A2': 5, 'B1': 3, 'B2': 2, ...}
    """
    detected = detect_phrasal_verbs_and_idioms(text)
    counts = {'A1': 0, 'A2': 0, 'B1': 0, 'B2': 0, 'C1': 0, 'C2': 0}

    for _, _, level in detected:
        counts[level] = counts.get(level, 0) + 1

    return counts


def is_valid_token(token: str) -> bool:
    if not token or len(token) < 2:
        return False
    if not any(c.isalpha() for c in token):
        return False
    if token.isdigit():
        return False
    punct_count = sum(1 for c in token if c in ".,!?;:-–—()[]{}\"'")
    if punct_count > len(token) // 2:
        return False
    if any(ord(c) > 127 for c in token):
        if not all(ord(c) < 256 or c in "''""" for c in token):
            return False
    return True


def is_proper_noun_or_fantasy_word(word: str) -> bool:
    """
    Detect proper nouns and fantasy/constructed words.
    Returns True if word should be classified as A2 (beginner-friendly).

    Rules:
    1. Proper nouns (capitalized words like "Harry", "Zootopia")
    2. Fantasy/constructed words with hyphens or apostrophes
    3. Words with unusual patterns (mixed case, repeated characters)
    """
    if not word or len(word) < 2:
        return False

    # Rule 1: Proper noun detection (capitalized)
    if word[0].isupper():
        return True

    # Rule 2: Fantasy/constructed words with special characters
    if '-' in word or "'" in word:
        return True

    # Rule 3: Words with unusual repeated patterns (e.g., "oooo", "aaaa")
    if len(word) >= 4:
        for i in range(len(word) - 3):
            if word[i] == word[i+1] == word[i+2] == word[i+3]:
                return True

    return False


class HybridCEFRClassifier:
    def __init__(
        self,
        data_dir: Path,
        use_embedding_classifier: bool = False,
        spacy_model: str = "en_core_web_sm"
    ):
        self.data_dir = Path(data_dir)
        self.use_embedding_classifier = use_embedding_classifier

        logger.info("Initializing NLTK lemmatizer (no spaCy)")
        self.lemmatizer = WordNetLemmatizer()

        self.cefr_wordlist: Dict[str, Tuple[CEFRLevel, ClassificationSource]] = {}
        self.multi_word_expressions: Dict[str, Tuple[CEFRLevel, ClassificationSource]] = {}
        self.frequency_thresholds = {
            CEFRLevel.A1: (0, 1000),
            CEFRLevel.A2: (1000, 2000),
            CEFRLevel.B1: (2000, 5000),
            CEFRLevel.B2: (5000, 10000),
            CEFRLevel.C1: (10000, 20000),
            CEFRLevel.C2: (20000, float('inf'))
        }

        self._load_cefr_wordlists()
        self._load_frequency_data()

        if self.use_embedding_classifier:
            logger.warning("Embedding classifier enabled - will slow down classification!")
            self._load_embedding_classifier()

    def _load_cefr_wordlists(self):
        logger.info("Loading CEFR wordlists...")
        oxford_path = self.data_dir / "oxford_3000_5000.json"
        if oxford_path.exists():
            self._load_oxford_wordlist(oxford_path)
        efllex_path = self.data_dir / "efllex.json"
        if efllex_path.exists():
            self._load_efllex_wordlist(efllex_path)
        evp_path = self.data_dir / "evp.json"
        if evp_path.exists():
            self._load_evp_wordlist(evp_path)
        logger.info(f"Loaded {len(self.cefr_wordlist)} CEFR entries, {len(self.multi_word_expressions)} MWEs")

    def _load_oxford_wordlist(self, path: Path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            for entry in data:
                word = entry.get('word', '').lower().strip()
                level = entry.get('cefr_level', '').upper()
                if not word or not level:
                    continue
                try:
                    cefr_level = CEFRLevel(level)
                except ValueError:
                    continue
                lemma = self._get_lemma_simple(word)
                if lemma not in self.cefr_wordlist:
                    self.cefr_wordlist[lemma] = (cefr_level, ClassificationSource.OXFORD_3000)
                if ' ' in word:
                    self.multi_word_expressions[word] = (cefr_level, ClassificationSource.OXFORD_3000)
        except Exception as e:
            logger.error(f"Error loading Oxford wordlist: {e}")

    def _load_efllex_wordlist(self, path: Path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            for entry in data:
                word = entry.get('word', '').lower().strip()
                level = entry.get('cefr', '').upper()
                if not word or not level:
                    continue
                try:
                    cefr_level = CEFRLevel(level)
                except ValueError:
                    continue
                lemma = self._get_lemma_simple(word)
                if lemma not in self.cefr_wordlist:
                    self.cefr_wordlist[lemma] = (cefr_level, ClassificationSource.EFLLEX)
        except Exception as e:
            logger.error(f"Error loading EFLLex wordlist: {e}")

    def _load_evp_wordlist(self, path: Path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            for entry in data:
                word = entry.get('word', '').lower().strip()
                level = entry.get('level', '').upper()
                if not word or not level:
                    continue
                try:
                    cefr_level = CEFRLevel(level)
                except ValueError:
                    continue
                lemma = self._get_lemma_simple(word)
                if lemma not in self.cefr_wordlist:
                    self.cefr_wordlist[lemma] = (cefr_level, ClassificationSource.EVP)
        except Exception as e:
            logger.error(f"Error loading EVP wordlist: {e}")

    def _load_frequency_data(self):
        try:
            import wordfreq
            self.has_wordfreq = True
            logger.info("wordfreq library available")
        except ImportError:
            logger.warning("wordfreq library not available")
            self.has_wordfreq = False

    def _load_embedding_classifier(self):
        logger.warning("Loading embedding classifier...")
        try:
            from sentence_transformers import SentenceTransformer
            import joblib
            model_path = self.data_dir / "sentence_transformer"
            if model_path.exists():
                self.sentence_model = SentenceTransformer(str(model_path))
            else:
                self.sentence_model = SentenceTransformer('all-MiniLM-L6-v2')
                self.sentence_model.save(str(model_path))
            classifier_path = self.data_dir / "cefr_classifier.joblib"
            if classifier_path.exists():
                self.embedding_classifier = joblib.load(classifier_path)
                logger.info("Loaded pre-trained embedding classifier")
            else:
                logger.warning("No pre-trained classifier found")
                self.embedding_classifier = None
            self.has_embedding_classifier = True
        except ImportError as e:
            logger.warning(f"Embedding classifier dependencies not available: {e}")
            self.has_embedding_classifier = False

    @staticmethod
    def normalize_text(text: str) -> str:
        text = text.lower()
        text = text.replace("'", "'").replace("'", "'")
        text = text.replace(""", '"').replace(""", '"')
        text = re.sub(r'[—–−]', ' ', text)
        text = re.sub(r"[^\w\s']", ' ', text)
        text = re.sub(r'\s+', ' ', text).strip()
        return text

    @staticmethod
    def aggressive_preclean(text: str) -> str:
        text = text.lower()
        text = text.replace("'", "'").replace("'", "'")
        text = text.replace(""", '"').replace(""", '"')
        text = re.sub(r'[^\w\s]', ' ', text)
        text = re.sub(r'\d+', '', text)
        text = re.sub(r'\s+', ' ', text).strip()
        return text

    def _get_lemma_simple(self, word: str) -> str:
        return self.lemmatizer.lemmatize(word.lower())

    def _get_lemma_fast(self, word: str) -> str:
        global _GLOBAL_LEMMA_CACHE
        cached = _GLOBAL_LEMMA_CACHE.get(word)
        if cached is not None:
            return cached
        lemma = self.lemmatizer.lemmatize(word)
        _GLOBAL_LEMMA_CACHE.set(word, lemma)
        return lemma

    def _get_frequency_data(self, word: str, lang: str = 'en') -> Tuple[Optional[int], Optional[float]]:
        """
        Get frequency rank and raw Zipf score for a word.

        Returns:
            Tuple of (frequency_rank, zipf_score)
            - frequency_rank: Estimated rank (1 = most common, higher = rarer)
            - zipf_score: Raw Zipf frequency (0-7 scale, higher = more common)
        """
        global _GLOBAL_FREQUENCY_CACHE
        if not self.has_wordfreq:
            return None, None

        cache_key = f"freq:{word}"
        cached = _GLOBAL_FREQUENCY_CACHE.get(cache_key)
        if cached is not None:
            return cached

        try:
            import wordfreq
            zipf = wordfreq.zipf_frequency(word, lang)

            # Convert Zipf to approximate rank
            # Zipf 7 ≈ rank 1, Zipf 6 ≈ rank 10, Zipf 5 ≈ rank 100, etc.
            if zipf > 0:
                rank = int(10 ** (7 - zipf))
            else:
                rank = 100000  # Very rare / not found

            result = (rank, zipf)
            _GLOBAL_FREQUENCY_CACHE.set(cache_key, result)
            return result
        except Exception:
            _GLOBAL_FREQUENCY_CACHE.set(cache_key, (None, None))
            return None, None

    def _get_frequency_rank(self, word: str, lang: str = 'en') -> Optional[int]:
        """Legacy method for backward compatibility."""
        rank, _ = self._get_frequency_data(word, lang)
        return rank

    def _get_zipf_score(self, word: str, lang: str = 'en') -> Optional[float]:
        """Get raw Zipf frequency score (0-7 scale, higher = more common)."""
        _, zipf = self._get_frequency_data(word, lang)
        return zipf

    def _classify_by_frequency(self, word: str, lemma: str) -> Optional[WordClassification]:
        """
        Frequency-based classification using Zipf score and frequency rank.

        Zipf scale interpretation:
        - 7.0+: Ultra-common words (the, be, to) → A1
        - 6.0-7.0: Very common words → A1
        - 5.0-6.0: Common words → A2
        - 4.0-5.0: Intermediate words → B1
        - 3.0-4.0: Less common words → B2
        - 2.0-3.0: Uncommon words → C1
        - 0.0-2.0: Rare words → C2
        """
        rank, zipf = self._get_frequency_data(lemma)
        if rank is None or zipf is None:
            return None

        # Use Zipf score for more accurate CEFR mapping
        # Zipf scale: 0-7, where higher = more common
        if zipf >= 6.0:
            level = CEFRLevel.A1
            confidence = 0.8
        elif zipf >= 5.0:
            level = CEFRLevel.A2
            confidence = 0.75
        elif zipf >= 4.0:
            level = CEFRLevel.B1
            confidence = 0.65
        elif zipf >= 3.0:
            level = CEFRLevel.B2
            confidence = 0.55
        elif zipf >= 2.0:
            level = CEFRLevel.C1
            confidence = 0.45
        else:
            # Very rare words (Zipf < 2.0) → C2
            level = CEFRLevel.C2
            confidence = 0.35

        return WordClassification(
            word=word,
            lemma=lemma,
            pos="",
            cefr_level=level,
            confidence=confidence,
            source=ClassificationSource.FREQUENCY_BACKOFF,
            frequency_rank=rank,
            zipf_score=zipf
        )

    def _classify_by_embedding(self, word: str, lemma: str) -> Optional[WordClassification]:
        if not self.has_embedding_classifier or self.embedding_classifier is None:
            return None
        try:
            embedding = self.sentence_model.encode([lemma])[0]
            prediction = self.embedding_classifier.predict([embedding])[0]
            if hasattr(self.embedding_classifier, 'predict_proba'):
                probabilities = self.embedding_classifier.predict_proba([embedding])[0]
                confidence = float(max(probabilities))
            else:
                confidence = 0.4
            return WordClassification(
                word=word,
                lemma=lemma,
                pos="",
                cefr_level=CEFRLevel(prediction),
                confidence=confidence * 0.8,
                source=ClassificationSource.EMBEDDING_CLASSIFIER
            )
        except Exception:
            return None

    def classify_word(self, word: str, pos: Optional[str] = None, is_kids_genre: bool = False) -> WordClassification:
        """
        Classify a word with optional genre context.

        Args:
            word: The word to classify
            pos: Part of speech (optional)
            is_kids_genre: True if movie is kids/family/animation/fantasy
        """
        global _GLOBAL_CEFR_CACHE
        word_lower = word.lower().strip()

        # Cache key includes genre flag to avoid cross-contamination
        cache_key = f"{word_lower}:{'kids' if is_kids_genre else 'adult'}"
        cached = _GLOBAL_CEFR_CACHE.get(cache_key)
        if cached is not None:
            return cached

        # KIDS WHITELIST: Force A2 for playful/fantasy/onomatopoeia words
        if word_lower in KIDS_SIMPLE_VOCAB:
            result = WordClassification(
                word=word,
                lemma=word_lower,
                pos="",
                cefr_level=CEFRLevel.A2,
                confidence=0.95,
                source=ClassificationSource.FALLBACK
            )
            _GLOBAL_CEFR_CACHE.set(cache_key, result)
            return result

        # PROPER NOUNS & FANTASY WORDS: Detect before classification
        if is_proper_noun_or_fantasy_word(word):
            result = WordClassification(
                word=word,
                lemma=word_lower,
                pos="",
                cefr_level=CEFRLevel.A2,
                confidence=0.9,
                source=ClassificationSource.FALLBACK
            )
            _GLOBAL_CEFR_CACHE.set(cache_key, result)
            return result

        lemma = self._get_lemma_fast(word_lower)

        if ' ' in word_lower and word_lower in self.multi_word_expressions:
            level, source = self.multi_word_expressions[word_lower]
            result = WordClassification(
                word=word,
                lemma=word_lower,
                pos="",
                cefr_level=level,
                confidence=1.0,
                source=source,
                is_multi_word=True
            )
            _GLOBAL_CEFR_CACHE.set(word_lower, result)
            return result

        # Dictionary lookup (only source allowed to assign C1/C2)
        if lemma in self.cefr_wordlist:
            level, source = self.cefr_wordlist[lemma]
            result = WordClassification(
                word=word,
                lemma=lemma,
                pos="",
                cefr_level=level,
                confidence=1.0,
                source=source
            )
            _GLOBAL_CEFR_CACHE.set(cache_key, result)
            return result

        # Frequency-based (capped at B2)
        freq_result = self._classify_by_frequency(word_lower, lemma)
        if freq_result and freq_result.confidence >= 0.5:
            # For kids genres: downgrade B2+ non-dictionary words to A2
            # IMPORTANT: Create new object to avoid mutating cached results
            if is_kids_genre and freq_result.cefr_level in [CEFRLevel.B2]:
                freq_result = WordClassification(
                    word=freq_result.word,
                    lemma=freq_result.lemma,
                    pos=freq_result.pos,
                    cefr_level=CEFRLevel.A2,
                    confidence=0.6,
                    source=freq_result.source,
                    is_multi_word=freq_result.is_multi_word
                )
            _GLOBAL_CEFR_CACHE.set(cache_key, freq_result)
            return freq_result

        # Embedding classifier (if enabled)
        if self.use_embedding_classifier:
            emb_result = self._classify_by_embedding(word_lower, lemma)
            if emb_result:
                # For kids genres: downgrade high levels from embeddings
                # IMPORTANT: Create new object to avoid mutating cached results
                if is_kids_genre and emb_result.cefr_level in [CEFRLevel.B2, CEFRLevel.C1, CEFRLevel.C2]:
                    emb_result = WordClassification(
                        word=emb_result.word,
                        lemma=emb_result.lemma,
                        pos=emb_result.pos,
                        cefr_level=CEFRLevel.A2,
                        confidence=emb_result.confidence * 0.7,
                        source=emb_result.source,
                        is_multi_word=emb_result.is_multi_word
                    )
                _GLOBAL_CEFR_CACHE.set(cache_key, emb_result)
                return emb_result

        # Low-confidence frequency result
        if freq_result:
            # IMPORTANT: Create new object to avoid mutating cached results
            if is_kids_genre and freq_result.cefr_level in [CEFRLevel.B2]:
                freq_result = WordClassification(
                    word=freq_result.word,
                    lemma=freq_result.lemma,
                    pos=freq_result.pos,
                    cefr_level=CEFRLevel.A2,
                    confidence=0.4,
                    source=freq_result.source,
                    is_multi_word=freq_result.is_multi_word
                )
            _GLOBAL_CEFR_CACHE.set(cache_key, freq_result)
            return freq_result

        # Final fallback: Unknown words → A2
        result = WordClassification(
            word=word,
            lemma=lemma,
            pos="",
            cefr_level=CEFRLevel.A2,
            confidence=0.2,
            source=ClassificationSource.FALLBACK
        )
        _GLOBAL_CEFR_CACHE.set(cache_key, result)
        return result

    def classify_text(self, text: str, genres: Optional[List[str]] = None) -> List[WordClassification]:
        """
        Classify all words in text with optional genre context.

        Args:
            text: The text to classify
            genres: List of movie genres (e.g., ['Animation', 'Family', 'Adventure'])
        """
        import time
        start_time = time.time()

        # Determine if this is kids/family content
        is_kids_genre = False
        if genres:
            genres_lower = [g.lower() for g in genres]
            is_kids_genre = any(g in genres_lower for g in ['family', 'animation', 'kids', 'fantasy', 'children'])

        # CRITICAL FIX: Preserve original words BEFORE cleaning for proper noun detection
        # Split on whitespace and punctuation but keep the original capitalization
        import re
        original_words = re.findall(r'\b[a-zA-Z]+(?:[-\'][a-zA-Z]+)*\b', text)

        # Map lowercase → original form (for proper noun detection)
        original_case_map: Dict[str, str] = {}
        for word in original_words:
            lower = word.lower()
            if lower not in original_case_map:
                original_case_map[lower] = word

        # Now do the aggressive cleaning for tokenization
        cleaned_text = self.aggressive_preclean(text)
        words = cleaned_text.split()
        valid_words = [w for w in words if is_valid_token(w)]
        unique_words = list(set(valid_words))

        if logger.isEnabledFor(logging.DEBUG):
            logger.debug(f"Filtered {len(words)} tokens → {len(valid_words)} valid → {len(unique_words)} unique")
            if is_kids_genre:
                logger.debug(f"Kids/family genre detected - applying conservative classification")

        lemma_to_word: Dict[str, str] = {}
        for word in unique_words:
            lemma = self._get_lemma_fast(word)
            if lemma not in lemma_to_word:
                # Use original capitalized form if available
                lemma_to_word[lemma] = original_case_map.get(word, word)

        classifications = []
        for lemma, original_word in lemma_to_word.items():
            # Pass the ORIGINAL capitalized word with genre context
            classification = self.classify_word(original_word, is_kids_genre=is_kids_genre)
            classifications.append(classification)

        # CRITICAL FIX 3: Sanity check for impossible C2 spikes
        # If C2 > 1.5% AND C1 < 0.5%, this indicates misclassification
        # Solution: Downgrade 90% of C2 words to A2 (likely proper nouns/fantasy words)
        # NOTE: We create NEW objects instead of mutating - cache is NOT updated to avoid
        # corrupting classifications for other movies
        if classifications:
            total = len(classifications)
            c1_count = sum(1 for cls in classifications if cls.cefr_level == CEFRLevel.C1)
            c2_count = sum(1 for cls in classifications if cls.cefr_level == CEFRLevel.C2)

            c1_pct = c1_count / total if total > 0 else 0
            c2_pct = c2_count / total if total > 0 else 0

            # Detect impossible pattern: high C2, low C1
            if c2_pct > 0.015 and c1_pct < 0.005:
                logger.warning(f"⚠️ Impossible C2 spike detected: C2={c2_pct*100:.1f}%, C1={c1_pct*100:.1f}%")
                logger.warning(f"Downgrading 90% of C2 words to A2 (likely proper nouns/fantasy words)")

                # Find indices of C2 classifications
                c2_indices = [i for i, cls in enumerate(classifications) if cls.cefr_level == CEFRLevel.C2]

                # Downgrade 90% of them to A2 by creating NEW objects (don't mutate!)
                downgrade_count = int(len(c2_indices) * 0.9)
                for i in range(downgrade_count):
                    idx = c2_indices[i]
                    old_cls = classifications[idx]
                    # Create NEW object - NEVER mutate the original
                    new_cls = WordClassification(
                        word=old_cls.word,
                        lemma=old_cls.lemma,
                        pos=old_cls.pos,
                        cefr_level=CEFRLevel.A2,
                        confidence=0.3,
                        source=old_cls.source,
                        is_multi_word=old_cls.is_multi_word
                    )
                    classifications[idx] = new_cls
                    # NOTE: We do NOT update _GLOBAL_CEFR_CACHE here!
                    # The C2 spike fix is movie-specific (proper nouns/fantasy context)
                    # Other movies may have legitimate C2 words with the same lemma

                logger.info(f"✓ Downgraded {downgrade_count}/{len(c2_indices)} C2 words to A2")

        elapsed = time.time() - start_time
        logger.info(f"Classified {len(unique_words)} unique words → {len(classifications)} lemmas in {elapsed:.2f}s")

        return classifications

    def get_statistics(self, classifications: List[WordClassification]) -> Dict:
        if not classifications:
            return {}
        level_counts = {level: 0 for level in CEFRLevel}
        source_counts = {source: 0 for source in ClassificationSource}
        total_confidence = 0.0
        zipf_scores = []

        for cls in classifications:
            level_counts[cls.cefr_level] += 1
            source_counts[cls.source] += 1
            total_confidence += cls.confidence
            if cls.zipf_score is not None:
                zipf_scores.append(cls.zipf_score)

        # Calculate Zipf statistics
        zipf_stats = {}
        if zipf_scores:
            zipf_stats = {
                'mean': sum(zipf_scores) / len(zipf_scores),
                'min': min(zipf_scores),
                'max': max(zipf_scores),
                'count': len(zipf_scores)
            }
            # Add median
            sorted_zipf = sorted(zipf_scores)
            mid = len(sorted_zipf) // 2
            if len(sorted_zipf) % 2 == 0:
                zipf_stats['median'] = (sorted_zipf[mid - 1] + sorted_zipf[mid]) / 2
            else:
                zipf_stats['median'] = sorted_zipf[mid]

        return {
            'total_words': len(classifications),
            'level_distribution': {k.value: v for k, v in level_counts.items()},
            'source_distribution': {k.value: v for k, v in source_counts.items()},
            'average_confidence': total_confidence / len(classifications),
            'wordlist_coverage': sum(
                1 for cls in classifications
                if cls.source in [
                    ClassificationSource.OXFORD_3000,
                    ClassificationSource.OXFORD_5000,
                    ClassificationSource.EFLLEX,
                    ClassificationSource.EVP
                ]
            ) / len(classifications),
            'zipf_statistics': zipf_stats
        }

    def get_idiom_statistics(self, text: str) -> Dict:
        """
        Get statistics about phrasal verbs and idioms in the text.

        Args:
            text: The raw text to analyze

        Returns:
            Dictionary with idiom and phrasal verb statistics
        """
        if not text:
            return {}

        detected = detect_phrasal_verbs_and_idioms(text)

        # Count by type
        phrasal_verbs = [d for d in detected if d[1] == 'phrasal_verb']
        idioms = [d for d in detected if d[1] == 'idiom']

        # Count by CEFR level
        level_counts = count_phrasal_verbs_and_idioms(text)

        return {
            'total_phrasal_verbs': len(phrasal_verbs),
            'total_idioms': len(idioms),
            'phrasal_verb_list': [(pv, level) for pv, _, level in phrasal_verbs],
            'idiom_list': [(idiom, level) for idiom, _, level in idioms],
            'level_distribution': level_counts,
            'complexity_indicator': self._calculate_idiom_complexity(level_counts)
        }

    def _calculate_idiom_complexity(self, level_counts: Dict[str, int]) -> str:
        """
        Calculate an idiom complexity indicator based on CEFR distribution.

        Returns one of: 'low', 'medium', 'high', 'very_high'
        """
        total = sum(level_counts.values())
        if total == 0:
            return 'low'

        # Weight by CEFR level
        weighted = (
            level_counts.get('A2', 0) * 1 +
            level_counts.get('B1', 0) * 2 +
            level_counts.get('B2', 0) * 3 +
            level_counts.get('C1', 0) * 4 +
            level_counts.get('C2', 0) * 5
        )
        avg_complexity = weighted / total if total > 0 else 0

        if avg_complexity < 2:
            return 'low'
        elif avg_complexity < 3:
            return 'medium'
        elif avg_complexity < 4:
            return 'high'
        else:
            return 'very_high'

    def update_frequency_thresholds(self, thresholds: Dict[CEFRLevel, Tuple[int, int]]):
        self.frequency_thresholds.update(thresholds)
        logger.info(f"Updated frequency thresholds")
