"""
DELETE /auth/me — deletion logic.

The route must (a) clear UserWordList first (its FK is onDelete: NoAction, so
a bare user.delete would be rejected by Postgres), (b) delete the user row
(everything else cascades per schema.prisma), (c) do both inside one
transaction, and (d) only ever touch the *current* user's rows.
"""
from __future__ import annotations

from types import SimpleNamespace

from src.routes.auth import delete_account


class _Recorder:
    """Fake tx client recording (table, op, kwargs) in call order."""

    def __init__(self, log):
        self._log = log
        self.userwordlist = SimpleNamespace(delete_many=self._make("userwordlist.delete_many"))
        self.user = SimpleNamespace(delete=self._make("user.delete"))

    def _make(self, name):
        async def call(**kwargs):
            self._log.append((name, kwargs))
        return call


class _FakeTx:
    def __init__(self, log):
        self._log = log

    def __call__(self):
        return self

    async def __aenter__(self):
        return _Recorder(self._log)

    async def __aexit__(self, *exc):
        return False


class _FakeDb:
    def __init__(self, log):
        self.tx = _FakeTx(log)


async def test_deletes_wordlists_then_user_scoped_to_current_user(test_user):
    log = []
    await delete_account(current_user=test_user, db=_FakeDb(log), _=None)

    assert [name for name, _ in log] == ["userwordlist.delete_many", "user.delete"], (
        "UserWordList must be cleared before user.delete (NoAction FK), inside the tx"
    )
    assert log[0][1] == {"where": {"userId": test_user.id}}
    assert log[1][1] == {"where": {"id": test_user.id}}
