"""
Family plan endpoints.

Allows a premium subscriber to share their subscription with up to
4 additional family members (5 total including the owner). Members
get full premium access as long as the owner's subscription is active.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from prisma import Prisma

from ..database import get_db
from ..middleware.auth import get_current_active_user
from ..utils.subscription import is_premium

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/family", tags=["family"])

MAX_FAMILY_MEMBERS = 5


class FamilyPlanResponse(BaseModel):
    plan_id: int
    owner_id: int
    owner_email: str
    max_members: int
    members: list[dict]


class InviteBody(BaseModel):
    email: str


@router.get("/plan", response_model=Optional[FamilyPlanResponse])
async def get_family_plan(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    plan = await db.query_raw(
        """SELECT fp.id, fp.owner_id, fp.max_members, u.email as owner_email
           FROM family_plans fp JOIN users u ON fp.owner_id = u.id
           WHERE fp.owner_id = $1""",
        current_user.id,
    )

    if not plan:
        member = await db.query_raw(
            """SELECT fp.id, fp.owner_id, fp.max_members, u.email as owner_email
               FROM family_members fm
               JOIN family_plans fp ON fm.plan_id = fp.id
               JOIN users u ON fp.owner_id = u.id
               WHERE fm.user_id = $1""",
            current_user.id,
        )
        if not member:
            return None
        plan = member

    plan_row = plan[0]
    members = await db.query_raw(
        """SELECT fm.user_id, u.email, u.username, fm.joined_at
           FROM family_members fm JOIN users u ON fm.user_id = u.id
           WHERE fm.plan_id = $1 ORDER BY fm.joined_at""",
        plan_row["id"],
    )

    return FamilyPlanResponse(
        plan_id=plan_row["id"],
        owner_id=plan_row["owner_id"],
        owner_email=plan_row["owner_email"],
        max_members=plan_row["max_members"],
        members=[
            {"user_id": m["user_id"], "email": m["email"], "username": m["username"],
             "joined_at": str(m["joined_at"])}
            for m in members
        ],
    )


@router.post("/create", response_model=FamilyPlanResponse)
async def create_family_plan(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    if not is_premium(current_user):
        raise HTTPException(402, detail="Family plan requires an active WordWise Plus subscription.")

    existing = await db.query_raw(
        "SELECT id FROM family_plans WHERE owner_id = $1", current_user.id
    )
    if existing:
        raise HTTPException(400, detail="You already have a family plan.")

    await db.execute_raw(
        "INSERT INTO family_plans (owner_id, max_members) VALUES ($1, $2)",
        current_user.id, MAX_FAMILY_MEMBERS,
    )
    plan = await db.query_raw(
        "SELECT id FROM family_plans WHERE owner_id = $1", current_user.id
    )

    return FamilyPlanResponse(
        plan_id=plan[0]["id"],
        owner_id=current_user.id,
        owner_email=current_user.email,
        max_members=MAX_FAMILY_MEMBERS,
        members=[],
    )


@router.post("/invite")
async def invite_member(
    body: InviteBody,
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    plan = await db.query_raw(
        "SELECT id, max_members FROM family_plans WHERE owner_id = $1", current_user.id
    )
    if not plan:
        raise HTTPException(404, detail="You don't have a family plan. Create one first.")

    plan_row = plan[0]
    member_count = await db.query_raw(
        "SELECT COUNT(*) as cnt FROM family_members WHERE plan_id = $1", plan_row["id"]
    )
    if member_count[0]["cnt"] >= plan_row["max_members"] - 1:
        raise HTTPException(400, detail=f"Family plan is full ({plan_row['max_members']} members max).")

    invitee = await db.user.find_unique(where={"email": body.email})
    if not invitee:
        raise HTTPException(404, detail="No user found with that email.")
    if invitee.id == current_user.id:
        raise HTTPException(400, detail="You're already the plan owner.")

    already = await db.query_raw(
        "SELECT id FROM family_members WHERE plan_id = $1 AND user_id = $2",
        plan_row["id"], invitee.id,
    )
    if already:
        raise HTTPException(400, detail="This user is already in your family plan.")

    await db.execute_raw(
        "INSERT INTO family_members (plan_id, user_id) VALUES ($1, $2)",
        plan_row["id"], invitee.id,
    )
    await db.user.update(
        where={"id": invitee.id},
        data={"subscriptionTier": "comped"},
    )

    return {"success": True, "message": f"{body.email} added to your family plan."}


@router.post("/remove/{user_id}")
async def remove_member(
    user_id: int,
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    plan = await db.query_raw(
        "SELECT id FROM family_plans WHERE owner_id = $1", current_user.id
    )
    if not plan:
        raise HTTPException(404, detail="You don't have a family plan.")

    await db.execute_raw(
        "DELETE FROM family_members WHERE plan_id = $1 AND user_id = $2",
        plan[0]["id"], user_id,
    )
    await db.user.update(
        where={"id": user_id},
        data={"subscriptionTier": "free"},
    )

    return {"success": True, "message": "Member removed."}


@router.post("/leave")
async def leave_family(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    await db.execute_raw(
        "DELETE FROM family_members WHERE user_id = $1", current_user.id
    )
    await db.user.update(
        where={"id": current_user.id},
        data={"subscriptionTier": "free"},
    )
    return {"success": True, "message": "You've left the family plan."}
