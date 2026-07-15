"""
POST /family/remove/{user_id} — ownership enforcement.

The removal flow deletes a `family_members` row and then downgrades that
user's tier. The DELETE was always scoped to the caller's plan, but the
downgrade after it was not: it ran for whatever `user_id` was in the path,
so any plan owner could drop an arbitrary account — including someone
else's paying subscriber — to `free`. These tests pin the ownership check
that gates both writes.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.routes.family import remove_member


class _FakeDb:
    """Just enough Prisma surface for remove_member: the two raw reads, the
    raw DELETE, and user.update. Records every write so a test can assert
    that a rejected call wrote nothing."""

    def __init__(self, *, plans=None, members=()):
        self._plans = plans or {}          # owner_id -> plan_id
        self._members = set(members)       # {(plan_id, user_id)}
        self.deletes: list[tuple] = []
        self.updates: list[tuple] = []
        self.user = SimpleNamespace(update=self._update)

    async def query_raw(self, sql: str, *args):
        if "FROM family_plans" in sql:
            plan_id = self._plans.get(args[0])
            return [{"id": plan_id}] if plan_id is not None else []
        if "FROM family_members" in sql:
            return [{"id": 99}] if (args[0], args[1]) in self._members else []
        raise AssertionError(f"unexpected query_raw: {sql}")

    async def execute_raw(self, sql: str, *args):
        if sql.strip().startswith("DELETE FROM family_members"):
            self._members.discard((args[0], args[1]))
            self.deletes.append(args)
            return 1
        raise AssertionError(f"unexpected execute_raw: {sql}")

    async def _update(self, where, data):
        self.updates.append((where, data))


@pytest.fixture
def owner():
    """A plan owner (plan id 10) — the caller in these tests."""
    return SimpleNamespace(id=1, email="owner@example.com", isActive=True, isAdmin=False)


async def test_removes_a_real_member(owner):
    db = _FakeDb(plans={owner.id: 10}, members={(10, 7)})

    result = await remove_member(user_id=7, current_user=owner, db=db)

    assert result["success"] is True
    assert db.deletes == [(10, 7)]
    assert db.updates == [({"id": 7}, {"subscriptionTier": "free"})]


async def test_rejects_user_who_is_not_in_your_plan(owner):
    """The IDOR regression: user 8 exists but belongs to nobody's plan here.
    The caller owns a plan, so the old code fell straight through to the
    downgrade and set user 8 to `free`."""
    db = _FakeDb(plans={owner.id: 10}, members={(10, 7)})

    with pytest.raises(HTTPException) as exc:
        await remove_member(user_id=8, current_user=owner, db=db)

    assert exc.value.status_code == 404
    assert db.updates == [], "a non-member's tier must never be touched"
    assert db.deletes == []


async def test_rejects_member_of_someone_elses_plan(owner):
    """User 7 is in plan 20, which this caller does not own."""
    db = _FakeDb(plans={owner.id: 10}, members={(20, 7)})

    with pytest.raises(HTTPException) as exc:
        await remove_member(user_id=7, current_user=owner, db=db)

    assert exc.value.status_code == 404
    assert db.updates == []
    assert db.deletes == []


async def test_rejects_caller_without_a_plan(owner):
    db = _FakeDb(plans={}, members={(10, 7)})

    with pytest.raises(HTTPException) as exc:
        await remove_member(user_id=7, current_user=owner, db=db)

    assert exc.value.status_code == 404
    assert db.updates == []
    assert db.deletes == []
