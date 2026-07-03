"""
Tests for the classify-script refactor.

Two behavioral guarantees are covered, both as pure-unit (no DB, no network):

1. The HTTP route is gated on get_current_active_user (any logged-in user),
   NOT get_admin_user. Regression guard for the bug where classifying a
   movie's vocabulary — a normal user action — 401/403'd for everyone.

2. The ingestion worker runs fully IN-PROCESS: it fetches scripts via
   ScriptIngestionService and classifies via run_script_classification
   directly, instead of POSTing to its own /api/scripts/fetch or
   /api/cefr/classify-script (both now require auth the worker can't supply).
"""
from __future__ import annotations

import inspect
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.middleware.auth import get_admin_user, get_current_active_user
from src.routes.cefr import classify_script, run_script_classification


# ---------------------------------------------------------------------------
# 1. Route auth wiring
# ---------------------------------------------------------------------------

def _dependency_of(func, param_name):
    """Pull the callable behind a `param = Depends(callable)` default."""
    default = inspect.signature(func).parameters[param_name].default
    return getattr(default, "dependency", None)


def test_classify_script_requires_any_active_user_not_admin():
    dep = _dependency_of(classify_script, "current_user")
    assert dep is get_current_active_user
    assert dep is not get_admin_user


def test_run_script_classification_is_auth_free_service():
    """The shared service takes only (db, request) — no auth, no BackgroundTasks
    — so the worker can call it in-process."""
    params = list(inspect.signature(run_script_classification).parameters)
    assert params == ["db", "request"]


# ---------------------------------------------------------------------------
# 2. Worker classifies in-process (no HTTP hop, no auth)
# ---------------------------------------------------------------------------

class _FakeConn:
    def __init__(self):
        self.execute = AsyncMock()


class _FakePool:
    """asyncpg-style pool whose acquire() is an async context manager."""

    def __init__(self):
        self.conn = _FakeConn()

    def acquire(self):
        conn = self.conn

        class _Ctx:
            async def __aenter__(self_inner):
                return conn

            async def __aexit__(self_inner, *exc):
                return False

        return _Ctx()


async def test_process_job_classifies_in_process(monkeypatch):
    import prisma

    import src.routes.cefr as cefr
    import src.services.script_ingestion_service as ingestion
    import src.workers.processor as processor
    from src.workers.queue import Job

    # --- stub the worker's collaborators -----------------------------------
    monkeypatch.setattr(processor.rate, "acquire_token", AsyncMock())
    monkeypatch.setattr(processor.rate, "record_event", AsyncMock())
    monkeypatch.setattr(
        processor,
        "_fetch_tmdb_metadata",
        AsyncMock(return_value={
            "genres": [{"name": "Drama"}, {"name": "Crime"}],
            "popularity": 1.0,
            "vote_average": 7.0,
            "vote_count": 100,
        }),
    )

    # --- stub the in-process script fetch (step 3) --------------------------
    # process_job does `from ... import ScriptIngestionService` at call time,
    # so patching the source module is what takes effect.
    fetch_service = MagicMock()
    fetch_service.get_or_fetch_script = AsyncMock(return_value={"from_cache": True})
    fetch_service.close = AsyncMock()
    monkeypatch.setattr(
        ingestion, "ScriptIngestionService", MagicMock(return_value=fetch_service)
    )

    # --- stub the in-process classification path ---------------------------
    fake_db = MagicMock()
    fake_db.connect = AsyncMock()
    fake_db.disconnect = AsyncMock()
    fake_db.is_connected = MagicMock(return_value=True)
    monkeypatch.setattr(prisma, "Prisma", MagicMock(return_value=fake_db))

    classify_mock = AsyncMock(
        return_value=SimpleNamespace(level_distribution={"A1": 3, "B1": 2})
    )
    monkeypatch.setattr(cefr, "run_script_classification", classify_mock)
    sentence_bank_mock = AsyncMock()
    monkeypatch.setattr(cefr, "populate_sentence_bank_bg", sentence_bank_mock)

    client = MagicMock()
    client.post = AsyncMock()

    pool = _FakePool()
    job = Job(id=1, tmdb_id=603, title="The Matrix", year=1999, priority=0, attempts=0, movie_id=55)

    result = await processor.process_job(pool, job, client)

    # Script fetch happened in-process via the ingestion service.
    fetch_service.get_or_fetch_script.assert_awaited_once_with(
        movie_title="The Matrix",
        movie_id=55,
        year=1999,
        force_refresh=False,
    )
    fetch_service.close.assert_awaited_once()

    # Classification happened in-process, with genres from TMDB.
    classify_mock.assert_awaited_once()
    _db_arg, req_arg = classify_mock.await_args.args
    assert _db_arg is fake_db
    assert req_arg.movie_id == 55
    assert req_arg.save_to_db is True
    assert req_arg.genres == ["Drama", "Crime"]

    # SentenceBank population mirrors the route's post-classify step.
    sentence_bank_mock.assert_awaited_once_with(55)

    # The worker makes NO POSTs to its own API anymore — /api/scripts/fetch
    # and /api/cefr/classify-script both require auth the worker can't supply.
    client.post.assert_not_awaited()

    # vocab_count is summed from the in-process result.
    assert result.movie_id == 55
    assert result.vocab_count == 5

    # Two Prisma connections (script fetch + classification), both closed.
    assert fake_db.connect.await_count == 2
    assert fake_db.disconnect.await_count == 2
