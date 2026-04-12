"""
Email digest scaffold.

Sends daily digest emails with Today's Word + review reminder.
Requires an email service provider (SendGrid, SES, or similar).

SETUP REQUIRED:
  - EMAIL_PROVIDER: "sendgrid" or "ses"
  - SENDGRID_API_KEY: SendGrid API key (if using SendGrid)
  - AWS_SES_REGION: AWS region (if using SES)
  - EMAIL_FROM: sender address (e.g., "wordwise@yourdomain.com")
"""

from __future__ import annotations

import os
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from prisma import Prisma

from ..database import get_db
from ..middleware.auth import get_current_active_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/email", tags=["email"])

EMAIL_PROVIDER = os.environ.get("EMAIL_PROVIDER", "")
SENDGRID_API_KEY = os.environ.get("SENDGRID_API_KEY", "")
EMAIL_FROM = os.environ.get("EMAIL_FROM", "noreply@wordwise.app")


class DigestPrefsBody(BaseModel):
    daily_digest: bool = True
    review_reminder: bool = True


class DigestPrefsResponse(BaseModel):
    daily_digest: bool
    review_reminder: bool
    email: str


@router.get("/preferences", response_model=DigestPrefsResponse)
async def get_email_prefs(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    prefs = await db.query_raw(
        "SELECT daily_digest, review_reminder FROM email_preferences WHERE user_id = $1",
        current_user.id,
    )
    if prefs:
        return DigestPrefsResponse(
            daily_digest=prefs[0]["daily_digest"],
            review_reminder=prefs[0]["review_reminder"],
            email=current_user.email,
        )
    return DigestPrefsResponse(
        daily_digest=False,
        review_reminder=False,
        email=current_user.email,
    )


@router.post("/preferences", response_model=DigestPrefsResponse)
async def update_email_prefs(
    body: DigestPrefsBody,
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    # Ensure email_preferences table exists
    await db.execute_raw(
        """CREATE TABLE IF NOT EXISTS email_preferences (
            id SERIAL PRIMARY KEY,
            user_id INT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            daily_digest BOOLEAN DEFAULT false,
            review_reminder BOOLEAN DEFAULT false,
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )"""
    )

    await db.execute_raw(
        """INSERT INTO email_preferences (user_id, daily_digest, review_reminder)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id)
           DO UPDATE SET daily_digest = $2, review_reminder = $3, updated_at = NOW()""",
        current_user.id, body.daily_digest, body.review_reminder,
    )

    return DigestPrefsResponse(
        daily_digest=body.daily_digest,
        review_reminder=body.review_reminder,
        email=current_user.email,
    )


async def send_email(to: str, subject: str, html_body: str) -> bool:
    """
    Send an email via the configured provider.
    Returns True on success, False on failure.
    """
    if not EMAIL_PROVIDER:
        logger.warning("Email sending not configured. Set EMAIL_PROVIDER env var.")
        return False

    if EMAIL_PROVIDER == "sendgrid":
        if not SENDGRID_API_KEY:
            logger.warning("SENDGRID_API_KEY not set.")
            return False

        # TODO: Uncomment when sendgrid is installed
        # import sendgrid
        # from sendgrid.helpers.mail import Mail
        # sg = sendgrid.SendGridAPIClient(api_key=SENDGRID_API_KEY)
        # message = Mail(from_email=EMAIL_FROM, to_emails=to, subject=subject, html_content=html_body)
        # response = sg.send(message)
        # return response.status_code in (200, 201, 202)
        logger.info(f"SendGrid email would be sent to {to}: {subject}")
        return False

    elif EMAIL_PROVIDER == "ses":
        # TODO: Uncomment when boto3 is installed
        # import boto3
        # ses = boto3.client('ses', region_name=os.environ.get('AWS_SES_REGION', 'us-east-1'))
        # ses.send_email(
        #     Source=EMAIL_FROM,
        #     Destination={'ToAddresses': [to]},
        #     Message={
        #         'Subject': {'Data': subject},
        #         'Body': {'Html': {'Data': html_body}}
        #     }
        # )
        logger.info(f"SES email would be sent to {to}: {subject}")
        return False

    return False


@router.post("/send-digest")
async def trigger_digest(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """
    Admin-only: trigger a digest send for all opted-in users.
    In production, this would be called by a cron job.
    """
    if not (getattr(current_user, "isAdmin", False) or getattr(current_user, "is_admin", False)):
        raise HTTPException(403, "Admin only")

    if not EMAIL_PROVIDER:
        return {
            "status": "not_configured",
            "message": "Email provider not configured. Set EMAIL_PROVIDER, SENDGRID_API_KEY or AWS credentials.",
        }

    return {
        "status": "scaffold_only",
        "message": "Email digest endpoint is ready. Configure EMAIL_PROVIDER and install the SDK to send actual emails.",
    }
