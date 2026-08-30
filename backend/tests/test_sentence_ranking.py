"""
Unit tests for the SentenceBank read-path ranking (`_sentence_link_sort_key`).

Regression guard for the "expanding a word row swaps the AI sentence for the
raw in-movie one" bug. Both /sentences/{word} and /sentences/batch sort the
candidate SentenceLemmaLink rows with this key, so the collapsed preview and
the expanded sentence must resolve to the *same* row. The key must:
  1. prefer an LLM-authored sentence over a subtitle extraction, even when the
     subtitle row is the one tied to this movie and the LLM row is global;
  2. prefer a movie-tied row over a global row *within the same source*;
  3. break remaining ties by higher score.

These build fake links with SimpleNamespace — no DB, no network.
"""
from types import SimpleNamespace

from src.routes.enrichment import _sentence_link_sort_key


def _link(source: str, movie_id, score: float, *, representative=False, sentence_id=1):
    # `isRepresentative` / `sentenceId` joined the sort key when
    # lemmas.definition landed, so that the two enrichment endpoints resolve to
    # the exact row the definition was generated from. These cases predate that
    # and exercise the source/movie terms; the new terms have their own file,
    # test_definition_sense_anchor.py.
    return SimpleNamespace(
        score=score,
        isRepresentative=representative,
        sentenceId=sentence_id,
        sentence=SimpleNamespace(source=source, movieId=movie_id),
    )


def _best(links):
    """The winner is the row that sorts first under the read-path key."""
    return sorted(links, key=_sentence_link_sort_key)[0]


def test_llm_global_beats_subtitle_movie_tied():
    # The exact bug: the collapsed preview shows the global LLM sentence, so
    # the expansion must pick it too — not the subtitle row tied to the movie.
    llm_global = _link("llm", None, 0.5)
    subtitle_movie = _link("subtitle", 42, 0.99)
    assert _best([subtitle_movie, llm_global]) is llm_global


def test_movie_tied_beats_global_within_same_source():
    # A per-movie LLM row (legacy) is more specific than a shared global one.
    llm_movie = _link("llm", 42, 0.5)
    llm_global = _link("llm", None, 0.9)
    assert _best([llm_global, llm_movie]) is llm_movie


def test_higher_score_breaks_ties():
    # Same source and both global → the higher-scored example wins.
    low = _link("llm", None, 0.3)
    high = _link("llm", None, 0.8)
    assert _best([low, high]) is high


def test_source_priority_orders_all_sources():
    # llm < tatoeba < public_domain < subtitle (lower = preferred).
    llm = _link("llm", None, 0.1)
    tatoeba = _link("tatoeba", None, 0.9)
    public_domain = _link("public_domain", None, 0.9)
    subtitle = _link("subtitle", None, 0.9)
    ordered = sorted([subtitle, public_domain, tatoeba, llm], key=_sentence_link_sort_key)
    assert [l.sentence.source for l in ordered] == [
        "llm",
        "tatoeba",
        "public_domain",
        "subtitle",
    ]


def test_unknown_source_sorts_last():
    # A row with an unrecognized source must never outrank a known one.
    known = _link("subtitle", None, 0.1)
    unknown = _link("mystery", None, 0.99)
    assert _best([unknown, known]) is known
