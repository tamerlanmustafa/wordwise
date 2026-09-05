"""
Writing a generated sentence: both rows, or neither.

A `sentence_bank` row and its `sentence_lemma_links` row are worthless apart.
Every study surface reaches a sentence through its lemma link, so a sentence
with no link is an **orphan** — LLM output that has been paid for and can never
be shown to anyone. Nothing looks broken on screen, which is exactly why it
went unnoticed: the only symptom is the `orphan_sentences` metric on
/admin/health/vocab-coverage turning red, and that metric fails on any
*increase*, not on any particular number.

The two rows used to be written as independent statements, which made orphans
two ways:

  1. the process died between them — a Railway deploy restarts the worker, and
     main was pushed six times on 2026-09-05 alone;
  2. the link insert caught `Exception` and did nothing with it. That handler
     was written for the duplicate-key case, where a no-op is genuinely
     correct, but it swallowed connection resets and constraint failures too.

And they do not self-heal. The lemma stays in the backlog because it still has
no link, so it is retried — but the retry asks the model for a *new* sentence,
which hashes differently and becomes a *new* row. The old one is stranded for
good, and the retry costs money.
"""
from __future__ import annotations

import logging

import pytest
from prisma.errors import UniqueViolationError

from src.services.llm_sentence_service import LLMSentenceService


class _Table:
    """One Prisma model accessor, with scripted failures."""

    def __init__(self, rows=None, fail_with=None, rows_after_fail=None):
        self.rows = list(rows or [])
        self.fail_with = fail_with
        # What a re-read sees once `create` has failed — i.e. the row the
        # transaction that beat us committed. Empty at first, so the ordering
        # the race actually has is the ordering under test.
        self.rows_after_fail = rows_after_fail
        self.created: list[dict] = []

    async def find_first(self, where=None):
        return self.rows[0] if self.rows else None

    async def create(self, data=None):
        if self.fail_with is not None:
            if self.rows_after_fail is not None:
                self.rows = list(self.rows_after_fail)
            raise self.fail_with
        self.created.append(data)
        return _Row(len(self.created))


class _Row:
    def __init__(self, id_):
        self.id = id_


class _Tx:
    """Prisma's interactive transaction: commits on clean exit, rolls back on
    an exception. The rollback is the whole point — it is what turns "two
    statements that might half-succeed" into "both rows or neither"."""

    def __init__(self, db):
        self.db = db

    async def __aenter__(self):
        self.db.tx_opened += 1
        return self.db

    async def __aexit__(self, exc_type, *_):
        if exc_type is not None:
            # Anything written inside is discarded.
            self.db.sentencebank.created.clear()
            self.db.sentencelemmalink.created.clear()
            self.db.rolled_back += 1
        else:
            self.db.committed += 1
        return False


class _Db:
    def __init__(self, *, existing_sentence=False, sentence_fail=None, link_fail=None,
                 winner_row=None):
        self.sentencebank = _Table(
            rows=[_Row(42)] if existing_sentence else [],
            fail_with=sentence_fail,
            rows_after_fail=[_Row(winner_row)] if winner_row else None,
        )
        self.sentencelemmalink = _Table(fail_with=link_fail)
        self.tx_opened = 0
        self.committed = 0
        self.rolled_back = 0

    def tx(self, **_kwargs):
        return _Tx(self)


def _service() -> LLMSentenceService:
    # __init__ builds an Anthropic client; the persist path never touches it.
    return LLMSentenceService.__new__(LLMSentenceService)


async def _persist(db, word="alpha"):
    return await _service()._persist_global_sentence(
        db,
        sentence="A sentence with alpha.",
        lemma_id=7,
        word_position=4,
        matched_form="alpha",
        word=word,
    )


class TestBothRowsOrNeither:
    async def test_a_new_sentence_and_its_link_go_in_one_transaction(self):
        db = _Db()

        assert await _persist(db) is True
        assert db.tx_opened == 1 and db.committed == 1
        assert len(db.sentencebank.created) == 1
        assert len(db.sentencelemmalink.created) == 1

    async def test_a_failed_link_takes_the_sentence_down_with_it(self):
        # The orphan case. Before the transaction, this left the sentence row
        # behind with nothing pointing at it — for ever.
        db = _Db(link_fail=RuntimeError("connection reset"))

        assert await _persist(db) is False
        assert db.rolled_back == 1
        assert db.sentencebank.created == []

    async def test_an_existing_sentence_needs_no_transaction(self):
        # One statement is already atomic. Opening a transaction to wrap a
        # single insert holds a connection for no reason, and the sentence
        # worker does this fifteen times a batch.
        db = _Db(existing_sentence=True)

        assert await _persist(db) is True
        assert db.tx_opened == 0
        assert len(db.sentencelemmalink.created) == 1


class TestTheNarrowedExcept:
    async def test_a_duplicate_link_is_success_not_failure(self):
        # (sentence_id, lemma_id) is unique. Hitting it means the row we wanted
        # is already there — written by an earlier cycle or a concurrent
        # worker. This is the one error that is really the desired end state,
        # and the only one the old `except Exception: pass` was written for.
        db = _Db(existing_sentence=True, link_fail=UniqueViolationError(
            {"error": "Unique constraint failed", "user_facing_error": {}}
        ))

        assert await _persist(db) is True

    async def test_any_other_link_error_is_a_failure_and_is_logged(self, caplog):
        db = _Db(existing_sentence=True, link_fail=RuntimeError("connection reset"))

        with caplog.at_level(logging.WARNING):
            assert await _persist(db, word="beta") is False

        # The point of narrowing the except: this used to be silent, and
        # silence is why nobody knew orphans were accumulating.
        assert any("beta" in r.getMessage() for r in caplog.records)

    async def test_a_foreign_key_failure_is_not_swallowed(self):
        # A lemma_id that no longer exists — deleted between the backlog read
        # and the write. Under the old handler this vanished and the caller was
        # told the word was stored.
        db = _Db(existing_sentence=True, link_fail=RuntimeError("FK violation"))

        assert await _persist(db) is False


class TestLosingTheInsertRace:
    async def test_the_winner_s_sentence_is_linked_instead(self):
        """Two workers generating the same sentence at the same moment.

        The transaction that lost rolls back — so there is no orphan to clean
        up — and the retry has to happen out here. It cannot happen inside the
        transaction: a failed statement aborts the whole thing in Postgres, so
        catching the error and carrying on in there would fail on the next
        statement anyway.
        """
        db = _Db(
            sentence_fail=UniqueViolationError(
                {"error": "Unique constraint failed", "user_facing_error": {}}
            ),
            # Invisible when we looked, committed by the time we retry.
            winner_row=99,
        )

        assert await _persist(db) is True
        assert db.rolled_back == 1
        assert db.sentencelemmalink.created[0]["sentenceId"] == 99

    async def test_a_race_with_no_winner_gives_up_rather_than_guessing(self, caplog):
        # Should not happen — a unique violation means somebody committed — but
        # inventing a sentence id here would link a lemma to the wrong text.
        db = _Db(sentence_fail=UniqueViolationError(
            {"error": "Unique constraint failed", "user_facing_error": {}}
        ))

        with caplog.at_level(logging.WARNING):
            assert await _persist(db) is False
        assert db.sentencelemmalink.created == []


class TestTheCallerIsToldWhichWordsFailed:
    """`persist_failures` is what keeps a write failure from being recorded as
    the model refusing the word — see tests/test_sentence_worker.py."""

    async def test_a_failed_write_is_reported_separately_from_a_refusal(self, monkeypatch):
        from src.services.llm_sentence_service import WordRequest

        svc = _service()

        async def _sentences(db, words, context="unknown"):
            return {"alpha": "A sentence with alpha."}

        monkeypatch.setattr(svc, "generate_sentences", _sentences)
        db = _Db(link_fail=RuntimeError("connection reset"))

        failures: set = set()
        results = await svc.generate_and_store(
            db,
            words=[WordRequest(word="alpha", lemma="alpha", cefr="B1")],
            lemma_id_map={"alpha": 7},
            persist_failures=failures,
        )

        assert results == {}          # not stored
        assert failures == {"alpha"}  # but not the word's fault either

    async def test_the_out_parameter_is_optional(self, monkeypatch):
        # routes/enrichment.py calls this without one and must keep working.
        from src.services.llm_sentence_service import WordRequest

        svc = _service()

        async def _sentences(db, words, context="unknown"):
            return {"alpha": "A sentence with alpha."}

        monkeypatch.setattr(svc, "generate_sentences", _sentences)

        results = await svc.generate_and_store(
            _Db(),
            words=[WordRequest(word="alpha", lemma="alpha", cefr="B1")],
            lemma_id_map={"alpha": 7},
        )

        assert "alpha" in results


class TestTheTriggerOwnedFlag:
    async def test_is_global_is_never_written_from_application_code(self):
        # A trigger derives it from the sentence row (#120). Writing it here
        # would create a second source of truth for the flag every study
        # surface filters on, and the drift would be silent.
        db = _Db()
        await _persist(db)

        assert "isGlobal" not in db.sentencelemmalink.created[0]
