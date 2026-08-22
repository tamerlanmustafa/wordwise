"""
`lemmas.frequency_rank` gets filled offline instead of being NULL forever (#137).

Three orderings sort the words a learner is shown by this column — the SRS
new-words deck, the per-movie SRS pool, and the quiz pool — all as
`ORDER BY l.frequency_rank ASC NULLS LAST`. Measured on prod 2026-08-21, 61.3%
of the 23,034 lemmas the new-words deck can draw from had no rank, so most of
the registry landed in one undifferentiated tail and "teach common words first"
did nothing for it.

What is protected here:

1. One Zipf-to-rank formula, shared by the classifier that writes ranks during
   ingestion, the request-time fill in `/vocabulary/full`, and this backfill.
   Three copies of the arithmetic would have meant three different numbers for
   the same word depending on which code path stored it.
2. A word wordfreq has never seen is ranked, not skipped — leaving it NULL puts
   it straight back in the tail the backfill exists to empty.
3. The UPDATE is idempotent and narrow: it re-ranks only NULL rows and writes
   no other column, so re-running it cannot undo the #91/#119 CEFR re-grades.

wordfreq is a real dependency here (it ships in requirements.txt), but the
tests that must not depend on its data use an injected score.
"""
from __future__ import annotations

import backfill_lemma_frequency_rank as backfill
from src.utils import word_frequency
from src.utils.word_frequency import (
    UNKNOWN_WORD_RANK,
    rank_from_zipf,
)


class TestRankFromZipf:
    def test_the_documented_anchors(self):
        # Zipf 7 ≈ rank 1, 6 ≈ 10, 5 ≈ 100 — the scale the stored values assume.
        assert rank_from_zipf(7.0) == 1
        assert rank_from_zipf(6.0) == 10
        assert rank_from_zipf(5.0) == 100

    def test_rarer_words_rank_higher(self):
        assert rank_from_zipf(3.0) > rank_from_zipf(5.0)

    def test_a_word_wordfreq_has_never_seen_gets_a_real_rank(self):
        # Zipf 0 means "absent from the corpus". That is an answer, not a gap:
        # a NULL would sort to the end of ASC NULLS LAST as if it were unknown.
        assert rank_from_zipf(0.0) == UNKNOWN_WORD_RANK

    def test_no_score_stays_no_rank(self):
        assert rank_from_zipf(None) is None


class TestSharedFormula:
    def test_classifier_and_backfill_agree_on_the_same_word(self):
        from src.services.cefr_classifier import HybridCEFRClassifier

        # Both go through utils.word_frequency; the point is that they cannot
        # drift apart, so compare the values rather than the call sites.
        classifier_rank = HybridCEFRClassifier._get_frequency_data(
            _StubClassifier(), "house", "en"
        )[0]
        assert classifier_rank == word_frequency.frequency_rank("house")
        assert classifier_rank is not None

    def test_vocabulary_full_uses_the_same_helper(self):
        import inspect

        from src.routes import movies

        src = inspect.getsource(movies.get_vocabulary_full)
        assert "from ..utils.word_frequency import frequency_rank" in src
        # The old inline copy of the arithmetic must be gone, not shadowed.
        assert "10 ** (7 - zipf)" not in src


class _StubClassifier:
    """Enough of CEFRClassifier to call the frequency lookup in isolation."""

    has_wordfreq = True


class TestRankRows:
    def test_every_pending_lemma_gets_a_row(self, monkeypatch):
        monkeypatch.setattr(backfill, "frequency_rank", lambda w: 42)

        out = backfill._rank_rows(
            [{"id": 1, "lemma": "house"}, {"id": 2, "lemma": "quixotic"}]
        )

        assert out == [{"id": 1, "rank": 42}, {"id": 2, "rank": 42}]

    def test_lemmas_are_looked_up_lowercased(self, monkeypatch):
        seen: list[str] = []
        monkeypatch.setattr(
            backfill, "frequency_rank", lambda w: seen.append(w) or 1
        )

        backfill._rank_rows([{"id": 1, "lemma": "  House  "}])

        assert seen == ["house"]

    def test_a_blank_lemma_is_skipped(self, monkeypatch):
        monkeypatch.setattr(backfill, "frequency_rank", lambda w: 1)

        assert backfill._rank_rows([{"id": 1, "lemma": "   "}]) == []
        assert backfill._rank_rows([{"id": 2, "lemma": None}]) == []

    def test_an_unscoreable_lemma_is_left_for_a_later_run(self, monkeypatch):
        monkeypatch.setattr(backfill, "frequency_rank", lambda w: None)

        assert backfill._rank_rows([{"id": 1, "lemma": "house"}]) == []


class TestUpdateStatement:
    def test_it_only_touches_rows_that_have_no_rank(self):
        # Re-running must not re-rank a lemma someone (or a later, better
        # source) already ranked.
        assert "l.frequency_rank IS NULL" in backfill.UPDATE_SQL

    def test_it_writes_no_column_but_the_rank(self):
        # #91 and #119 re-graded cefr_level from the registry; a backfill that
        # touched anything else here could quietly undo that work.
        set_clause = backfill.UPDATE_SQL.split("SET", 1)[1].split("FROM", 1)[0]
        assert set_clause.strip() == "frequency_rank = r.rank"

    def test_the_pending_query_reads_only_unranked_rows(self):
        assert "frequency_rank IS NULL" in backfill.PENDING_SQL

    def test_it_is_one_statement_per_chunk_not_per_row(self):
        assert backfill.CHUNK >= 500
        assert "JSONB_TO_RECORDSET" in backfill.UPDATE_SQL
