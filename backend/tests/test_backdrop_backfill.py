"""
The #115 backdrop backfill loop.

This exists because the first version of the script shipped a bug the dry run
could not catch: four workers shared one asyncpg `Connection` and wrote through
it concurrently. An asyncpg connection permits exactly one operation in flight
and raises `InterfaceError: another operation is in progress` — so the run died
on its first write, having passed `--dry-run` cleanly, because `--dry-run`
never writes.

`_ExclusiveConn` below reproduces that constraint. Any regression that removes
the lock or the batching fails here instead of 4,572 movies into a prod run.
"""
from __future__ import annotations

import asyncio

import pytest

from backfill_backdrop_corner_rgb import run_backfill


class _ExclusiveConn:
    """A connection that behaves like asyncpg's: one operation at a time.

    The `await asyncio.sleep(0)` is what makes the test meaningful — it yields
    to the event loop mid-operation, so an unguarded second caller gets in and
    trips the flag exactly as the real driver would.
    """

    def __init__(self):
        self.busy = False
        self.batches: list[list[tuple[int, int]]] = []

    async def executemany(self, sql, rows):
        if self.busy:
            raise RuntimeError("another operation is in progress")
        self.busy = True
        try:
            await asyncio.sleep(0)
            self.batches.append(list(rows))
        finally:
            self.busy = False

    @property
    def written(self) -> list[tuple[int, int]]:
        return [row for batch in self.batches for row in batch]


def _pending(n: int) -> list[tuple[int, int]]:
    """`n` movies, ids 1..n, tmdb ids 1001..."""
    return [(i, 1000 + i) for i in range(1, n + 1)]


async def _always(packed: int):
    async def compute(_tmdb_id: int):
        return packed

    return compute


@pytest.mark.asyncio
class TestRunBackfill:
    async def test_concurrent_workers_never_overlap_on_the_connection(self):
        # The original bug, in one assertion.
        conn = _ExclusiveConn()
        stored, missing = await run_backfill(
            conn, _pending(50), await _always(0x0CC8FF),
            concurrency=8, flush_every=5, delay=0,
        )
        assert (stored, missing) == (50, 0)
        assert len(conn.written) == 50

    async def test_every_movie_is_written_exactly_once(self):
        conn = _ExclusiveConn()
        await run_backfill(
            conn, _pending(37), await _always(1), concurrency=4, flush_every=10, delay=0,
        )
        ids = sorted(movie_id for _packed, movie_id in conn.written)
        assert ids == list(range(1, 38))

    async def test_params_are_ordered_for_the_update(self):
        # UPDATE ... SET backdrop_corner_rgb = $1 WHERE id = $2. Swapping these
        # would write the movie id into the colour column on every row.
        conn = _ExclusiveConn()
        await run_backfill(
            conn, [(42, 9001)], await _always(0xAABBCC), concurrency=1, flush_every=1, delay=0,
        )
        assert conn.written == [(0xAABBCC, 42)]

    async def test_writes_are_batched_not_one_per_movie(self):
        conn = _ExclusiveConn()
        await run_backfill(
            conn, _pending(100), await _always(7), concurrency=4, flush_every=25, delay=0,
        )
        # 100 movies in batches of 25 is a handful of round trips, not 100.
        assert len(conn.batches) <= 6
        assert len(conn.written) == 100

    async def test_trailing_partial_batch_is_flushed(self):
        # 12 movies with a threshold of 5 leaves 2 in the buffer at the end;
        # without the final flush they would be silently dropped.
        conn = _ExclusiveConn()
        stored, _ = await run_backfill(
            conn, _pending(12), await _always(3), concurrency=3, flush_every=5, delay=0,
        )
        assert stored == 12
        assert len(conn.written) == 12

    async def test_movies_with_no_backdrop_are_counted_not_written(self):
        conn = _ExclusiveConn()

        async def compute(tmdb_id: int):
            return None if tmdb_id % 2 else 5

        stored, missing = await run_backfill(
            conn, _pending(10), compute, concurrency=4, flush_every=3, delay=0,
        )
        assert (stored, missing) == (5, 5)
        # The NULL rows stay NULL — the card's gold + halo fallback is correct
        # for them, and a re-run retries them.
        assert len(conn.written) == 5

    async def test_one_failure_does_not_abort_the_run(self):
        conn = _ExclusiveConn()

        async def compute(tmdb_id: int):
            if tmdb_id == 1005:
                raise RuntimeError("TMDB 503")
            return 9

        stored, missing = await run_backfill(
            conn, _pending(10), compute, concurrency=4, flush_every=4, delay=0,
        )
        assert (stored, missing) == (9, 1)

    async def test_dry_run_writes_nothing(self):
        conn = _ExclusiveConn()
        stored, _ = await run_backfill(
            conn, _pending(20), await _always(1),
            concurrency=4, flush_every=5, delay=0, dry_run=True,
        )
        assert stored == 20          # still reports what it would have done
        assert conn.batches == []    # but touches the connection not at all

    async def test_empty_work_list_is_a_no_op(self):
        conn = _ExclusiveConn()
        assert await run_backfill(conn, [], await _always(1), delay=0) == (0, 0)
        assert conn.batches == []
