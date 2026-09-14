"""Un-hearting a word does not erase what the user learned.

A saved word and its spaced-repetition state share one `user_words` row, and
un-hearting used to DELETE it. Reproduced against the local database before
this fix, with a mis-tap and its correction:

    auspice   box 2, last reviewed 2026-09-08
    → un-heart (DELETE /lists/{favourites}/items/auspice)
    → re-heart (POST   /lists/{favourites}/items)
    auspice   box 1, never reviewed, new id, new created_at

Both hearts did it — the Favourites list and the word feed's save toggle — so
both are pinned here, plus the feed toggle's second bug: with no movie id it
matched ANY row for the word and could delete one saved from a film.

No database (see tests/conftest.py): a recording fake stands in, the same shape
test_lists_adapters.py uses, and each test asserts on the WRITE the code chose.
"""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from src.services.saved_words import has_progress, release_saved_rows
from src.services.session_kinds import PRACTICE_SOURCE

REVIEWED = datetime(2026, 9, 8, 23, 37, tzinfo=timezone.utc)


def word_row(**over) -> SimpleNamespace:
    base = dict(
        id=167,
        userId=2,
        word="auspice",
        movieId=None,
        isLearned=False,
        source=None,
        srsBox=1,
        srsLastReviewedAt=None,
    )
    base.update(over)
    return SimpleNamespace(**base)


class Recorder:
    """Records userword writes; answers find_first/find_many from `rows`."""

    def __init__(self, rows=None):
        self.writes: list[tuple[str, dict]] = []
        self.finds: list[dict] = []
        self._rows = rows or []

    @property
    def userword(self):
        rec = self

        class _Model:
            async def update(self, **kw):
                rec.writes.append(("update", kw))

            async def delete(self, **kw):
                rec.writes.append(("delete", kw))

            async def delete_many(self, **kw):
                rec.writes.append(("delete_many", kw))

            async def create(self, **kw):
                rec.writes.append(("create", kw))

            async def find_first(self, **kw):
                rec.finds.append(kw["where"])
                return rec._rows[0] if rec._rows else None

            async def find_many(self, **kw):
                rec.finds.append(kw["where"])
                return list(rec._rows)

        return _Model()

    @property
    def movie(self):
        class _Movie:
            async def find_unique(self, **_kw):
                return None

        return _Movie()


# ── The decision itself ──────────────────────────────────────────────────────


class TestHasProgress:
    def test_a_reviewed_word_has_progress(self):
        assert has_progress(word_row(srsBox=2, srsLastReviewedAt=REVIEWED))

    def test_a_box_above_one_counts_even_without_a_timestamp(self):
        assert has_progress(word_row(srsBox=3))

    def test_a_never_studied_word_has_none(self):
        # The common case: hearted, never practised. Nothing on it to lose.
        assert not has_progress(word_row())


class TestReleaseSavedRows:
    async def test_a_word_with_progress_is_demoted_not_deleted(self):
        db = Recorder()
        await release_saved_rows(db, [word_row(srsBox=2, srsLastReviewedAt=REVIEWED)])
        assert db.writes == [
            ("update", {"where": {"id": 167}, "data": {"source": PRACTICE_SOURCE}}),
        ]

    async def test_a_word_with_no_progress_is_still_deleted(self):
        # Keeping it would only accumulate dead rows.
        db = Recorder()
        await release_saved_rows(db, [word_row()])
        assert db.writes == [("delete", {"where": {"id": 167}})]

    async def test_a_practice_row_with_progress_is_left_completely_alone(self):
        # Nothing to demote, and above all nothing to delete — the old
        # favourites `delete_many` would have taken this row too.
        db = Recorder()
        await release_saved_rows(
            db, [word_row(source=PRACTICE_SOURCE, srsBox=4, srsLastReviewedAt=REVIEWED)]
        )
        assert db.writes == []

    async def test_a_learned_marker_is_never_touched(self):
        # "Never show me this again" is a different fact from "saved". Deleting
        # it would silently un-hide a word the user asked to stop seeing.
        db = Recorder()
        await release_saved_rows(db, [word_row(isLearned=True, srsLastReviewedAt=REVIEWED)])
        assert db.writes == []

    async def test_every_duplicate_is_released(self):
        # Pre-#93 data can hold duplicate global rows; releasing only one
        # would leave the word in Favourites.
        db = Recorder()
        await release_saved_rows(
            db,
            [word_row(id=1, srsLastReviewedAt=REVIEWED), word_row(id=2)],
        )
        assert db.writes == [
            ("update", {"where": {"id": 1}, "data": {"source": PRACTICE_SOURCE}}),
            ("delete", {"where": {"id": 2}}),
        ]


# ── The round trip that lost progress ────────────────────────────────────────


class TestTheRoundTripKeepsProgress:
    async def test_re_hearting_a_demoted_word_restores_it_with_its_history(self):
        """The reproduction, end to end at the service layer.

        Un-heart demotes; re-heart finds a Practice row and takes the promote
        path that already existed — so the box and review date are simply
        still there. No row is created, so nothing starts from scratch.
        """
        from src.services import lists as svc

        # 1. Un-heart from Favourites.
        progressed = word_row(srsBox=2, srsLastReviewedAt=REVIEWED)
        db = Recorder(rows=[progressed])
        favourites = SimpleNamespace(id=2, kind="words", systemKey="favourites")

        async def owned(*_a, **_k):
            return favourites

        async def stats(*_a, **_k):
            return {}

        orig_owned, orig_stats, orig_summary = svc._owned_list, svc._stats_for_one, svc._summary_from
        svc._owned_list, svc._stats_for_one = owned, stats
        svc._summary_from = lambda row, st: None
        try:
            await svc.remove_item(db, 2, 2, "auspice")
        finally:
            svc._owned_list, svc._stats_for_one, svc._summary_from = orig_owned, orig_stats, orig_summary

        assert ("delete", {"where": {"id": 167}}) not in db.writes
        assert not any(op == "delete_many" for op, _ in db.writes)
        assert db.writes == [
            ("update", {"where": {"id": 167}, "data": {"source": PRACTICE_SOURCE}}),
        ]
        # Scoped to the global, non-learned row.
        assert db.finds[0] == {"userId": 2, "word": "auspice", "movieId": None, "isLearned": False}

        # 2. Re-heart: the row is now a Practice row, so `_add_words` promotes.
        demoted = word_row(source=PRACTICE_SOURCE, srsBox=2, srsLastReviewedAt=REVIEWED)
        db2 = Recorder(rows=[demoted])
        await svc._add_words(db2, 2, favourites, [{"word": "auspice"}])
        assert db2.writes == [
            ("update", {"where": {"id": 167}, "data": {"source": None, "isLearned": False}}),
        ]
        # The whole point: no create, so the history is never reset.
        assert not any(op == "create" for op, _ in db2.writes)


# ── The word feed's save toggle ──────────────────────────────────────────────


class TestFeedSaveToggle:
    async def _toggle(self, rows, movie_id=None):
        from src.routes.user_words import SaveWordRequest, save_word

        db = Recorder(rows=rows)
        user = SimpleNamespace(id=2)
        out = await save_word(SaveWordRequest(word="auspice", movie_id=movie_id), user, db)
        return out, db

    async def test_un_saving_a_studied_word_keeps_its_progress(self):
        out, db = await self._toggle([word_row(srsBox=3, srsLastReviewedAt=REVIEWED)])
        assert out == {"saved": False, "word": "auspice"}
        assert db.writes == [
            ("update", {"where": {"id": 167}, "data": {"source": PRACTICE_SOURCE}}),
        ]

    async def test_a_global_heart_looks_only_at_the_global_row(self):
        # The second bug. The movie id was added to the filter only when
        # present, so the feed (which sends none) matched a row saved from a
        # film and deleted that one.
        _, db = await self._toggle([])
        assert db.finds[0]["movieId"] is None

    async def test_a_film_heart_looks_only_at_that_film(self):
        _, db = await self._toggle([], movie_id=42)
        assert db.finds[0]["movieId"] == 42

    async def test_the_toggle_still_promotes_a_practice_row(self):
        out, db = await self._toggle(
            [word_row(source=PRACTICE_SOURCE, srsBox=2, srsLastReviewedAt=REVIEWED)]
        )
        assert out["saved"] is True
        assert db.writes == [("update", {"where": {"id": 167}, "data": {"source": None}})]


pytestmark = pytest.mark.asyncio
