"""
The coupling that makes a definition mean anything: the gloss on
`lemmas.definition` is generated FROM one specific sentence, so every read
path that shows a sentence beside that gloss must resolve to the SAME row.

Two independent orderings pick that row today:

  * definition_worker's backlog query and /srs/feed, in SQL —
    `is_representative DESC, score DESC NULLS LAST, sentence_id ASC`
  * _sentence_link_sort_key, in Python, for the two /enrichment endpoints

Nothing in the type system, the schema, or any other test connects them. If
they drift, the card shows a definition of one sense above a sentence
demonstrating another — and it fails silently, because both values are
individually valid and no error is raised. These tests are the connection.

Verified against prod on 2026-08-30: across all 34,849 lemmas with a global
sentence the two orderings picked an identical row 34,849 times. The point is
to keep that true, not to fix something visibly broken.
"""
from __future__ import annotations

from types import SimpleNamespace

from src.routes.enrichment import _sentence_link_sort_key
from src.workers.definition_worker import build_backlog_sql


def _link(sentence_id, *, representative=False, score=0.0, source="llm", movie_id=None):
    return SimpleNamespace(
        sentenceId=sentence_id,
        isRepresentative=representative,
        score=score,
        sentence=SimpleNamespace(
            id=sentence_id, sentence=f"sentence {sentence_id}", source=source,
            movieId=movie_id,
        ),
    )


def _reader_pick(links):
    """What the enrichment endpoints would show."""
    return sorted(links, key=_sentence_link_sort_key)[0].sentenceId


# ─── the two orderings agree on the global set ──────────────────────────────

def test_reader_prefers_the_representative_link():
    """The worker anchors the definition to the representative link, so the
    reader has to show that one. Before this term existed the reader ranked
    purely on score and would have shown sentence 2."""
    links = [
        _link(2, representative=False, score=0.9),
        _link(1, representative=True, score=0.4),
    ]
    assert _reader_pick(links) == 1


def test_reader_falls_back_to_score_when_no_link_is_representative():
    links = [_link(1, score=0.2), _link(2, score=0.8)]
    assert _reader_pick(links) == 2


def test_reader_breaks_score_ties_on_the_lowest_sentence_id():
    """Matches the SQL's `sentence_id ASC`. Without an explicit tie-break the
    two sides would agree only by accident of row order — which is not a
    property any database guarantees."""
    links = [_link(7, score=0.5), _link(3, score=0.5), _link(5, score=0.5)]
    assert _reader_pick(links) == 3


def test_the_new_terms_sit_below_source_and_movie_tie():
    """A representative global row must NOT outrank this movie's own LLM
    sentence — those two terms encode a stronger preference and the agreement
    only has to hold within the global set the definition is drawn from."""
    links = [
        _link(1, representative=True, score=0.9),                 # global llm
        _link(2, representative=False, score=0.1, movie_id=42),   # this movie
    ]
    assert _reader_pick(links) == 2
    # ...and a subtitle row still loses to both, representative or not.
    links = [_link(1, source="llm"), _link(2, representative=True, source="subtitle")]
    assert _reader_pick(links) == 1


# ─── the SQL side states the same key ───────────────────────────────────────

def test_the_worker_sql_orders_by_the_same_three_terms():
    """Asserted as text because there is no database here. Crude, but it is
    what catches someone 'simplifying' the ORDER BY without realising the
    Python sort key on the other side of the app depends on it."""
    sql = build_backlog_sql(limit=10)
    ordering = sql[sql.index("ORDER BY sll.is_representative") :]
    assert "sll.is_representative DESC" in ordering
    assert "sll.score DESC NULLS LAST" in ordering
    assert "sll.sentence_id ASC" in ordering
    # Order of the three terms matters as much as their presence.
    assert ordering.index("is_representative") < ordering.index("score")
    assert ordering.index("score") < ordering.index("sentence_id")
