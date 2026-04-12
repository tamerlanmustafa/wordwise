"""
Feature flag and A/B test system.

Provides server-side feature flags with percentage-based rollout and
deterministic A/B variant assignment per user. Used for:
  - SRS preview variant (1/3/7 sessions)
  - Rewarded video rollout
  - Email digest opt-in
  - Student discount availability
  - Family plan availability

Admin-only CRUD for flags; user-facing read-only endpoint returns
all flags + assigned variants for the current user.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from prisma import Prisma

from ..database import get_db
from ..middleware.auth import get_current_active_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/flags", tags=["feature-flags"])


class FlagResponse(BaseModel):
    flag_key: str
    enabled: bool
    variant: Optional[str] = None


class FlagAdminResponse(BaseModel):
    id: int
    flag_key: str
    description: Optional[str]
    enabled: bool
    rollout_pct: int
    variants: Optional[dict] = None


class FlagCreateBody(BaseModel):
    flag_key: str
    description: Optional[str] = None
    enabled: bool = False
    rollout_pct: int = 100
    variants: Optional[dict] = None


class FlagUpdateBody(BaseModel):
    enabled: Optional[bool] = None
    rollout_pct: Optional[int] = None
    variants: Optional[dict] = None
    description: Optional[str] = None


def _assign_variant(user_id: int, flag_key: str, variants: dict) -> str:
    keys = sorted(variants.keys())
    seed = int(hashlib.md5(f"{user_id}:{flag_key}".encode()).hexdigest()[:8], 16)
    return keys[seed % len(keys)]


@router.get("/me", response_model=list[FlagResponse])
async def my_flags(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    rows = await db.query_raw(
        "SELECT flag_key, description, enabled, rollout_pct, variants FROM feature_flags"
    )

    existing = await db.query_raw(
        "SELECT flag_key, variant FROM user_feature_flags WHERE user_id = $1",
        current_user.id,
    )
    assigned = {r["flag_key"]: r["variant"] for r in existing}

    result = []
    for flag in rows:
        in_rollout = (current_user.id % 100) < flag["rollout_pct"]
        is_on = flag["enabled"] and in_rollout

        variant = None
        if is_on and flag.get("variants"):
            if flag["flag_key"] in assigned:
                variant = assigned[flag["flag_key"]]
            else:
                variant = _assign_variant(current_user.id, flag["flag_key"], flag["variants"])
                await db.execute_raw(
                    "INSERT INTO user_feature_flags (user_id, flag_key, variant) VALUES ($1, $2, $3) ON CONFLICT (user_id, flag_key) DO NOTHING",
                    current_user.id, flag["flag_key"], variant,
                )

        result.append(FlagResponse(flag_key=flag["flag_key"], enabled=is_on, variant=variant))

    return result


# ── Admin CRUD ──────────────────────────────────────────────────────────────

def _require_admin(user):
    if not (getattr(user, "isAdmin", False) or getattr(user, "is_admin", False)):
        raise HTTPException(403, "Admin only")


@router.get("/admin", response_model=list[FlagAdminResponse])
async def list_flags(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    _require_admin(current_user)
    rows = await db.query_raw("SELECT id, flag_key, description, enabled, rollout_pct, variants FROM feature_flags ORDER BY id")
    return [FlagAdminResponse(**r) for r in rows]


@router.post("/admin", response_model=FlagAdminResponse)
async def create_flag(
    body: FlagCreateBody,
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    _require_admin(current_user)
    import json
    v = json.dumps(body.variants) if body.variants else None
    await db.execute_raw(
        "INSERT INTO feature_flags (flag_key, description, enabled, rollout_pct, variants) VALUES ($1, $2, $3, $4, $5::jsonb)",
        body.flag_key, body.description, body.enabled, body.rollout_pct, v,
    )
    rows = await db.query_raw("SELECT id, flag_key, description, enabled, rollout_pct, variants FROM feature_flags WHERE flag_key = $1", body.flag_key)
    return FlagAdminResponse(**rows[0])


@router.patch("/admin/{flag_key}", response_model=FlagAdminResponse)
async def update_flag(
    flag_key: str,
    body: FlagUpdateBody,
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    _require_admin(current_user)
    import json
    sets, vals = [], []
    idx = 1
    if body.enabled is not None:
        idx += 1; sets.append(f"enabled = ${idx}"); vals.append(body.enabled)
    if body.rollout_pct is not None:
        idx += 1; sets.append(f"rollout_pct = ${idx}"); vals.append(body.rollout_pct)
    if body.description is not None:
        idx += 1; sets.append(f"description = ${idx}"); vals.append(body.description)
    if body.variants is not None:
        idx += 1; sets.append(f"variants = ${idx}::jsonb"); vals.append(json.dumps(body.variants))
    if not sets:
        raise HTTPException(400, "Nothing to update")
    sets.append("updated_at = NOW()")
    sql = f"UPDATE feature_flags SET {', '.join(sets)} WHERE flag_key = $1"
    await db.execute_raw(sql, flag_key, *vals)
    rows = await db.query_raw("SELECT id, flag_key, description, enabled, rollout_pct, variants FROM feature_flags WHERE flag_key = $1", flag_key)
    if not rows:
        raise HTTPException(404, "Flag not found")
    return FlagAdminResponse(**rows[0])


@router.delete("/admin/{flag_key}")
async def delete_flag(
    flag_key: str,
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    _require_admin(current_user)
    await db.execute_raw("DELETE FROM user_feature_flags WHERE flag_key = $1", flag_key)
    await db.execute_raw("DELETE FROM feature_flags WHERE flag_key = $1", flag_key)
    return {"deleted": flag_key}
