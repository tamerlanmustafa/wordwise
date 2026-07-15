"""
POST /student/verify — the discount may only be claimed for your own email.

Without the account-email check, anyone could post an arbitrary `*.edu`
string they don't control ("someone@harvard.edu") and get 50% off. Tying
the claim to the authenticated account's address means an OAuth user's
address is already provider-verified, and a password signup can at least
not claim someone else's institution.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.routes.student_discount import verify_student


class _FakeDb:
    """Records INSERTs so a rejected claim can be asserted to write nothing."""

    def __init__(self):
        self.writes: list[tuple] = []

    async def execute_raw(self, sql: str, *args):
        assert "INSERT INTO student_verifications" in sql
        self.writes.append(args)
        return 1


def _student(email: str):
    return SimpleNamespace(id=1, email=email, isActive=True, isAdmin=False)


def _body(email: str, school_name: str | None = None):
    return SimpleNamespace(email=email, school_name=school_name)


async def test_verifies_own_edu_email():
    user = _student("ada@mit.edu")
    db = _FakeDb()

    result = await verify_student(body=_body("ada@mit.edu"), current_user=user, db=db)

    assert result.verified is True
    assert result.discount_pct == 50
    assert result.method == "edu_email"
    assert len(db.writes) == 1


async def test_rejects_someone_elses_edu_email():
    """The claim-anyone's-school hole: a free-mail account posting a .edu
    address it doesn't own must be refused before any DB write."""
    user = _student("randomer@gmail.com")
    db = _FakeDb()

    with pytest.raises(HTTPException) as exc:
        await verify_student(body=_body("someone@harvard.edu"), current_user=user, db=db)

    assert exc.value.status_code == 400
    assert db.writes == [], "a rejected claim must not be recorded as verified"


async def test_rejects_edu_email_that_is_not_the_account_email():
    """Even an .edu account holder may only claim their *own* address."""
    user = _student("ada@mit.edu")
    db = _FakeDb()

    with pytest.raises(HTTPException) as exc:
        await verify_student(body=_body("someone-else@mit.edu"), current_user=user, db=db)

    assert exc.value.status_code == 400
    assert db.writes == []


@pytest.mark.parametrize("bad", ["", "   ", "not-an-email"])
async def test_rejects_malformed_email(bad):
    user = _student("ada@mit.edu")
    db = _FakeDb()

    with pytest.raises(HTTPException) as exc:
        await verify_student(body=_body(bad), current_user=user, db=db)

    assert exc.value.status_code == 400
    assert db.writes == []


async def test_matching_is_case_and_whitespace_insensitive():
    user = _student("ada@mit.edu")
    db = _FakeDb()

    result = await verify_student(body=_body("  Ada@MIT.edu"), current_user=user, db=db)

    assert result.verified is True


async def test_own_non_edu_email_gets_no_discount():
    """Not an error — just not a student. Must not grant the discount."""
    user = _student("someone@gmail.com")
    db = _FakeDb()

    result = await verify_student(body=_body("someone@gmail.com"), current_user=user, db=db)

    assert result.verified is False
    assert result.discount_pct == 0
    assert db.writes == []
