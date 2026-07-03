"""
Unit tests for the auth request schemas — specifically the register-time
password policy. Pure pydantic validation; no DB.
"""
import pytest
from pydantic import ValidationError

from src.schemas.user import UserCreate


def _payload(password: str) -> dict:
    return {
        "email": "user@example.com",
        "username": "someone",
        "password": password,
    }


class TestPasswordPolicy:
    def test_eight_chars_accepted(self):
        user = UserCreate(**_payload("abcd1234"))
        assert user.password == "abcd1234"

    def test_short_password_rejected(self):
        with pytest.raises(ValidationError, match="at least 8 characters"):
            UserCreate(**_payload("short12"))

    def test_empty_password_rejected(self):
        with pytest.raises(ValidationError):
            UserCreate(**_payload(""))

    def test_72_bytes_accepted(self):
        UserCreate(**_payload("a" * 72))

    def test_over_72_bytes_rejected(self):
        # bcrypt silently truncates past 72 bytes — reject instead of
        # hashing a password the user didn't fully set.
        with pytest.raises(ValidationError, match="72 bytes"):
            UserCreate(**_payload("a" * 73))

    def test_byte_length_counts_multibyte_chars(self):
        # 25 euro signs = 25 characters but 75 UTF-8 bytes: must be rejected
        # even though the character count is under 72.
        with pytest.raises(ValidationError, match="72 bytes"):
            UserCreate(**_payload("€" * 25))

    def test_multibyte_within_byte_budget_accepted(self):
        # 20 euro signs = 60 bytes — fine.
        UserCreate(**_payload("€" * 20))
