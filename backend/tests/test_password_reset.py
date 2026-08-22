"""
Password-reset flow: token discipline, the forgot/reset endpoints, and the
single-use guarantee (tokens die when the password changes).

Same strategy as test_auth_guards.py — call route functions directly with
fake Prisma surfaces; no DB, no network (email_service stays in its no-key
no-op mode or is monkeypatched).
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks, HTTPException

from .conftest import fake_request
from src.middleware.auth import get_current_user
from src.routes import auth as auth_routes
from src.routes.auth import (
    forgot_password,
    reset_password_form,
    reset_password_submit,
)
from src.schemas.user import ForgotPasswordRequest
from src.utils.auth import (
    create_access_token,
    create_password_reset_token,
    password_hash_fingerprint,
    verify_password,
    verify_token,
)

HASH = "$2b$12$fakedhashfakedhashfakedhashfakedhashfakedhashfakedha"


def _user(**overrides) -> SimpleNamespace:
    base = dict(
        id=7,
        email="movielover@example.com",
        username="movielover",
        passwordHash=HASH,
        isActive=True,
        isAdmin=False,
        # App UI language (#98) — the reset mail is written in it.
        languagePreference=None,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


class _FakeUserTable:
    def __init__(self, user):
        self._user = user
        self.updates: list[dict] = []

    async def find_unique(self, where):
        u = self._user
        if u is None:
            return None
        if where.get("id") == u.id or where.get("email") == u.email:
            return u
        return None

    async def update(self, where, data):
        self.updates.append({"where": where, "data": data})
        for k, v in data.items():
            setattr(self._user, k, v)
        return self._user


class _FakeDb:
    def __init__(self, user):
        self.user = _FakeUserTable(user)


def _token_for(user) -> str:
    return create_password_reset_token(user.id, user.email, user.passwordHash)


# ── Token discipline ────────────────────────────────────────────────────────

def test_reset_token_is_single_purpose():
    payload = verify_token(_token_for(_user()))
    assert payload["type"] == "password_reset"
    assert payload["pwh"] == password_hash_fingerprint(HASH)


async def test_reset_token_rejected_as_bearer():
    """A leaked reset link must never authenticate API requests."""
    user = _user()
    with pytest.raises(HTTPException) as exc:
        await get_current_user(fake_request(), token=_token_for(user), db=_FakeDb(user))
    assert exc.value.status_code == 401


# ── POST /auth/forgot-password ──────────────────────────────────────────────

async def test_forgot_password_queues_email_for_password_account():
    tasks = BackgroundTasks()
    res = await forgot_password(
        body=ForgotPasswordRequest(email="movielover@example.com"),
        background_tasks=tasks,
        db=_FakeDb(_user()),
        _=None,
    )
    assert res == {"status": "sent"}
    assert len(tasks.tasks) == 1
    # The reset URL lands on our own HTML form.
    assert "/auth/reset-password?token=" in tasks.tasks[0].args[2]


@pytest.mark.parametrize(
    "user",
    [
        None,                          # unknown email
        _user(passwordHash=None),      # OAuth-only account: nothing to reset
        _user(isActive=False),         # deactivated account
    ],
)
async def test_forgot_password_is_silent_when_not_applicable(user):
    """Same 202 + no email whether or not the account exists — the endpoint
    must not leak which addresses have accounts."""
    tasks = BackgroundTasks()
    res = await forgot_password(
        body=ForgotPasswordRequest(email="movielover@example.com"),
        background_tasks=tasks,
        db=_FakeDb(user),
        _=None,
    )
    assert res == {"status": "sent"}
    assert tasks.tasks == []


# ── GET /auth/reset-password (the form) ─────────────────────────────────────

async def test_form_renders_for_valid_token():
    user = _user()
    res = await reset_password_form(token=_token_for(user), db=_FakeDb(user), _=None)
    assert res.status_code == 200
    assert b"new_password" in res.body


async def test_form_rejects_access_token():
    user = _user()
    token = create_access_token({"sub": str(user.id), "email": user.email})
    res = await reset_password_form(token=token, db=_FakeDb(user), _=None)
    assert res.status_code == 400


async def test_form_rejects_garbage():
    res = await reset_password_form(token="not-a-jwt", db=_FakeDb(_user()), _=None)
    assert res.status_code == 400


# ── POST /auth/reset-password (the submit) ──────────────────────────────────

async def test_submit_updates_the_password_hash():
    user = _user()
    db = _FakeDb(user)

    res = await reset_password_submit(
        token=_token_for(user), new_password="brand-new-pass-9", db=db, _=None
    )

    assert res.status_code == 200
    assert len(db.user.updates) == 1
    new_hash = db.user.updates[0]["data"]["passwordHash"]
    assert new_hash != HASH
    assert verify_password("brand-new-pass-9", new_hash)


async def test_reset_link_is_single_use():
    """After a successful reset the same token must be dead: its pwh
    fingerprint no longer matches the stored hash."""
    user = _user()
    db = _FakeDb(user)
    token = _token_for(user)

    first = await reset_password_submit(token=token, new_password="brand-new-pass-9", db=db, _=None)
    assert first.status_code == 200

    second = await reset_password_submit(token=token, new_password="another-pass-10", db=db, _=None)
    assert second.status_code == 400
    assert len(db.user.updates) == 1  # no second write


@pytest.mark.parametrize("bad_password", ["short7", "x" * 73])
async def test_submit_enforces_signup_password_rules(bad_password):
    user = _user()
    db = _FakeDb(user)
    res = await reset_password_submit(
        token=_token_for(user), new_password=bad_password, db=db, _=None
    )
    assert res.status_code == 400
    assert db.user.updates == []


async def test_submit_rejects_stale_email_claim():
    """A link minted before the user changed address must not reset the
    account under its new address."""
    user = _user()
    token = _token_for(user)
    user.email = "changed@example.com"
    db = _FakeDb(user)

    res = await reset_password_submit(token=token, new_password="brand-new-pass-9", db=db, _=None)

    assert res.status_code == 400
    assert db.user.updates == []


# ── Reset emails go through the email service ───────────────────────────────

async def test_forgot_password_email_payload(monkeypatch):
    sent: list[tuple] = []

    async def _fake_send(to, username, url, language=None):
        sent.append((to, username, url, language))
        return True

    monkeypatch.setattr(auth_routes.email_service, "send_password_reset_email", _fake_send)

    tasks = BackgroundTasks()
    await forgot_password(
        body=ForgotPasswordRequest(email="movielover@example.com"),
        background_tasks=tasks,
        db=_FakeDb(_user(languagePreference="tr")),
        _=None,
    )
    for task in tasks.tasks:
        await task()

    assert len(sent) == 1
    to, username, url, language = sent[0]
    assert to == "movielover@example.com"
    assert username == "movielover"
    assert "/auth/reset-password?token=" in url
    # The account's app language reaches the builder (#98) — otherwise every
    # reset mail is English no matter what the app is set to.
    assert language == "tr"
