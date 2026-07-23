"""
Unit tests for services/admin_alerts.py.

No network, no DB: send_email is swapped for a recorder and the admin
lookup for a canned fetch, so we cover recipient resolution (env override,
DB path, DB-down fallback) and the ConsecutiveFailureAlerter's
threshold / cooldown / recovery behaviour.
"""
from __future__ import annotations

import pytest

from src.services import admin_alerts
from src.services.admin_alerts import (
    ConsecutiveFailureAlerter,
    resolve_admin_emails,
    send_admin_alert,
)


@pytest.fixture
def sent(monkeypatch):
    """Replace send_email with a recorder; every send 'succeeds'."""
    calls: list[tuple[str, str]] = []  # (to, subject)

    async def _record(to, subject, html, text):
        calls.append((to, subject))
        return True

    monkeypatch.setattr(admin_alerts, "send_email", _record)
    return calls


def _fetch_returning(rows):
    async def _fetch(sql):
        _fetch.sql = sql
        return rows

    return _fetch


# ── resolve_admin_emails ────────────────────────────────────────────────────

async def test_env_override_wins_over_db(monkeypatch):
    monkeypatch.setenv("ADMIN_ALERT_EMAILS", "ops@x.com, boss@x.com ,")

    async def _boom(sql):
        raise AssertionError("must not query the DB when the env override is set")

    assert await resolve_admin_emails(_boom) == ["ops@x.com", "boss@x.com"]


async def test_db_lookup_targets_admin_users(monkeypatch):
    monkeypatch.delenv("ADMIN_ALERT_EMAILS", raising=False)
    fetch = _fetch_returning([{"email": "admin@x.com"}])

    assert await resolve_admin_emails(fetch) == ["admin@x.com"]
    assert "is_admin" in fetch.sql

async def test_db_failure_yields_no_recipients_not_a_crash(monkeypatch):
    """A broken DB is the likely reason we're alerting — must not raise."""
    monkeypatch.delenv("ADMIN_ALERT_EMAILS", raising=False)

    async def _down(sql):
        raise RuntimeError("connection pool exhausted")

    assert await resolve_admin_emails(_down) == []


# ── send_admin_alert ────────────────────────────────────────────────────────

async def test_alert_emails_every_admin(sent, monkeypatch):
    monkeypatch.delenv("ADMIN_ALERT_EMAILS", raising=False)
    fetch = _fetch_returning([{"email": "a@x.com"}, {"email": "b@x.com"}])

    n = await send_admin_alert(fetch, "sentence-worker", "stuck", "5 failures")

    assert n == 2
    assert [to for to, _ in sent] == ["a@x.com", "b@x.com"]
    assert all("sentence-worker" in subj and "stuck" in subj for _, subj in sent)


async def test_alert_with_no_recipients_is_dropped_quietly(sent, monkeypatch):
    monkeypatch.delenv("ADMIN_ALERT_EMAILS", raising=False)
    assert await send_admin_alert(None, "w", "stuck", "d") == 0
    assert sent == []


# ── ConsecutiveFailureAlerter ───────────────────────────────────────────────

def _alerter(threshold=3, cooldown=3600.0):
    return ConsecutiveFailureAlerter(
        "sentence-worker",
        fetch_rows=_fetch_returning([{"email": "admin@x.com"}]),
        threshold=threshold,
        cooldown=cooldown,
    )


async def test_no_alert_below_threshold(sent, monkeypatch):
    monkeypatch.delenv("ADMIN_ALERT_EMAILS", raising=False)
    a = _alerter(threshold=3)
    await a.record_failure(RuntimeError("boom"))
    await a.record_failure(RuntimeError("boom"))
    assert sent == []


async def test_alert_fires_at_threshold_then_respects_cooldown(sent, monkeypatch):
    monkeypatch.delenv("ADMIN_ALERT_EMAILS", raising=False)
    a = _alerter(threshold=3)
    for _ in range(6):  # stays stuck well past the threshold
        await a.record_failure(RuntimeError("timeout"))

    assert len(sent) == 1  # one alert, not one per failure
    assert "stuck" in sent[0][1]


async def test_success_resets_counter_without_email_when_never_alerted(sent, monkeypatch):
    monkeypatch.delenv("ADMIN_ALERT_EMAILS", raising=False)
    a = _alerter(threshold=3)
    await a.record_failure(RuntimeError("boom"))
    await a.record_failure(RuntimeError("boom"))
    await a.record_success()
    # counter reset → two more failures stay below threshold again
    await a.record_failure(RuntimeError("boom"))
    await a.record_failure(RuntimeError("boom"))
    assert sent == []


async def test_recovery_email_sent_once_after_an_alert(sent, monkeypatch):
    monkeypatch.delenv("ADMIN_ALERT_EMAILS", raising=False)
    a = _alerter(threshold=2)
    await a.record_failure(RuntimeError("boom"))
    await a.record_failure(RuntimeError("boom"))  # alert
    await a.record_success()                       # recovery
    await a.record_success()                       # quiet

    subjects = [subj for _, subj in sent]
    assert len(subjects) == 2
    assert "stuck" in subjects[0]
    assert "recovered" in subjects[1]


async def test_new_incident_after_recovery_alerts_again_post_cooldown(sent, monkeypatch):
    monkeypatch.delenv("ADMIN_ALERT_EMAILS", raising=False)
    a = _alerter(threshold=2, cooldown=0.0)  # zero cooldown: re-alert allowed
    await a.record_failure(RuntimeError("boom"))
    await a.record_failure(RuntimeError("boom"))  # alert #1
    await a.record_success()                       # recovery #1
    await a.record_failure(RuntimeError("boom"))
    await a.record_failure(RuntimeError("boom"))  # alert #2

    assert sum("stuck" in subj for _, subj in sent) == 2
