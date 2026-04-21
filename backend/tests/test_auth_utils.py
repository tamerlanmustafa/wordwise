"""
Pure unit tests for JWT helpers in src/utils/auth.py.

No DB, no Prisma import, no network. If these break, the bug is in our
token primitives.

Password-hashing tests are intentionally omitted here — they exercise
passlib/bcrypt behavior, which has known cross-version quirks that don't
reflect our code. Add those under an integration marker if needed.
"""
from datetime import timedelta

from src.utils.auth import create_access_token, verify_token


def test_access_token_round_trip():
    token = create_access_token({"sub": "42"})
    payload = verify_token(token)
    assert payload is not None
    assert payload["sub"] == "42"
    assert "exp" in payload


def test_verify_token_rejects_garbage():
    assert verify_token("not-a-real-token") is None
    assert verify_token("") is None


def test_access_token_honors_explicit_expiry():
    token = create_access_token({"sub": "1"}, expires_delta=timedelta(seconds=-1))
    # Already-expired token must fail verification.
    assert verify_token(token) is None


def test_access_token_preserves_custom_claims():
    token = create_access_token({"sub": "7", "is_admin": True, "email": "a@b.c"})
    payload = verify_token(token)
    assert payload["sub"] == "7"
    assert payload["is_admin"] is True
    assert payload["email"] == "a@b.c"
