"""
Shared pytest fixtures.

Fixture strategy (from the test plan):
- Pure-unit fixtures (fake users, in-memory data) live here and require no DB.
- Integration fixtures that hit a real Postgres go behind the `integration`
  marker and are skipped in the default CI run. Add them later when we bring
  up a postgres service container.
"""
from __future__ import annotations

import os
from types import SimpleNamespace

import pytest

# Set required env vars BEFORE any `src.*` import reads settings. Config has
# required fields (database_url, jwt_secret_key, etc.); supply dummies so
# pydantic-settings doesn't raise at import time during unit tests.
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test_db")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-not-for-production")
os.environ.setdefault("JWT_ALGORITHM", "HS256")
os.environ.setdefault("TMDB_API_KEY", "test-tmdb-key")
os.environ.setdefault("GOOGLE_CLIENT_ID", "test-google-id")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test-google-secret")


@pytest.fixture
def test_user() -> SimpleNamespace:
    """A non-admin, active user — the default for most behavior tests."""
    return SimpleNamespace(
        id=1,
        email="user@example.com",
        isActive=True,
        isAdmin=False,
        targetLanguage="ES",
        proficiencyLevel="B1",
    )


def fake_request(**scope) -> SimpleNamespace:
    """Stand-in for the `Request` the auth dependencies now take (issue #138).

    They read `request.scope["state"]` to reuse the JWT the rate-limit
    middleware already decoded for this request. A test calling the dependency
    directly has no ASGI server underneath it, so it supplies the scope dict
    the server would have made.
    """
    scope.setdefault("state", {})
    return SimpleNamespace(scope=scope)


@pytest.fixture
def admin_user() -> SimpleNamespace:
    """An admin user — use in tests that verify admin-gated routes."""
    return SimpleNamespace(
        id=2,
        email="admin@example.com",
        isActive=True,
        isAdmin=True,
        targetLanguage="ES",
        proficiencyLevel="C1",
    )


@pytest.fixture
def inactive_user() -> SimpleNamespace:
    """A user with isActive=False — should be blocked by get_current_active_user."""
    return SimpleNamespace(
        id=3,
        email="disabled@example.com",
        isActive=False,
        isAdmin=False,
    )


@pytest.fixture
def movie_factory():
    """Build lightweight movie dicts for tests that don't need a real DB row."""
    counter = {"n": 0}

    def _make(**overrides):
        counter["n"] += 1
        base = {
            "id": counter["n"],
            "title": f"Test Movie {counter['n']}",
            "releaseYear": 2020,
            "difficultyScore": 50,
            "difficultyLevel": "B1",
        }
        base.update(overrides)
        return base

    return _make


@pytest.fixture
def hidden_word_factory():
    """Build HiddenWord rows for tests that exercise the filter logic."""
    counter = {"n": 0}

    def _make(word: str, *, hidden_by_id: int = 2, reason: str | None = None):
        counter["n"] += 1
        return {
            "id": counter["n"],
            "word": word.lower(),
            "hiddenById": hidden_by_id,
            "reason": reason,
        }

    return _make
