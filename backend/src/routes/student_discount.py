"""
Student discount scaffold.

Provides 50% discount verification via SheerID or .edu email validation.

SETUP REQUIRED:
  - SHEERID_PROGRAM_ID: SheerID program ID
  - SHEERID_API_KEY: SheerID API key

Without SheerID credentials, falls back to .edu email verification.
"""

from __future__ import annotations

import os
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from prisma import Prisma

from ..database import get_db
from ..middleware.auth import get_current_active_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/student", tags=["student-discount"])

SHEERID_PROGRAM_ID = os.environ.get("SHEERID_PROGRAM_ID", "")
SHEERID_API_KEY = os.environ.get("SHEERID_API_KEY", "")


class StudentVerifyBody(BaseModel):
    email: str
    school_name: str | None = None


class StudentStatusResponse(BaseModel):
    verified: bool
    method: str | None = None
    discount_pct: int = 0
    verified_at: str | None = None


@router.get("/status", response_model=StudentStatusResponse)
async def student_status(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    rows = await db.query_raw(
        """SELECT verified, method, verified_at FROM student_verifications
           WHERE user_id = $1 AND verified = true
           ORDER BY verified_at DESC LIMIT 1""",
        current_user.id,
    )

    # Ensure table exists on first call
    await db.execute_raw(
        """CREATE TABLE IF NOT EXISTS student_verifications (
            id SERIAL PRIMARY KEY,
            user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            email VARCHAR(255),
            method VARCHAR(20) NOT NULL,
            verified BOOLEAN DEFAULT false,
            verified_at TIMESTAMPTZ,
            expires_at TIMESTAMPTZ,
            UNIQUE(user_id, method)
        )"""
    )

    if rows and rows[0]["verified"]:
        return StudentStatusResponse(
            verified=True,
            method=rows[0]["method"],
            discount_pct=50,
            verified_at=str(rows[0]["verified_at"]),
        )

    return StudentStatusResponse(verified=False)


@router.post("/verify", response_model=StudentStatusResponse)
async def verify_student(
    body: StudentVerifyBody,
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    await db.execute_raw(
        """CREATE TABLE IF NOT EXISTS student_verifications (
            id SERIAL PRIMARY KEY,
            user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            email VARCHAR(255),
            method VARCHAR(20) NOT NULL,
            verified BOOLEAN DEFAULT false,
            verified_at TIMESTAMPTZ,
            expires_at TIMESTAMPTZ,
            UNIQUE(user_id, method)
        )"""
    )

    if SHEERID_PROGRAM_ID and SHEERID_API_KEY:
        # TODO: Call SheerID verification API
        # import httpx
        # async with httpx.AsyncClient() as client:
        #     resp = await client.post(
        #         f"https://services.sheerid.com/rest/v2/program/{SHEERID_PROGRAM_ID}/step/collectStudentPersonalInfo",
        #         headers={"Authorization": f"Bearer {SHEERID_API_KEY}"},
        #         json={"email": body.email, "organization": {"name": body.school_name or ""}}
        #     )
        #     result = resp.json()
        #     verified = result.get("currentStep") == "success"

        return StudentStatusResponse(
            verified=False,
            method="sheerid",
            discount_pct=0,
            verified_at=None,
        )

    edu_domains = [".edu", ".ac.uk", ".edu.au", ".edu.tr", ".edu.br", ".edu.in", ".ac.in"]
    is_edu = any(body.email.lower().endswith(d) for d in edu_domains)

    if is_edu:
        now = datetime.now(timezone.utc)
        await db.execute_raw(
            """INSERT INTO student_verifications (user_id, email, method, verified, verified_at)
               VALUES ($1, $2, 'edu_email', true, $3)
               ON CONFLICT (user_id, method)
               DO UPDATE SET email = $2, verified = true, verified_at = $3""",
            current_user.id, body.email, now,
        )
        return StudentStatusResponse(
            verified=True,
            method="edu_email",
            discount_pct=50,
            verified_at=now.isoformat(),
        )

    return StudentStatusResponse(
        verified=False,
        method="edu_email",
        discount_pct=0,
    )
