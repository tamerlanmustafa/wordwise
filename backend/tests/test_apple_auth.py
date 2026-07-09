"""
Sign in with Apple — token verification + account find/create/link logic.

verify_apple_token is exercised with REAL RS256 tokens signed by a test RSA
key served through a monkeypatched JWKS, so signature, kid, iss, aud, exp and
alg-pinning paths all run for real (no mocked-out crypto).
"""
from __future__ import annotations

import time
from types import SimpleNamespace

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from jose import jwt, jwk

from src.utils import apple_auth
from src.utils.apple_auth import AppleAuthError, verify_apple_token
from src.routes.oauth import _create_or_update_apple_user

BUNDLE_ID = "com.wordwise.mobile"
KID = "test-key-1"


# ── RS256 fixture key + fake JWKS ───────────────────────────────────────────

@pytest.fixture(scope="module")
def rsa_pems():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    priv = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    pub = key.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return priv, pub


@pytest.fixture
def apple_jwks(rsa_pems, monkeypatch):
    _, pub = rsa_pems
    public_jwk = jwk.construct(pub.decode(), "RS256").to_dict()
    public_jwk["kid"] = KID
    monkeypatch.setattr(apple_auth, "_get_apple_jwks", lambda force_refresh=False: {"keys": [public_jwk]})


def make_token(priv_pem: bytes, *, kid: str = KID, alg: str = "RS256", **claim_overrides) -> str:
    claims = {
        "iss": apple_auth.APPLE_ISSUER,
        "aud": BUNDLE_ID,
        "sub": "001234.abcdef.5678",
        "email": "relay@privaterelay.appleid.com",
        "email_verified": "true",
        "exp": int(time.time()) + 600,
        "iat": int(time.time()),
    }
    claims.update(claim_overrides)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, priv_pem.decode(), algorithm=alg, headers={"kid": kid})


# ── verify_apple_token ──────────────────────────────────────────────────────

def test_valid_token_verifies(apple_jwks, rsa_pems):
    priv, _ = rsa_pems
    info = verify_apple_token(make_token(priv), BUNDLE_ID)
    assert info["apple_id"] == "001234.abcdef.5678"
    assert info["email"] == "relay@privaterelay.appleid.com"
    assert info["email_verified"] is True  # "true" string coerced to bool


def test_wrong_audience_rejected(apple_jwks, rsa_pems):
    priv, _ = rsa_pems
    with pytest.raises(AppleAuthError):
        verify_apple_token(make_token(priv, aud="com.evil.app"), BUNDLE_ID)


def test_wrong_issuer_rejected(apple_jwks, rsa_pems):
    priv, _ = rsa_pems
    with pytest.raises(AppleAuthError):
        verify_apple_token(make_token(priv, iss="https://evil.example.com"), BUNDLE_ID)


def test_expired_token_rejected(apple_jwks, rsa_pems):
    priv, _ = rsa_pems
    with pytest.raises(AppleAuthError):
        verify_apple_token(make_token(priv, exp=int(time.time()) - 60), BUNDLE_ID)


def test_non_rs256_alg_rejected(apple_jwks):
    # Alg-confusion guard: an HS256 token must be rejected by the header
    # check before any key lookup happens.
    hs_token = jwt.encode(
        {"iss": apple_auth.APPLE_ISSUER, "aud": BUNDLE_ID, "sub": "x",
         "exp": int(time.time()) + 600},
        "some-shared-secret",
        algorithm="HS256",
        headers={"kid": KID},
    )
    with pytest.raises(AppleAuthError, match="algorithm"):
        verify_apple_token(hs_token, BUNDLE_ID)


def test_unknown_kid_rejected(apple_jwks, rsa_pems):
    priv, _ = rsa_pems
    with pytest.raises(AppleAuthError, match="signing key"):
        verify_apple_token(make_token(priv, kid="rotated-away"), BUNDLE_ID)


def test_email_absent_on_repeat_login_ok(apple_jwks, rsa_pems):
    priv, _ = rsa_pems
    info = verify_apple_token(make_token(priv, email=None, email_verified=None), BUNDLE_ID)
    assert info["email"] is None


# ── _create_or_update_apple_user (fake db) ──────────────────────────────────

class _FakeUserTable:
    def __init__(self, users):
        self.users = users
        self.created = None
        self.updated = None

    async def find_first(self, where):
        return next((u for u in self.users if all(getattr(u, k, None) == v for k, v in where.items())), None)

    async def find_unique(self, where):
        return await self.find_first(where)

    async def create(self, data):
        self.created = data
        return SimpleNamespace(id=99, nativeLanguage=None, learningLanguage=None, **data)

    async def update(self, where, data):
        self.updated = (where, data)
        base = await self.find_first(where)
        for k, v in data.items():
            setattr(base, k, v)
        return base


class _FakeDb:
    def __init__(self, users=()):
        self.user = _FakeUserTable(list(users))


def _existing(**over):
    defaults = dict(
        id=7, email="jane@example.com", username="jane", appleId=None,
        googleId=None, nativeLanguage=None, learningLanguage=None,
        oauthProvider="email",
    )
    defaults.update(over)
    return SimpleNamespace(**defaults)


async def test_new_user_created_from_first_auth():
    db = _FakeDb()
    user, is_new = await _create_or_update_apple_user(
        {"apple_id": "apl-1", "email": "new@x.com", "email_verified": True},
        db, full_name="Jane Appleseed",
    )
    assert is_new is True
    assert db.user.created["appleId"] == "apl-1"
    assert db.user.created["oauthProvider"] == "apple"
    assert db.user.created["username"] == "jane_appleseed"


async def test_links_existing_account_by_verified_email():
    existing = _existing()
    db = _FakeDb([existing])
    user, is_new = await _create_or_update_apple_user(
        {"apple_id": "apl-2", "email": "jane@example.com", "email_verified": True}, db,
    )
    assert is_new is False
    where, data = db.user.updated
    assert where == {"id": 7} and data["appleId"] == "apl-2"


async def test_does_not_link_by_unverified_email():
    """An unverified email must never attach Apple login to someone else's
    account (account-takeover guard) — and with no other identity available
    the login is refused outright."""
    db = _FakeDb([_existing()])
    with pytest.raises(HTTPException) as exc:
        await _create_or_update_apple_user(
            {"apple_id": "apl-3", "email": "jane@example.com", "email_verified": False}, db,
        )
    # 409 (not 500): falls through to the "cannot create without trusted
    # email" branch instead of linking.
    assert exc.value.status_code == 409
    assert db.user.updated is None and db.user.created is None


async def test_repeat_login_matches_by_apple_id_without_email():
    db = _FakeDb([_existing(appleId="apl-4")])
    user, is_new = await _create_or_update_apple_user(
        {"apple_id": "apl-4", "email": None, "email_verified": False}, db,
    )
    assert is_new is False and user.id == 7


async def test_unknown_apple_id_without_email_is_409():
    db = _FakeDb()
    with pytest.raises(HTTPException) as exc:
        await _create_or_update_apple_user(
            {"apple_id": "apl-5", "email": None, "email_verified": False}, db,
        )
    assert exc.value.status_code == 409
