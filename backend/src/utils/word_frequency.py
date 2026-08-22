"""Zipf frequency → the integer `frequency_rank` stored on words and lemmas.

`frequency_rank` is what the SRS "learn new words" deck, the quiz pool and the
movie vocabulary list all sort by when they show common words before rare ones.
The Zipf-to-rank conversion was written out twice — once inside the CEFR
classifier, once inline in `/movies/{id}/vocabulary/full` — so a batch job that
wanted to precompute ranks had no shared definition to precompute *against*,
and a change to one copy would have silently disagreed with the values already
in the table. One formula, one place (issue #137).

wordfreq is imported lazily: it pulls ~85ms of module import plus data loading
on first use, and processes that never rank a word (the worker containers)
should not pay it at startup.
"""
from __future__ import annotations

from typing import Optional, Tuple

#: Rank assigned to a word wordfreq has never seen. Not None — "we looked and
#: it is vanishingly rare" is a real answer, and a NULL would instead sort to
#: the end of every `ASC NULLS LAST` ordering as if it were unknown.
UNKNOWN_WORD_RANK = 100_000

_wordfreq = None
_import_attempted = False


def wordfreq_available() -> bool:
    """True if the wordfreq package can be imported in this process."""
    return _load() is not None


def _load():
    global _wordfreq, _import_attempted
    if not _import_attempted:
        _import_attempted = True
        try:
            import wordfreq  # noqa: PLC0415  (deliberately lazy, see module docstring)

            _wordfreq = wordfreq
        except Exception:
            _wordfreq = None
    return _wordfreq


def rank_from_zipf(zipf: Optional[float]) -> Optional[int]:
    """Convert a Zipf score to the stored rank. Zipf 7 ≈ rank 1, 6 ≈ 10, 5 ≈ 100.

    Higher rank = rarer word, which is why every caller sorts ascending.
    """
    if zipf is None:
        return None
    return int(10 ** (7 - zipf)) if zipf > 0 else UNKNOWN_WORD_RANK


def frequency_data(word: str, lang: str = "en") -> Tuple[Optional[int], Optional[float]]:
    """`(rank, zipf)` for a word, or `(None, None)` if wordfreq can't answer."""
    wf = _load()
    if wf is None:
        return None, None
    try:
        zipf = wf.zipf_frequency(word, lang)
    except Exception:
        return None, None
    return rank_from_zipf(zipf), zipf


def frequency_rank(word: str, lang: str = "en") -> Optional[int]:
    """Just the rank. See `frequency_data`."""
    return frequency_data(word, lang)[0]
