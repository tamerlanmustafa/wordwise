"""
Tests for the classify-script refactor.

Two behavioral guarantees are covered, both as pure-unit (no DB, no network):

1. The HTTP route is gated on get_current_active_user (any logged-in user),
   NOT get_admin_user. Regression guard for the bug where classifying a
   movie's vocabulary — a normal user action — 401/403'd for everyone.

2. The ingestion worker classifies IN-PROCESS by calling
   run_script_classification directly, instead of POSTing to its own
   /api/cefr/classify-script (which now requires auth the worker can't supply).
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

    # --- fake httpx client: only /scripts/fetch should be POSTed -----------
    fetch_resp = MagicMock()
    fetch_resp.raise_for_status = MagicMock()
    client = MagicMock()
    client.post = AsyncMock(return_value=fetch_resp)

    pool = _FakePool()
    job = Job(id=1, tmdb_id=603, title="The Matrix", year=1999, priority=0, attempts=0, movie_id=55)

    result = await processor.process_job(pool, job, client)

    # Classification happened in-process, with genres from TMDB.
    classify_mock.assert_awaited_once()
    _db_arg, req_arg = classify_mock.await_args.args
    assert _db_arg is fake_db
    assert req_arg.movie_id == 55
    assert req_arg.save_to_db is True
    assert req_arg.genres == ["Drama", "Crime"]

    # SentenceBank population mirrors the route's post-classify step.
    sentence_bank_mock.assert_awaited_once_with(55)

    # The worker no longer POSTs to its own classify-script endpoint.
    posted_urls = [c.args[0] for c in client.post.await_args_list]
    assert not any("classify-script" in url for url in posted_urls)

    # vocab_count is summed from the in-process result.
    assert result.movie_id == 55
    assert result.vocab_count == 5

    # Prisma connection was opened and cleanly closed.
    fake_db.connect.assert_awaited_once()
    fake_db.disconnect.assert_awaited_once()
