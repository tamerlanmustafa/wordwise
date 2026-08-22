"""
Lemma purity guard: decides whether a token/lemma is real English vocabulary
worth storing and showing to learners.

This is the upstream version of the detection logic in
backend/hide_garbage_lemmas.py (which patched garbage out at read time via
hidden_words). The guard runs at classification/insert time so gibberish,
typos, OCR artifacts, foreign words, and proper nouns never enter
word_classifications or the V2 lemmas registry in the first place.

Rejection categories (GuardDecision.reason):
  - "empty"              blank lemma
  - "malformed"          charset violations: digits, punctuation, pipes,
                         underscores, non-ASCII (also catches accented
                         foreign words), leading/trailing hyphen/apostrophe
  - "too_short"          single characters
  - "no_vowel"           consonant-only strings (kch, ktns)
  - "repeated_chars"     3+ identical consecutive letters (aaaargh)
  - "unknown_english"    zero frequency in English corpora and not in the
                         dictionary (typos like "deallng", names, gibberish)
  - "foreign_<lang>"     dramatically more frequent in another language
                         (Spanish/French/German/Portuguese/Italian/Russian)
  - "not_in_dict_low_freq"  nonzero but negligible English frequency and
                         not in any dictionary
  - "profanity"          strong profanity or a slur (src/services/
                         profanity_filter.py) — real English, but not
                         vocabulary we teach
  - "internationalism"   a word learners of any background already recognise
                         (src/services/internationalism_filter.py): units,
                         global brands, international sports/foods (issue #89)

A wordlist hit (CEFR wordlists, curated slang/kids vocab, MWE dicts — passed
in by the caller) always wins: it rescues legitimate entries that fail the
orthographic checks ("hmm", "tv", "ok") and skips the frequency gate. The two
exceptions are profanity and internationalisms, both checked BEFORE the
wordlist because the CEFR wordlists list many of them (swear words like
"bitch"; units and loanwords like "kilometer"/"pizza" at A1/A2) and would
otherwise rescue exactly what we mean to drop.

Dependency policy: wordfreq and the NLTK words corpus are both optional
(CI installs neither wordfreq nor the corpus). With neither available the
dictionary gate FAILS OPEN — only well-formedness is enforced — so a
missing dep can never wipe a movie's vocabulary.

Operating point (issue #96): PRECISION OVER RECALL. Teaching a learner a
junk word costs more than silently omitting a real one — a bad card is
visible and erodes trust, an absent word is not observable at all. So when
the two errors trade off, this guard prefers to drop. Measured on a
40-movie sample re-parsed through lemmatize_script's own token filter, the
cost of that choice is 1,257 rejected lemma types = 3,197 of 329,018 tokens
(0.97%), and a random sample of them is dominated by proper nouns
("robotnik", "neeson", "saigon"), g-dropping ("livin", "eatin", "sittin"),
subtitle typos ("foward", "everthing", "leav"), and inflected forms spaCy
failed to reduce ("uglier", "drooling", "freshest") — which would enter as
duplicate registry rows, not as new vocabulary. Genuine teachable losses
are a minority of that already-small set.

Deliberately NOT done, each killed by a measurement rather than taste:
  - lowering MIN_FREQ_NOT_IN_DICT: typos of common words outrank rare real
    words on frequency, so no threshold separates them ("thi" is 8x more
    frequent than "miniaturization").
  - a proper-noun filter on lemmas.pos: subtitles are title-cased and
    ALL-CAPS, so spaCy over-predicts PROPN. Prod tags "staircase",
    "blacksmith", "prevention", "repellent" and "superheroes" PROPN across
    8,145 visible rows — the filter would delete real vocabulary at scale.
  - swapping the NLTK corpus for /usr/share/dict/words: same web2 list
    (234,456 vs 234,377 entries), same gaps, same junk.
The curated wordlists are the lever that actually works, which is why both
callers now pass them.

Out of scope here and handled upstream by src/services/lemma_normalizer.py
(#158): both lemmatizers over-strip some words, so "boss" would otherwise
reach this guard as "bos", "pass" as "pas" and "cookies" as "cooky". Every
stripped form is a real dictionary entry, so the guard correctly keeps them —
the defect is in lemmatization, not in this decision, and the correction is
applied before the token gets here. (The mechanism is mostly NLTK's WordNet
lemmatizer rather than spaCy, which #158 originally attributed it to.)
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Callable, Optional

from .internationalism_filter import is_internationalism
from .profanity_filter import is_profane

logger = logging.getLogger(__name__)

# Lowercase ASCII letters with internal apostrophe/hyphen only
# (o'clock, well-known). Rejects digits, underscores, pipes, dots,
# leading/trailing separators, and all non-ASCII.
WELLFORMED_RE = re.compile(r"^[a-z]+(?:['-][a-z]+)*$")
VOWELS = set("aeiouy")

# Same tuning as hide_garbage_lemmas.py: a token this much more frequent in
# another language than in English is a foreign-language leak.
FOREIGN_LANGS = ("es", "fr", "de", "pt", "it", "ru")
FOREIGN_DOMINANCE = 5.0
# Not-in-dictionary words need at least this English frequency to survive
# (catches modern words the dictionary predates: "covid", "selfie",
# "hoodie"). 2e-6 is Zipf ~3.3: measured against prod data, modern legit
# vocabulary sits above it (selfie 3.75, binge 3.60, hoodie 3.40) while
# subtitle/OCR typos sit below (thi 3.16, alway 2.59, busines 2.13).
MIN_FREQ_NOT_IN_DICT = 2e-6

_wordfreq_checked = False
_word_frequency: Optional[Callable[[str, str], float]] = None
_dictionary_checked = False
_dictionary: Optional[set] = None


def _get_word_frequency() -> Optional[Callable[[str, str], float]]:
    global _wordfreq_checked, _word_frequency
    if not _wordfreq_checked:
        _wordfreq_checked = True
        try:
            from wordfreq import word_frequency

            _word_frequency = word_frequency
        except Exception:
            logger.warning("wordfreq unavailable - lemma guard frequency gate disabled")
    return _word_frequency


def _get_dictionary() -> Optional[set]:
    global _dictionary_checked, _dictionary
    if not _dictionary_checked:
        _dictionary_checked = True
        try:
            import nltk

            nltk.download("words", quiet=True)
            from nltk.corpus import words as nltk_words

            _dictionary = {w.lower() for w in nltk_words.words()}
            logger.info(f"Lemma guard dictionary loaded ({len(_dictionary)} words)")
        except Exception as e:
            logger.warning(f"NLTK words corpus unavailable ({e}) - dictionary gate disabled")
    return _dictionary


@dataclass(frozen=True)
class GuardDecision:
    keep: bool
    reason: str = ""


_KEEP = GuardDecision(True)


def is_wellformed(lemma: str) -> GuardDecision:
    """Orthographic sanity only - no dictionary/frequency lookups."""
    if not lemma:
        return GuardDecision(False, "empty")
    if len(lemma) < 2:
        return GuardDecision(False, "too_short")
    if not WELLFORMED_RE.match(lemma):
        return GuardDecision(False, "malformed")
    if not any(c in VOWELS for c in lemma):
        return GuardDecision(False, "no_vowel")
    if re.search(r"(.)\1\1", lemma):
        return GuardDecision(False, "repeated_chars")
    return _KEEP


@lru_cache(maxsize=50000)
def _dictionary_gate(lemma: str) -> GuardDecision:
    """Frequency + dictionary check for a wellformed, unlisted lemma."""
    word_frequency = _get_word_frequency()
    dictionary = _get_dictionary()

    in_dict = dictionary is not None and lemma in dictionary

    if word_frequency is None:
        # Fail open on frequency; dictionary alone can still veto nothing
        # (absence from a 234k list is too weak a signal by itself).
        return _KEEP

    en_freq = word_frequency(lemma, "en")
    if en_freq == 0 and not in_dict:
        return GuardDecision(False, "unknown_english")

    if en_freq > 0:
        max_other, top_lang = 0.0, "en"
        for lang in FOREIGN_LANGS:
            f = word_frequency(lemma, lang)
            if f > max_other:
                max_other, top_lang = f, lang
        if max_other > en_freq * FOREIGN_DOMINANCE and not in_dict:
            return GuardDecision(False, f"foreign_{top_lang}")

    if in_dict:
        return _KEEP
    if en_freq >= MIN_FREQ_NOT_IN_DICT:
        return _KEEP
    return GuardDecision(False, "not_in_dict_low_freq")


def evaluate_lemma(
    lemma: str,
    word: Optional[str] = None,
    is_wordlist_known: Optional[Callable[[str], bool]] = None,
) -> GuardDecision:
    """
    Full purity decision for one lemma (optionally with its surface form).

    Args:
        lemma: normalized lemma (lowercase).
        word: original surface token, if different (both are given a chance
              at the wordlist, since curated lists key on either form).
        is_wordlist_known: callable returning True when a form appears in a
              curated wordlist (CEFR lists, slang/kids vocab, MWE dicts).
              A hit short-circuits every other check.
    """
    lem = (lemma or "").strip().lower()

    # Profanity is checked first: it must outrank the wordlist short-circuit,
    # since our curated lists contain swear words that would otherwise pass.
    if is_profane(lem) or (word and is_profane(word)):
        return GuardDecision(False, "profanity")

    # Internationalisms too must outrank the wordlist: the CEFR lists rate
    # many of them A1/A2 ("kilometer", "pizza", "football"), so a wordlist
    # hit would otherwise rescue exactly what issue #89 asks us to drop.
    if is_internationalism(lem) or (word and is_internationalism(word)):
        return GuardDecision(False, "internationalism")

    if is_wordlist_known is not None:
        if lem and is_wordlist_known(lem):
            return _KEEP
        if word and is_wordlist_known(word.strip().lower()):
            return _KEEP

    # Multi-word expressions reach us only from curated phrasal-verb/idiom
    # dicts; just sanity-check each part's charset.
    if " " in lem:
        parts = lem.split()
        if parts and all(WELLFORMED_RE.match(p) for p in parts):
            return _KEEP
        return GuardDecision(False, "malformed")

    wf = is_wellformed(lem)
    if not wf.keep:
        return wf

    return _dictionary_gate(lem)


def display_form(word: str, lemma: Optional[str]) -> str:
    """
    The form vocab surfaces should render: the lemma when it is a clean
    single token ("stakeholders" row shows "stakeholder"), otherwise the
    stored surface word. Read-time only - fixes rows inserted before the
    upstream guard existed.
    """
    lem = (lemma or "").strip().lower()
    if lem and " " not in lem and WELLFORMED_RE.match(lem):
        return lem
    return word
