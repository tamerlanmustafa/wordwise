"""
Undo lemmatizer over-stripping before a lemma is stored (issue #158).

WordWise runs two lemmatizers and both drop a letter off certain words:

    NLTK WordNet    boss -> bos      discuss -> discus    pass -> pas
                    species -> specie
    spaCy           cookies -> cooky  fiberglass -> fiberglas

The purity guard cannot catch any of it. `bos`, `discus`, `pas` and `specie`
are all real dictionary entries, so the guard is asked about a legitimate
English word and correctly says keep. The damage is that the word then exists
in the registry twice: a correct row with almost no data, and a junk row
carrying essentially all of the movie mappings and sentence links. Measured on
prod 2026-08-22, `pas` held 2,918 movies and 4,666 sentence links while the
real `pass` sat at 31 movies and an UNKNOWN CEFR level; `discus` was graded A1
and sat at position 1,725 of the 2,000-row A1 deck, so a beginner was taught
"discus" for a card that actually means "discuss".

Every correction here is ANCHORED ON THE SURFACE FORM, not on the lemma alone.
That is the whole design. A rule that only looks at the lemma has to guess
whether `pas` came from "pass" or from French "pas de deux", and it guesses
wrong for one of them. Reading the token the lemmatizer actually saw removes
the guess: "passed" starts with "pass", "Pas" does not, so the same rule fixes
the 4,532 English tokens and leaves the 36 French ones alone. Prod confirms
both classes exist under that one lemma, which is why this is not optional.

The frequency test is the second half of the safety. Surface anchoring alone
would rewrite "gasses" -> "gass", because "gasses" does start with "gass".
Requiring the restored form to be far more common in English than the stripped
one kills that: "gass" is not a word anybody writes.

Threshold: MIN_RESTORE_RATIO = 20x. Measured across all 42,621 prod lemmas,
this separates the two populations with room to spare. Every genuine
over-strip clears it (`fiberglas` 107x, `discus` 79x, `bos` 49x, `pas` 29x,
`mas` 22x) and the nearest real word below it is `ros`/`Ross` at 12x, followed
by `bas` 11x, `pus` 1.0x and `canvas` 0.07x. Words a learner would actually
meet — bus, gas, plus, focus, canvas, virus — are nowhere near the line.

Dependency policy, same as lemma_guard: wordfreq is optional (CI installs it
for neither the classifier nor this module). Without it every frequency-gated
rule DECLINES and the lemma is returned untouched. A missing dependency can
therefore only leave data as it is today, never rewrite it on a guess.
"""

from __future__ import annotations

import math
from functools import lru_cache
from typing import Optional

from src.utils.word_frequency import frequency_data

#: A restored form must be at least this many times more frequent in English
#: than the stripped lemma. See the module docstring for the measurement.
MIN_RESTORE_RATIO = 20.0

#: Zipf is log10, so a 20x ratio is a gap of log10(20) on that scale.
_MIN_ZIPF_GAP = math.log10(MIN_RESTORE_RATIO)

#: Nouns whose plural IS the dictionary headword. No frequency or spelling
#: rule can derive these — "species" is not "specie" pluralised, the two are
#: different words — so the handful that actually occur are listed. Applied
#: only when the surface form is the longer one (see `_restore_invariant`),
#: so a genuine use of the rare singular is left alone.
INVARIANT_PLURALS = {
    "specie": "species",
}


@lru_cache(maxsize=20000)
def _zipf(word: str) -> Optional[float]:
    """English Zipf score, or None when wordfreq is not installed."""
    return frequency_data(word, "en")[1]


def _much_more_frequent(candidate: str, current: str) -> bool:
    """True when `candidate` clears the ratio over `current`.

    Returns False whenever wordfreq cannot answer — a rewrite we cannot
    justify with evidence is a rewrite we do not make.
    """
    cand_zipf = _zipf(candidate)
    cur_zipf = _zipf(current)
    if cand_zipf is None or cur_zipf is None:
        return False
    if cand_zipf <= 0:
        return False
    return (cand_zipf - cur_zipf) >= _MIN_ZIPF_GAP


def _restore_doubled_s(word: str, lemma: str) -> Optional[str]:
    """`bos` -> `boss`, `discus` -> `discuss`, `pas` -> `pass`.

    Both lemmatizers treat the final `s` of an `-ss` word as a plural marker.
    The tell is a lemma ending in exactly one `s` whose doubled form is the
    stem of the token we were given.
    """
    if not lemma.endswith("s") or lemma.endswith("ss"):
        return None
    doubled = lemma + "s"
    if not word.startswith(doubled):
        return None
    if not _much_more_frequent(doubled, lemma):
        return None
    return doubled


def _restore_ie_plural(word: str, lemma: str) -> Optional[str]:
    """`cooky` -> `cookie`, from the archaic `-ies` -> `-y` fold.

    Only fires on a token that is actually the `-ies` plural, so the genuine
    variant spellings ("hippy", "goody") keep their own lemma — they also sit
    below the frequency threshold, so this rule declines them twice over.
    """
    if not word.endswith("ies") or not lemma.endswith("y") or len(lemma) < 4:
        return None
    modern = lemma[:-1] + "ie"
    if not _much_more_frequent(modern, lemma):
        return None
    return modern


def _restore_invariant(word: str, lemma: str) -> Optional[str]:
    """`specie` -> `species` when the token really was the plural headword."""
    correction = INVARIANT_PLURALS.get(lemma)
    if correction is None:
        return None
    if word == lemma or not word.startswith(lemma):
        return None
    return correction


def correct_lemma(word: str, lemma: str) -> str:
    """
    The lemma that should be stored for surface token `word`.

    Returns `lemma` unchanged unless one of the over-strip signatures matches
    with both the surface form and the frequency evidence agreeing. Safe to
    call on every token: the rules are cheap string tests and the frequency
    lookups behind them are memoized per process.
    """
    if not lemma or not word:
        return lemma
    surface = word.strip().lower()
    lem = lemma.strip().lower()
    if not surface or not lem or not lem.isalpha():
        return lemma

    for rule in (_restore_doubled_s, _restore_ie_plural, _restore_invariant):
        corrected = rule(surface, lem)
        if corrected is not None:
            return corrected
    return lem
