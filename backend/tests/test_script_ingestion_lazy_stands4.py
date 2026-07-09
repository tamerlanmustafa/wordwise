"""
Regression: ScriptIngestionService must construct without STANDS4 credentials.

In production the API/worker ran without STANDS4_USER_ID/TOKEN and *every*
/api/scripts/fetch request 500'd ("STANDS4 credentials ... are required") —
even for scripts already cached in the database — because __init__ eagerly
built STANDS4Client. The client is now a lazy property: construction succeeds
without creds, and only touching a STANDS4 source raises (which the per-source
try/except in get_or_fetch_script downgrades to "source unavailable").
"""
from __future__ import annotations

import pytest

from src.services.script_ingestion_service import ScriptIngestionService


@pytest.fixture
def no_stands4_env(monkeypatch):
    monkeypatch.delenv("STANDS4_USER_ID", raising=False)
    monkeypatch.delenv("STANDS4_TOKEN", raising=False)


def test_service_constructs_without_stands4_creds(no_stands4_env):
    # db is only stored on self in __init__, so a placeholder is fine here.
    service = ScriptIngestionService(db=None)
    assert service._stands4_client is None


def test_stands4_property_raises_only_on_use(no_stands4_env):
    service = ScriptIngestionService(db=None)
    with pytest.raises(ValueError, match="STANDS4 credentials"):
        _ = service.stands4_client


def test_stands4_property_builds_client_when_creds_present(monkeypatch):
    monkeypatch.setenv("STANDS4_USER_ID", "test-user")
    monkeypatch.setenv("STANDS4_TOKEN", "test-token")
    service = ScriptIngestionService(db=None)
    client = service.stands4_client
    assert client is not None
    # cached on second access
    assert service.stands4_client is client
