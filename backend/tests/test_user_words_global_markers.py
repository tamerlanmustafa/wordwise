"""
/user/words/mark-learned and /unlearn — the global (movie_id IS NULL) marker.

Postgres treats NULL <> NULL, so `unique_user_word_movie` never covered these
rows. Issue #93 added a partial unique index
(`user_words_global_word_unique`, see prisma/manual/) plus the route hardening
covered here: mark-learned must survive losing the insert race, and unlearn
must clear *every* global marker, not just the first one it finds.
"""
from __future__ import annotations

from types import SimpleNamespace

from prisma.errors import UniqueViolationError

from src.routes.user_words import SaveWordRequest, mark_word_learned, unlearn_word


class _FakeUserWord:
    """Records calls; `find_first` and `create` are scripted per test."""

    def __init__(self, log, *, existing=None, create_raises=False):
        self._log = log
        self._existing = existing
        self._create_raises = create_raises

    async def find_first(self, where=None):
        self._log.append(("find_first", where))
        return self._existing

    async def create(self, data=None):
        self._log.append(("create", data))
        if self._create_raises:
            raise UniqueViolationError(
                {"error": "unique constraint failed"}
            )
        return SimpleNamespace(id=99, **data)

    async def update(self, where=None, data=None):
        self._log.append(("update", {"where": where, "data": data}))

    async def update_many(self, where=None, data=None):
        self._log.append(("update_many", {"where": where, "data": data}))
        return 1

    async def delete_many(self, where=None):
        self._log.append(("delete_many", where))
        return 2


class _FakeDb:
    def __init__(self, userword):
        self.userword = userword


async def test_mark_learned_creates_marker_when_none_exists(test_user):
    log = []
    db = _FakeDb(_FakeUserWord(log))

    result = await mark_word_learned(
        request=SaveWordRequest(word="gallant"),
        current_user=test_user,
        db=db,
    )

    assert result == {"learned": True, "word": "gallant"}
    ops = [name for name, _ in log]
    assert ops == ["find_first", "create"]
    assert log[0][1] == {"userId": test_user.id, "word": "gallant", "movieId": None}
    assert log[1][1] == {
        "userId": test_user.id,
        "word": "gallant",
        "isLearned": True,
    }, "the marker must be global — no movieId"


async def test_mark_learned_flags_existing_unlearned_row(test_user):
    log = []
    existing = SimpleNamespace(id=7, isLearned=False)
    db = _FakeDb(_FakeUserWord(log, existing=existing))

    await mark_word_learned(
        request=SaveWordRequest(word="gallant"), current_user=test_user, db=db
    )

    assert [name for name, _ in log] == ["find_first", "update"]
    assert log[1][1] == {"where": {"id": 7}, "data": {"isLearned": True}}


async def test_mark_learned_is_a_noop_when_already_learned(test_user):
    log = []
    existing = SimpleNamespace(id=7, isLearned=True)
    db = _FakeDb(_FakeUserWord(log, existing=existing))

    await mark_word_learned(
        request=SaveWordRequest(word="gallant"), current_user=test_user, db=db
    )

    assert [name for name, _ in log] == ["find_first"], "no write when already learned"


async def test_mark_learned_recovers_when_a_concurrent_call_wins_the_race(test_user):
    """Both callers miss the find; the partial unique index rejects the loser.

    Before #93 there was no index, so the loser silently wrote a duplicate
    global row and /unlearn could only remove one of them.
    """
    log = []
    db = _FakeDb(_FakeUserWord(log, create_raises=True))

    result = await mark_word_learned(
        request=SaveWordRequest(word="gallant"), current_user=test_user, db=db
    )

    assert result == {"learned": True, "word": "gallant"}, "the race must not 500"
    assert [name for name, _ in log] == ["find_first", "create", "update_many"]
    assert log[2][1] == {
        "where": {"userId": test_user.id, "word": "gallant", "movieId": None},
        "data": {"isLearned": True},
    }, "the winner's row is flagged learned instead"


async def test_unlearn_clears_every_global_marker(test_user):
    """delete_many, not find_first + delete — legacy dupes must all go."""
    log = []
    db = _FakeDb(_FakeUserWord(log))

    result = await unlearn_word(
        request=SaveWordRequest(word="gallant"), current_user=test_user, db=db
    )

    assert result == {"learned": False, "word": "gallant"}
    assert [name for name, _ in log] == ["delete_many"]
    assert log[0][1] == {
        "userId": test_user.id,
        "word": "gallant",
        "movieId": None,
        "isLearned": True,
    }, "per-movie rows must be left alone"
