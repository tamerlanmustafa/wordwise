"""
`queue.requeue_dead` revives parked 'dead' movie_jobs so a burst can retry them
(issue #78 / the 2026-07 incident). DB-free: a fake asyncpg connection records
the statements and returns canned results, so we assert the count-parsing,
dry-run, and param plumbing without a live Postgres.
"""
from __future__ import annotations

from src.workers import queue as q


class _FakeConn:
    def __init__(self, *, execute_result="UPDATE 0", fetchval_result=0):
        self._execute_result = execute_result
        self._fetchval_result = fetchval_result
        self.execute_calls: list = []
        self.fetchval_calls: list = []

    async def execute(self, sql, *args):
        self.execute_calls.append((sql, args))
        return self._execute_result

    async def fetchval(self, sql, *args):
        self.fetchval_calls.append((sql, args))
        return self._fetchval_result


class _FakeAcquire:
    def __init__(self, conn):
        self._conn = conn

    async def __aenter__(self):
        return self._conn

    async def __aexit__(self, *exc):
        return False


class _FakePool:
    def __init__(self, conn):
        self._conn = conn

    def acquire(self):
        return _FakeAcquire(self._conn)


async def test_requeue_dead_parses_updated_row_count():
    conn = _FakeConn(execute_result="UPDATE 571")
    n = await q.requeue_dead(_FakePool(conn))

    assert n == 571
    # Exactly one UPDATE: flips dead → pending and resets the attempt counter so
    # a single new hiccup doesn't immediately re-kill the job.
    assert len(conn.execute_calls) == 1
    sql, args = conn.execute_calls[0]
    assert "status = 'pending'" in sql
    assert "attempts = 0" in sql
    assert args == (None, None)  # like=None, limit=None → all dead jobs


async def test_requeue_dead_dry_run_counts_without_writing():
    conn = _FakeConn(fetchval_result=42)
    n = await q.requeue_dead(_FakePool(conn), dry_run=True)

    assert n == 42
    assert conn.fetchval_calls          # it counted
    assert not conn.execute_calls       # but changed nothing


async def test_requeue_dead_threads_like_and_limit():
    conn = _FakeConn(execute_result="UPDATE 3")
    n = await q.requeue_dead(_FakePool(conn), limit=3, like="%sources%")

    assert n == 3
    _, args = conn.execute_calls[0]
    assert args == ("%sources%", 3)


async def test_requeue_dead_handles_zero_rows():
    conn = _FakeConn(execute_result="UPDATE 0")
    n = await q.requeue_dead(_FakePool(conn))
    assert n == 0
