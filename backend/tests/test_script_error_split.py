"""
The transient-vs-permanent split for script fetching — root cause of the
2026-07 dead-jobs incident (issue #78).

`get_or_fetch_script` must raise the permanent `ScriptNotFoundError` ONLY when
every source cleanly reports no match. If any source *raises* (a transient
outage), it must surface a plain Exception so the worker retries on backoff
instead of parking a retrievable film as 'dead' forever.
"""
from __future__ import annotations

import pytest

from src.services.script_ingestion_service import (
    ScriptIngestionService,
    ScriptNotFoundError,
)


async def _no_cache(*args, **kwargs):
    return None


def _service_with_cache_miss(monkeypatch) -> ScriptIngestionService:
    # db is only touched for tmdb_id resolution (skipped here — we pass a title)
    # and the cache read, which we stub to a miss so the source fan-out runs.
    svc = ScriptIngestionService(db=None)
    monkeypatch.setattr(svc, "_get_from_database", _no_cache)
    return svc


async def test_clean_miss_from_every_source_is_permanent(monkeypatch):
    svc = _service_with_cache_miss(monkeypatch)

    async def _no_match(*args, **kwargs):
        return None  # source responded, just had nothing — a clean miss

    monkeypatch.setattr(svc, "_fetch_from_subtitle_api", _no_match)
    monkeypatch.setattr(svc, "_fetch_from_stands4_pdf", _no_match)
    monkeypatch.setattr(svc, "_fetch_from_stands4_api", _no_match)

    with pytest.raises(ScriptNotFoundError):
        await svc.get_or_fetch_script(movie_title="Film With Truly No Script", year=1900)


async def test_invalid_payload_from_sources_is_still_permanent(monkeypatch):
    # A source returning a payload with is_valid=False (blank/stub script) is a
    # "no match", not an error — so every source failing this way is permanent.
    svc = _service_with_cache_miss(monkeypatch)

    async def _invalid(*args, **kwargs):
        return {"is_valid": False}

    monkeypatch.setattr(svc, "_fetch_from_subtitle_api", _invalid)
    monkeypatch.setattr(svc, "_fetch_from_stands4_pdf", _invalid)
    monkeypatch.setattr(svc, "_fetch_from_stands4_api", _invalid)

    with pytest.raises(ScriptNotFoundError):
        await svc.get_or_fetch_script(movie_title="Blank Script Film", year=1999)


async def test_source_outage_is_transient_not_permanent(monkeypatch):
    svc = _service_with_cache_miss(monkeypatch)

    async def _outage(*args, **kwargs):
        raise RuntimeError("Connection reset by peer")  # a source *threw*

    async def _no_match(*args, **kwargs):
        return None

    # Subtitle source is unreachable; the STANDS4 sources cleanly have nothing.
    monkeypatch.setattr(svc, "_fetch_from_subtitle_api", _outage)
    monkeypatch.setattr(svc, "_fetch_from_stands4_pdf", _no_match)
    monkeypatch.setattr(svc, "_fetch_from_stands4_api", _no_match)

    with pytest.raises(Exception) as excinfo:
        await svc.get_or_fetch_script(movie_title="Retrievable Film", year=2001)

    # The whole point of the fix: a source erroring surfaces a plain (transient)
    # Exception, NOT the permanent ScriptNotFoundError — so the worker retries
    # rather than parking a retrievable film 'dead' (the incident bug).
    assert not isinstance(excinfo.value, ScriptNotFoundError)


async def test_stands4_outage_is_transient_even_with_notfound_text(monkeypatch):
    # Regression guard for the old substring bug: an errored source whose
    # message literally contains "not found" must STILL be transient, because
    # classification is now by exception type, not by scanning the text.
    svc = _service_with_cache_miss(monkeypatch)

    async def _no_match(*args, **kwargs):
        return None

    async def _errored_notfound(*args, **kwargs):
        raise RuntimeError("upstream 404: not found")

    monkeypatch.setattr(svc, "_fetch_from_subtitle_api", _no_match)
    monkeypatch.setattr(svc, "_fetch_from_stands4_pdf", _errored_notfound)
    monkeypatch.setattr(svc, "_fetch_from_stands4_api", _errored_notfound)

    with pytest.raises(Exception) as excinfo:
        await svc.get_or_fetch_script(movie_title="Film Whose Source 404s", year=2010)

    assert not isinstance(excinfo.value, ScriptNotFoundError)
