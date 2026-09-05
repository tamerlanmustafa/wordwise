"""
`persist_sentence_with_links` — the one place either pipeline may create a
`sentence_bank` row.

A sentence with no `sentence_lemma_links` row is an **orphan**: every study
surface reaches a sentence through its link, so an orphan is text that has been
extracted or paid for and that nobody can ever be shown. Nothing looks broken
on screen, which is why it went unnoticed for so long — the only trace was
`orphan_sentences` climbing on /admin/health/vocab-coverage, a metric that
FAILs on any *increase* rather than at any particular number.

Both pipelines made them, the same two ways: the process dying between the two
independent writes (a Railway deploy restarts the workers), and a link insert
whose `except Exception: pass` — written for the duplicate-key case, where a
no-op really is right — also swallowed connection resets and foreign-key
failures.

The subtitle path had a third, worse one: it wrote every sentence it had
extracted and *then* skipped the link for any word whose lemma was missing from
the registry, manufacturing orphans on every single ingestion by design. That
one is not fixed by a transaction; it is fixed by deciding what to link before
deciding what to write, which is why the ordering has its own tests below.
"""
from __future__ import annotations

import logging

import pytest
from prisma.errors import UniqueViolationError

from src.services import sentence_bank_service as sbs


class _Row:
    def __init__(self, id_, **kw):
        self.id = id_
        for k, v in kw.items():
            setattr(self, k, v)


class _Db:
    """Enough of Prisma to exercise the write path, with scripted failures.

    The transaction really rolls back — discarding whatever was written inside
    it — because that is the property under test, not an implementation detail
    to stub away.
    """

    def __init__(self, *, existing=None, sentence_fail=None, link_fail=None, winner=None):
        self.sentences: list[dict] = []
        self.links: list[dict] = []
        self._existing = existing
        self._sentence_fail = sentence_fail
        self._link_fail = link_fail
        self._winner = winner
        self.tx_opened = 0
        self.rolled_back = 0

        outer = self

        class _SentenceBank:
            async def find_first(self, where=None):
                return outer._existing

            async def create(self, data=None):
                if outer._sentence_fail is not None:
                    # The writer that beat us has committed by now.
                    outer._existing = outer._winner
                    raise outer._sentence_fail
                outer.sentences.append(data)
                return _Row(len(outer.sentences), **data)

        class _Link:
            async def create(self, data=None):
                if outer._link_fail is not None:
                    raise outer._link_fail
                outer.links.append(data)
                return _Row(len(outer.links))

        self.sentencebank = _SentenceBank()
        self.sentencelemmalink = _Link()

    def tx(self, **_kwargs):
        outer = self

        class _Tx:
            async def __aenter__(self):
                outer.tx_opened += 1
                self._marks = (len(outer.sentences), len(outer.links))
                return outer

            async def __aexit__(self, exc_type, *_):
                if exc_type is not None:
                    del outer.sentences[self._marks[0]:]
                    del outer.links[self._marks[1]:]
                    outer.rolled_back += 1
                return False

        return _Tx()


def _link(lemma_id=7):
    return {"lemmaId": lemma_id, "wordPosition": 2, "matchedForm": "x",
            "score": 1.0, "isRepresentative": False}


_DEFAULT = object()


async def _persist(db, links=_DEFAULT, **kw):
    # Sentinel rather than `links or [...]`: an empty list is a case under test,
    # and `or` would quietly replace it with the default.
    return await sbs.persist_sentence_with_links(
        db,
        sentence="A sentence with alpha.",
        links=[_link()] if links is _DEFAULT else links,
        **kw,
    )


def _unique_violation():
    return UniqueViolationError({"error": "Unique constraint failed", "user_facing_error": {}})


class TestBothRowsOrNeither:
    async def test_a_new_sentence_and_its_links_go_in_one_transaction(self):
        db = _Db()

        assert await _persist(db, links=[_link(7), _link(8)]) == 1
        assert db.tx_opened == 1
        assert len(db.sentences) == 1 and len(db.links) == 2

    async def test_a_failed_link_takes_the_sentence_down_with_it(self):
        # The orphan case. Before the transaction this left the sentence behind
        # with nothing pointing at it, for ever.
        db = _Db(link_fail=RuntimeError("connection reset"))

        assert await _persist(db) is None
        assert db.rolled_back == 1
        assert db.sentences == []

    async def test_an_existing_sentence_needs_no_transaction(self):
        # One insert is already atomic, and the sentence is already durable.
        # Wrapping a single statement would hold a connection for nothing, and
        # a film's ingestion does this thousands of times.
        db = _Db(existing=_Row(42))

        assert await _persist(db) == 42
        assert db.tx_opened == 0
        assert db.links[0]["sentenceId"] == 42


class TestTheNarrowedExcept:
    async def test_a_duplicate_link_is_success_not_failure(self):
        # (sentence_id, lemma_id) is unique. Hitting it means the row we wanted
        # already exists — the one failure that is really the desired end
        # state, and the only one the old blanket `except` was written for.
        db = _Db(existing=_Row(42), link_fail=_unique_violation())

        assert await _persist(db) == 42

    async def test_any_other_link_error_fails_and_is_logged(self, caplog):
        db = _Db(existing=_Row(42), link_fail=RuntimeError("connection reset"))

        with caplog.at_level(logging.WARNING):
            assert await _persist(db, movie_id=99) is None

        # Narrowing the except is only half the value; the other half is that
        # the failure is now sayable. Silence is why nobody knew.
        assert any("link failed" in r.getMessage() for r in caplog.records)

    async def test_one_bad_link_does_not_hide_behind_a_good_one(self):
        db = _Db(existing=_Row(42), link_fail=RuntimeError("FK violation"))

        assert await _persist(db, links=[_link(7), _link(8)]) is None


class TestLosingTheInsertRace:
    async def test_the_winner_s_row_is_linked_instead(self):
        db = _Db(sentence_fail=_unique_violation(), winner=_Row(99))

        assert await _persist(db) == 99
        assert db.rolled_back == 1
        assert db.links[0]["sentenceId"] == 99

    async def test_a_race_with_no_winner_gives_up_rather_than_guessing(self):
        db = _Db(sentence_fail=_unique_violation(), winner=None)

        assert await _persist(db) is None
        assert db.links == []


class TestAnUnlinkableSentenceIsNeverWritten:
    async def test_no_links_means_no_row(self):
        db = _Db()

        assert await _persist(db, links=[]) is None
        assert db.sentences == []


class TestScoping:
    async def test_the_llm_path_writes_a_global_row(self):
        db = _Db()
        await _persist(db, movie_id=None, source="llm")

        assert db.sentences[0]["movieId"] is None
        assert db.sentences[0]["source"] == "llm"

    async def test_the_subtitle_path_leaves_source_at_its_default(self):
        # `source` defaults to 'subtitle' in the schema. Passing it explicitly
        # from the subtitle path would be a second place to keep in step.
        db = _Db()
        await _persist(db, movie_id=42)

        assert db.sentences[0]["movieId"] == 42
        assert "source" not in db.sentences[0]

    async def test_is_global_is_never_written_from_application_code(self):
        # A trigger derives it from the sentence row (#120). Writing it here
        # would create a second source of truth for the flag every study
        # surface filters on, and the drift would be silent.
        db = _Db()
        await _persist(db)

        assert "isGlobal" not in db.links[0]


class TestTheSubtitlePathPlansBeforeItWrites:
    """The orphan-by-design case, which no transaction would have fixed."""

    async def test_a_word_with_no_lemma_leaves_no_sentence_behind(self):
        # The old shape wrote this sentence in loop one and then skipped its
        # link in loop two, because `lemma_id_map` had no entry for it.
        db = _Db()

        await sbs.populate_sentence_bank(
            db,
            movie_id=42,
            word_sentences={"unknownword": [("A sentence with unknownword.", 3)]},
            lemma_id_map={},                       # nothing to link to
            word_to_lemma={"unknownword": "unknownword"},
        )

        assert db.sentences == []
        assert db.links == []

    async def test_a_word_with_a_lemma_is_written_and_linked(self):
        db = _Db()

        result = await sbs.populate_sentence_bank(
            db,
            movie_id=42,
            word_sentences={"abort": [("The captain aborted it.", 2)]},
            lemma_id_map={"abort": 5},
            word_to_lemma={"abort": "abort"},
        )

        assert len(db.sentences) == 1
        assert db.links[0]["lemmaId"] == 5
        assert len(result) == 1

    async def test_two_words_in_one_sentence_share_a_row_and_get_a_link_each(self):
        db = _Db()

        await sbs.populate_sentence_bank(
            db,
            movie_id=42,
            word_sentences={
                "captain": [("The captain aborted it.", 1)],
                "abort": [("The captain aborted it.", 2)],
            },
            lemma_id_map={"captain": 4, "abort": 5},
            word_to_lemma={"captain": "captain", "abort": "abort"},
        )

        assert len(db.sentences) == 1
        assert sorted(link["lemmaId"] for link in db.links) == [4, 5]

    async def test_the_same_lemma_twice_in_one_sentence_links_once(self):
        # (sentence_id, lemma_id) is unique, so a second link would be a
        # duplicate insert — cheap to avoid, and it keeps the transaction from
        # rolling back on a conflict of its own making.
        db = _Db()

        await sbs.populate_sentence_bank(
            db,
            movie_id=42,
            word_sentences={
                "abort":   [("He aborted, then aborts again.", 1)],
                "aborts":  [("He aborted, then aborts again.", 4)],
            },
            lemma_id_map={"abort": 5},
            word_to_lemma={"abort": "abort", "aborts": "abort"},
        )

        assert len(db.links) == 1

    async def test_a_partly_linkable_film_still_stores_what_it_can(self):
        db = _Db()

        await sbs.populate_sentence_bank(
            db,
            movie_id=42,
            word_sentences={
                "abort":       [("The captain aborted it.", 2)],
                "unknownword": [("A sentence with unknownword.", 3)],
            },
            lemma_id_map={"abort": 5},
            word_to_lemma={"abort": "abort", "unknownword": "unknownword"},
        )

        assert len(db.sentences) == 1
        assert db.sentences[0]["sentence"] == "The captain aborted it."


class TestNoDirectWritersAreLeft:
    def test_sentence_bank_rows_are_only_created_through_the_primitive(self):
        # A second writer is a second way to make an orphan. This is the guard
        # that stops one appearing the next time somebody needs a sentence row.
        from pathlib import Path
        import re

        src = Path(__file__).resolve().parents[1] / "src"
        offenders = {}
        for path in sorted(src.rglob("*.py")):
            if path.name == "sentence_bank_service.py":
                continue          # the primitive itself
            hits = re.findall(r"sentencebank\.create", path.read_text())
            if hits:
                offenders[str(path.relative_to(src))] = len(hits)

        assert offenders == {}, (
            f"{offenders} create sentence_bank rows directly. Use "
            "sentence_bank_service.persist_sentence_with_links so the row "
            "cannot be written without its lemma links."
        )
