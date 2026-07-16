"""
Unit tests for services/email_service.py.

No network anywhere: the no-op path is exercised with the default empty
RESEND_API_KEY, and the send path swaps httpx.AsyncClient for a recorder.
"""
from __future__ import annotations

from types import SimpleNamespace

from src.services import email_service
from src.services.email_service import (
    build_password_reset_email,
    build_welcome_email,
    send_email,
)


# ── Template builders (pure) ────────────────────────────────────────────────

def test_welcome_email_mentions_user_and_brand():
    subject, html, text = build_welcome_email("cinephile42")
    assert "WordWise" in subject or "WordWise" in html
    assert "cinephile42" in html
    assert "cinephile42" in text


def test_password_reset_email_carries_the_link_in_both_bodies():
    url = "https://api.getwordwise.us/auth/reset-password?token=abc123"
    subject, html, text = build_password_reset_email("cinephile42", url)
    assert "eset" in subject  # "Reset …"
    assert url in html
    assert url in text


# ── send_email: disabled (no key) ───────────────────────────────────────────

async def test_send_is_noop_without_api_key(monkeypatch):
    """Default config has no RESEND_API_KEY → no network call, returns False."""
    def _boom(*args, **kwargs):
        raise AssertionError("httpx must not be constructed when email is disabled")

    monkeypatch.setattr(email_service.httpx, "AsyncClient", _boom)
    monkeypatch.setattr(
        email_service, "get_settings",
        lambda: SimpleNamespace(resend_api_key="", email_from="WordWise <x@y.z>"),
    )
    assert await send_email("a@b.c", "s", "<p>h</p>", "t") is False


# ── send_email: provider path (mocked transport) ────────────────────────────

class _FakeResponse:
    def __init__(self, status_code: int):
        self.status_code = status_code
        self.is_success = 200 <= status_code < 300
        self.text = "{}"


class _FakeClient:
    """Async-context httpx.AsyncClient stand-in that records the POST."""

    last_call: dict | None = None
    status_code = 200

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, json=None, headers=None):
        _FakeClient.last_call = {"url": url, "json": json, "headers": headers}
        return _FakeResponse(_FakeClient.status_code)


def _enable_sending(monkeypatch):
    monkeypatch.setattr(email_service.httpx, "AsyncClient", _FakeClient)
    monkeypatch.setattr(
        email_service, "get_settings",
        lambda: SimpleNamespace(
            resend_api_key="re_test_key",
            email_from="WordWise <no-reply@getwordwise.us>",
        ),
    )
    _FakeClient.last_call = None
    _FakeClient.status_code = 200


async def test_send_posts_resend_payload(monkeypatch):
    _enable_sending(monkeypatch)
    ok = await send_email("user@example.com", "Hello", "<p>hi</p>", "hi")
    assert ok is True

    call = _FakeClient.last_call
    assert call["url"] == email_service.RESEND_ENDPOINT
    assert call["headers"]["Authorization"] == "Bearer re_test_key"
    assert call["json"]["from"] == "WordWise <no-reply@getwordwise.us>"
    assert call["json"]["to"] == ["user@example.com"]
    assert call["json"]["subject"] == "Hello"
    assert call["json"]["html"] == "<p>hi</p>"
    assert call["json"]["text"] == "hi"


async def test_provider_rejection_returns_false(monkeypatch):
    _enable_sending(monkeypatch)
    _FakeClient.status_code = 422
    assert await send_email("user@example.com", "Hello", "<p>hi</p>", "hi") is False


async def test_transport_error_swallowed(monkeypatch):
    """A provider outage must never raise into the caller (BackgroundTask)."""
    class _ExplodingClient(_FakeClient):
        async def post(self, *a, **kw):
            raise OSError("connection refused")

    _enable_sending(monkeypatch)
    monkeypatch.setattr(email_service.httpx, "AsyncClient", _ExplodingClient)
    assert await send_email("user@example.com", "Hello", "<p>hi</p>", "hi") is False
