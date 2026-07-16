"""
Email verification flow: token discipline, the /auth/verify-email landing
endpoint, resend, and the signup hooks that queue emails.

Same strategy as test_auth_guards.py — call the route functions directly
with fake Prisma surfaces; no DB, no network (email_service is monkeypatched
or left in its no-key no-op mode).
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks, HTTPException

from src.middleware.auth import get_current_user
from src.routes import auth as auth_routes
from src.routes.auth import (
    build_verify_email_url,
    register,
    resend_verification,
    send_signup_emails,
    verify_email,
)
from src.schemas.user import UserCreate
from src.utils.auth import (
    create_access_token,
    create_email_verification_token,
    verify_token,
)


def _user(**overrides) -> SimpleNamespace:
    base = dict(
        id=7,
        email="new@example.com",
        username="newbie",
        emailVerified=False,
        isActive=True,
        isAdmin=False,
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


# ── Token discipline ────────────────────────────────────────────────────────

def test_verification_token_is_single_purpose():
    token = create_email_verification_token({"sub": "7", "email": "new@example.com"})
    payload = verify_token(token)
    assert payload["type"] == "email_verify"


async def test_verification_token_rejected_as_bearer():
    """A leaked verify link must never authenticate API requests."""
    user = _user()
    token = create_email_verification_token({"sub": str(user.id), "email": user.email})
    with pytest.raises(HTTPException) as exc:
        await get_current_user(token=token, db=_FakeDb(user))
    assert exc.value.status_code == 401


def test_verify_url_points_at_the_endpoint():
    url = build_verify_email_url(_user())
    assert "/auth/verify-email?token=" in url


# ── GET /auth/verify-email ──────────────────────────────────────────────────

async def test_verify_email_happy_path_marks_verified():
    user = _user()
    db = _FakeDb(user)
    token = create_email_verification_token({"sub": str(user.id), "email": user.email})

    res = await verify_email(token=token, db=db, _=None)

    assert res.status_code == 200
    assert len(db.user.updates) == 1
    assert db.user.updates[0]["data"]["emailVerified"] is True
    assert user.emailVerified is True


async def test_verify_email_is_idempotent():
    user = _user(emailVerified=True)
    db = _FakeDb(user)
    token = create_email_verification_token({"sub": str(user.id), "email": user.email})

    res = await verify_email(token=token, db=db, _=None)

    assert res.status_code == 200  # same success page…
    assert db.user.updates == []   # …but no second write


async def test_verify_email_rejects_access_token():
    user = _user()
    db = _FakeDb(user)
    token = create_access_token({"sub": str(user.id), "email": user.email})

    res = await verify_email(token=token, db=db, _=None)

    assert res.status_code == 400
    assert db.user.updates == []


async def test_verify_email_rejects_garbage():
    res = await verify_email(token="not-a-jwt", db=_FakeDb(_user()), _=None)
    assert res.status_code == 400


async def test_verify_email_rejects_stale_email_claim():
    """A link minted before the user changed address must not verify the
    new address."""
    user = _user(email="changed@example.com")
    db = _FakeDb(user)
    token = create_email_verification_token({"sub": str(user.id), "email": "new@example.com"})

    res = await verify_email(token=token, db=db, _=None)

    assert res.status_code == 400
    assert db.user.updates == []


# ── POST /auth/resend-verification ──────────────────────────────────────────

async def test_resend_queues_email_for_unverified_user():
    tasks = BackgroundTasks()
    res = await resend_verification(background_tasks=tasks, current_user=_user(), _=None)
    assert res == {"status": "sent"}
    assert len(tasks.tasks) == 1


async def test_resend_noops_for_verified_user():
    tasks = BackgroundTasks()
    res = await resend_verification(
        background_tasks=tasks, current_user=_user(emailVerified=True), _=None
    )
    assert res == {"status": "already_verified"}
    assert tasks.tasks == []


# ── POST /auth/register queues the signup emails ────────────────────────────

class _EmptyUserTable(_FakeUserTable):
    """find_unique always misses (email + username free), create records."""

    def __init__(self, created_user):
        super().__init__(None)
        self._created = created_user

    async def create(self, data):
        return self._created


async def test_register_queues_signup_emails():
    created = _user()
    db = SimpleNamespace(user=_EmptyUserTable(created))
    tasks = BackgroundTasks()

    payload = UserCreate(
        email="new@example.com",
        username="newbie",
        password="hunter2hunter2",
    )
    res = await register(user_data=payload, background_tasks=tasks, db=db, _=None)

    assert res["user"] is created
    assert len(tasks.tasks) == 1
    assert tasks.tasks[0].func is send_signup_emails


async def test_send_signup_emails_sends_welcome_and_verification(monkeypatch):
    sent: list[tuple] = []

    async def _fake_welcome(to, username):
        sent.append(("welcome", to))
        return True

    async def _fake_verification(to, username, url):
        sent.append(("verification", to, url))
        return True

    monkeypatch.setattr(auth_routes.email_service, "send_welcome_email", _fake_welcome)
    monkeypatch.setattr(auth_routes.email_service, "send_verification_email", _fake_verification)

    await send_signup_emails(_user())

    kinds = [s[0] for s in sent]
    assert kinds == ["welcome", "verification"]
    assert "/auth/verify-email?token=" in sent[1][2]
