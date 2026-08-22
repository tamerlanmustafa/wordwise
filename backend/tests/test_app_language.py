"""`users.language_preference` as the app UI language (#98).

The column existed but nothing read or validated it — it was written as a
hard-coded "en" at signup and ignored. Now it decides which language a user's
transactional email is written in and what a fresh install comes up in, so the
write paths need to agree on what a valid value is.

Same strategy as test_auth_guards.py / test_password_reset.py: call the route
functions directly against fake Prisma surfaces. No DB, no network.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks, HTTPException

from src.routes import auth as auth_routes
from src.routes import oauth as oauth_routes
from src.routes.auth import register, update_user_profile
from src.schemas.oauth import AppleLoginRequest, GoogleLoginRequest
from src.schemas.user import UserCreate, UserUpdate


def _user(**overrides) -> SimpleNamespace:
    base = dict(
        id=7,
        email="movielover@example.com",
        username="movielover",
        passwordHash="$2b$12$fake",
        languagePreference=None,
        nativeLanguage="en",
        learningLanguage="en",
        proficiencyLevel="B1",
        defaultTab="movies",
        isActive=True,
        isAdmin=False,
        createdAt=None,
        profilePictureUrl=None,
        oauthProvider="email",
        googleId=None,
        appleId=None,
        subscriptionTier=None,
        subscriptionExpiresAt=None,
        adsEligible=True,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


class _FakeUserTable:
    def __init__(self, user=None):
        self._user = user
        self.updates: list[dict] = []
        self.creates: list[dict] = []

    async def find_unique(self, where):
        u = self._user
        if u is None:
            return None
        if where.get("id") == u.id or where.get("email") == u.email:
            return u
        if where.get("username") == u.username:
            return u
        return None

    async def find_first(self, where):
        return None

    async def update(self, where, data):
        self.updates.append(data)
        for k, v in data.items():
            setattr(self._user, k, v)
        return self._user

    async def create(self, data):
        self.creates.append(data)
        self._user = _user(**{k: v for k, v in data.items() if k != "passwordHash"})
        self._user.passwordHash = data.get("passwordHash")
        return self._user


class _FakeDb:
    def __init__(self, user=None):
        self.user = _FakeUserTable(user)


# ── PATCH /auth/me ──────────────────────────────────────────────────────────

class TestProfileUpdate:
    @pytest.mark.parametrize(
        "sent,stored",
        [("es", "es"), ("PT", "pt"), ("pt-BR", "pt"), ("ru_RU", "ru")],
    )
    async def test_stores_the_normalized_code(self, sent, stored):
        db = _FakeDb(_user())
        await update_user_profile(
            UserUpdate(language_preference=sent), current_user=db.user._user, db=db
        )
        assert db.user.updates == [{"languagePreference": stored}]

    async def test_empty_string_clears_the_pin(self):
        # Settings' "follow my translation language" reset. `None` can't mean
        # this — it already means "this PATCH doesn't touch the field".
        db = _FakeDb(_user(languagePreference="tr"))
        await update_user_profile(
            UserUpdate(language_preference=""), current_user=db.user._user, db=db
        )
        assert db.user.updates == [{"languagePreference": None}]

    @pytest.mark.parametrize("bad", ["klingon", "de", "zh-Hans", "ar"])
    async def test_rejects_a_locale_we_do_not_ship(self, bad):
        # 'ar' is in the app but `preview: true`, so it must not be storable
        # yet: an account pinned to Arabic would come up in unverified RTL.
        db = _FakeDb(_user())
        with pytest.raises(HTTPException) as exc:
            await update_user_profile(
                UserUpdate(language_preference=bad), current_user=db.user._user, db=db
            )
        assert exc.value.status_code == 400
        assert db.user.updates == []

    async def test_response_carries_the_mapped_fields(self):
        # Regression: the route used to return the Prisma object, so FastAPI
        # read snake_case attributes that don't exist on it and every mapped
        # field serialized as null — the client kept its pre-edit value and the
        # save looked like it had silently failed.
        db = _FakeDb(_user(nativeLanguage="tr"))
        res = await update_user_profile(
            UserUpdate(language_preference="es"), current_user=db.user._user, db=db
        )
        assert res.language_preference == "es"
        assert res.native_language == "tr"

    async def test_empty_patch_still_returns_a_mapped_response(self):
        db = _FakeDb(_user(languagePreference="ru", nativeLanguage="ru"))
        res = await update_user_profile(UserUpdate(), current_user=db.user._user, db=db)
        assert db.user.updates == []
        assert res.language_preference == "ru"
        assert res.native_language == "ru"


# ── Signup: the welcome email is sent before Settings ever exists ───────────

class TestRegister:
    async def _register(self, monkeypatch, language_preference):
        sent: list[tuple] = []

        async def _fake_send(to, username, language=None):
            sent.append((to, username, language))
            return True

        async def _fake_hash(pw):
            return "$2b$12$fake"

        monkeypatch.setattr(auth_routes.email_service, "send_welcome_email", _fake_send)
        monkeypatch.setattr(auth_routes, "get_password_hash_async", _fake_hash)

        db = _FakeDb(None)
        tasks = BackgroundTasks()
        await register(
            UserCreate(
                email="new@example.com",
                username="newcomer",
                password="a-long-enough-pass",
                language_preference=language_preference,
            ),
            background_tasks=tasks,
            db=db,
        )
        for task in tasks.tasks:
            await task()
        return db, sent

    async def test_signup_language_reaches_the_welcome_email(self, monkeypatch):
        db, sent = await self._register(monkeypatch, "es")
        assert db.user.creates[0]["languagePreference"] == "es"
        assert sent == [("new@example.com", "newcomer", "es")]

    async def test_unshipped_locale_is_dropped_not_rejected(self, monkeypatch):
        # A client one release ahead of the server must still be able to create
        # accounts; the preference is simply not stored.
        db, sent = await self._register(monkeypatch, "klingon")
        assert db.user.creates[0]["languagePreference"] is None
        assert sent[0][2] is None

    async def test_omitting_it_stores_nothing(self, monkeypatch):
        db, sent = await self._register(monkeypatch, None)
        assert db.user.creates[0]["languagePreference"] is None


# ── OAuth signup carries it too ─────────────────────────────────────────────

class TestOAuthRequests:
    @pytest.mark.parametrize("model", [GoogleLoginRequest, AppleLoginRequest])
    def test_app_language_is_normalized_on_the_way_in(self, model):
        kwargs = {"id_token": "t"} if model is GoogleLoginRequest else {"identity_token": "t"}
        assert model(**kwargs, app_language="pt-BR").app_language == "pt"
        assert model(**kwargs, app_language="klingon").app_language is None
        assert model(**kwargs).app_language is None

    async def test_google_signup_seeds_the_account_language(self):
        db = _FakeDb(None)
        user, is_new = await oauth_routes._create_or_update_user(
            {"google_id": "g1", "email": "g@example.com", "picture": None},
            db,
            app_language="ru",
        )
        assert is_new is True
        assert db.user.creates[0]["languagePreference"] == "ru"

    async def test_existing_account_keeps_the_language_it_already_has(self):
        # Signing in on a second device must not overwrite the pin the user set
        # on the first one — same rule the native/learning fields follow.
        db = _FakeDb(_user(googleId="g1", languagePreference="tr"))
        await oauth_routes._create_or_update_user(
            {"google_id": "g1", "email": "movielover@example.com", "picture": None},
            db,
            app_language="ru",
        )
        assert db.user._user.languagePreference == "tr"
