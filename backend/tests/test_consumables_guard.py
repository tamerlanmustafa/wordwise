"""
POST /consumables/freeze-pack/debug-grant — fail-closed guard.

debug-grant hands out real inventory with no receipt, so it must be
unreachable unless an operator explicitly opts in via ENABLE_DEBUG_GRANTS
(admins always bypass). The failure mode to guard against is fail-open:
a missing/garbled env var in prod silently minting free consumables.
"""
from __future__ import annotations

import importlib
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.routes import consumables


@pytest.fixture
def granted():
    """Stub the streak-service writes; record each granted freeze."""
    return []


@pytest.fixture(autouse=True)
def _stub_streak_service(monkeypatch, granted):
    async def count_held_freezes(db, user_id):
        return 0

    async def grant_freeze(db, *, user_id, via, now):
        granted.append((user_id, via))

    monkeypatch.setattr(consumables, "count_held_freezes", count_held_freezes)
    monkeypatch.setattr(consumables, "grant_freeze", grant_freeze)


async def test_non_admin_denied_when_flag_off(monkeypatch, test_user, granted):
    monkeypatch.setattr(consumables, "DEBUG_GRANTS_ENABLED", False)

    with pytest.raises(HTTPException) as exc:
        await consumables.debug_grant_freeze_pack(current_user=test_user, db=None)

    assert exc.value.status_code == 403
    assert granted == [], "no inventory may be credited when the guard denies"


async def test_admin_bypasses_flag(monkeypatch, admin_user, granted):
    monkeypatch.setattr(consumables, "DEBUG_GRANTS_ENABLED", False)

    result = await consumables.debug_grant_freeze_pack(current_user=admin_user, db=None)

    assert result.credited == consumables.FREEZE_PACK_SIZE
    assert granted == [(admin_user.id, "debug_grant")] * consumables.FREEZE_PACK_SIZE


async def test_non_admin_allowed_when_flag_on(monkeypatch, test_user, granted):
    monkeypatch.setattr(consumables, "DEBUG_GRANTS_ENABLED", True)

    result = await consumables.debug_grant_freeze_pack(current_user=test_user, db=None)

    assert result.credited == consumables.FREEZE_PACK_SIZE
    assert len(granted) == consumables.FREEZE_PACK_SIZE


async def test_credits_are_capped(monkeypatch, admin_user, granted):
    """Near the cap, only the remaining room is credited — and `capped` says so."""
    async def count_held_freezes(db, user_id):
        return consumables.MAX_FREEZES_HELD - 2

    monkeypatch.setattr(consumables, "count_held_freezes", count_held_freezes)
    monkeypatch.setattr(consumables, "DEBUG_GRANTS_ENABLED", True)

    result = await consumables.debug_grant_freeze_pack(current_user=admin_user, db=None)

    assert result.credited == 2
    assert result.freezes_held == consumables.MAX_FREEZES_HELD
    assert result.capped is True


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("1", True),
        ("true", True),
        ("TRUE", True),
        ("", False),       # unset
        ("0", False),
        ("false", False),
        ("yes", False),    # not an accepted truthy spelling — stay closed
        ("maybe", False),  # garbage must never open the gate
    ],
)
def test_env_flag_parsing_defaults_closed(monkeypatch, raw, expected):
    """Only an explicit 1/true opens debug grants; everything else, including
    a typo'd or absent value, must resolve to False."""
    monkeypatch.setenv("ENABLE_DEBUG_GRANTS", raw)
    try:
        reloaded = importlib.reload(consumables)
        assert reloaded.DEBUG_GRANTS_ENABLED is expected
    finally:
        # Restore the module to the ambient env so later tests (and the
        # router object registered on the app) see the original state.
        monkeypatch.undo()
        importlib.reload(consumables)


def test_env_flag_absent_defaults_closed(monkeypatch):
    monkeypatch.delenv("ENABLE_DEBUG_GRANTS", raising=False)
    try:
        reloaded = importlib.reload(consumables)
        assert reloaded.DEBUG_GRANTS_ENABLED is False
    finally:
        monkeypatch.undo()
        importlib.reload(consumables)


async def test_apple_and_google_verify_are_not_grant_paths(test_user):
    """Receipt validation is still stubbed — it must 501, never credit."""
    body = SimpleNamespace(receipt_data="x", product_id="wordwise.freeze_pack_5")

    with pytest.raises(HTTPException) as exc:
        await consumables.verify_apple_freeze_pack(
            _body=body, _current_user=test_user, _db=None
        )
    assert exc.value.status_code == 501

    with pytest.raises(HTTPException) as exc:
        await consumables.verify_google_freeze_pack(
            _body=body, _current_user=test_user, _db=None
        )
    assert exc.value.status_code == 501
