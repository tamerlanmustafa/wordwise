"""
Unit tests for the auth dependency chain: get_current_active_user,
get_admin_user.

We call the functions directly with fake user objects (from fixtures),
bypassing FastAPI's Depends resolution. No DB, no network, no Prisma.

These cover the auth-leak surface — the single highest-impact failure
in a backend like this (anyone-is-admin by accident).
"""
import pytest
from fastapi import HTTPException

from src.middleware.auth import get_admin_user, get_current_active_user


async def test_admin_user_accepts_admin(admin_user):
    result = await get_admin_user(current_user=admin_user)
    assert result is admin_user


async def test_admin_user_rejects_non_admin(test_user):
    with pytest.raises(HTTPException) as exc:
        await get_admin_user(current_user=test_user)
    assert exc.value.status_code == 403
    assert "admin" in exc.value.detail.lower()


async def test_active_user_rejects_inactive(inactive_user):
    with pytest.raises(HTTPException) as exc:
        await get_current_active_user(current_user=inactive_user)
    assert exc.value.status_code == 400


async def test_active_user_accepts_active(test_user):
    result = await get_current_active_user(current_user=test_user)
    assert result is test_user


async def test_admin_chain_rejects_inactive_admin(admin_user):
    """Even an admin must be active — inactive admin should be blocked by the
    active-user check before reaching the admin check."""
    admin_user.isActive = False
    with pytest.raises(HTTPException) as exc:
        await get_current_active_user(current_user=admin_user)
    assert exc.value.status_code == 400
