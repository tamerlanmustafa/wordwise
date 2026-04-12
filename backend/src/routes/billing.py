"""
Billing & receipt validation scaffold.

This module provides the endpoint structure for:
  - Apple StoreKit receipt validation
  - Google Play receipt validation
  - Subscription status sync
  - Restore purchases

SETUP REQUIRED: You must configure these environment variables:
  - APPLE_SHARED_SECRET  (App Store Connect > In-App Purchases > Shared Secret)
  - GOOGLE_PLAY_CREDENTIALS_PATH  (path to Google Play service account JSON)

The actual validation calls to Apple/Google servers are stubbed with TODO
markers — they need the credentials above to function.
"""

from __future__ import annotations

import os
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from prisma import Prisma

from ..database import get_db
from ..middleware.auth import get_current_active_user
from ..utils.subscription import is_premium

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/billing", tags=["billing"])

APPLE_SHARED_SECRET = os.environ.get("APPLE_SHARED_SECRET", "")
GOOGLE_CREDENTIALS_PATH = os.environ.get("GOOGLE_PLAY_CREDENTIALS_PATH", "")


class AppleReceiptBody(BaseModel):
    receipt_data: str
    product_id: str


class GoogleReceiptBody(BaseModel):
    purchase_token: str
    product_id: str
    package_name: str = "com.wordwise.app"


class SubscriptionStatusResponse(BaseModel):
    tier: str
    is_premium: bool
    expires_at: Optional[str] = None
    product_id: Optional[str] = None
    platform: Optional[str] = None


class RestoreResponse(BaseModel):
    restored: bool
    tier: str
    message: str


async def _activate_subscription(
    db: Prisma, user_id: int, tier: str, days: int, product_id: str
):
    expires = datetime.now(timezone.utc) + timedelta(days=days)
    await db.user.update(
        where={"id": user_id},
        data={
            "subscriptionTier": tier,
            "subscriptionExpiresAt": expires,
        },
    )
    logger.info(f"Activated {tier} for user {user_id}, expires {expires}, product={product_id}")
    return expires


PRODUCT_DURATION_DAYS = {
    "com.wordwise.plus.monthly": 30,
    "com.wordwise.plus.annual": 365,
    "com.wordwise.plus.trial": 7,
}


# ── Apple StoreKit ──────────────────────────────────────────────────────────

@router.post("/apple/verify", response_model=SubscriptionStatusResponse)
async def verify_apple_receipt(
    body: AppleReceiptBody,
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    if not APPLE_SHARED_SECRET:
        raise HTTPException(
            501,
            detail="Apple receipt validation not configured. Set APPLE_SHARED_SECRET env var.",
        )

    # TODO: Send receipt to Apple's verifyReceipt endpoint
    # Production: https://buy.itunes.apple.com/verifyReceipt
    # Sandbox:    https://sandbox.itunes.apple.com/verifyReceipt
    #
    # import httpx
    # async with httpx.AsyncClient() as client:
    #     resp = await client.post(
    #         "https://buy.itunes.apple.com/verifyReceipt",
    #         json={"receipt-data": body.receipt_data, "password": APPLE_SHARED_SECRET}
    #     )
    #     result = resp.json()
    #     if result["status"] != 0:
    #         # Try sandbox if production fails (Apple recommendation)
    #         resp = await client.post(
    #             "https://sandbox.itunes.apple.com/verifyReceipt",
    #             json={"receipt-data": body.receipt_data, "password": APPLE_SHARED_SECRET}
    #         )
    #         result = resp.json()
    #
    # Parse latest_receipt_info for active subscription, check expires_date

    raise HTTPException(
        501,
        detail="Apple receipt validation endpoint ready but credentials not configured. "
               "See backend/src/routes/billing.py for setup instructions.",
    )


# ── Google Play ─────────────────────────────────────────────────────────────

@router.post("/google/verify", response_model=SubscriptionStatusResponse)
async def verify_google_receipt(
    body: GoogleReceiptBody,
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    if not GOOGLE_CREDENTIALS_PATH:
        raise HTTPException(
            501,
            detail="Google Play validation not configured. Set GOOGLE_PLAY_CREDENTIALS_PATH env var.",
        )

    # TODO: Use google-api-python-client to verify purchase
    #
    # from google.oauth2 import service_account
    # from googleapiclient.discovery import build
    #
    # credentials = service_account.Credentials.from_service_account_file(
    #     GOOGLE_CREDENTIALS_PATH,
    #     scopes=["https://www.googleapis.com/auth/androidpublisher"]
    # )
    # service = build("androidpublisher", "v3", credentials=credentials)
    # result = service.purchases().subscriptions().get(
    #     packageName=body.package_name,
    #     subscriptionId=body.product_id,
    #     token=body.purchase_token,
    # ).execute()
    #
    # Check expiryTimeMillis, paymentState, cancelReason

    raise HTTPException(
        501,
        detail="Google Play validation endpoint ready but credentials not configured. "
               "See backend/src/routes/billing.py for setup instructions.",
    )


# ── Restore purchases ──────────────────────────────────────────────────────

@router.post("/restore", response_model=RestoreResponse)
async def restore_purchases(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    if is_premium(current_user):
        return RestoreResponse(
            restored=False,
            tier="premium",
            message="Your subscription is already active.",
        )

    # TODO: Check Apple/Google for active subscriptions linked to this user's
    # Apple ID or Google account. This requires server-side receipt history
    # lookup — Apple's /verifyReceipt with the user's original transaction ID,
    # or Google's purchases.subscriptions.get with a stored purchase token.
    #
    # For now, return a clear message that restoration needs billing setup.

    return RestoreResponse(
        restored=False,
        tier="free",
        message="No active subscription found. If you believe this is an error, "
                "contact support with your purchase confirmation.",
    )


# ── Subscription status ────────────────────────────────────────────────────

@router.get("/status", response_model=SubscriptionStatusResponse)
async def subscription_status(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    from ..utils.subscription import _tier, _expires_at

    tier = _tier(current_user)
    exp = _expires_at(current_user)

    return SubscriptionStatusResponse(
        tier=tier,
        is_premium=is_premium(current_user),
        expires_at=exp.isoformat() if exp else None,
    )


# ── Webhook endpoints (for server-to-server notifications) ──────────────────

@router.post("/apple/webhook")
async def apple_server_notification(
    db: Prisma = Depends(get_db),
):
    """
    Apple Server-to-Server notification endpoint.
    Configure in App Store Connect > App > General > Server URL.

    TODO: Parse the signedPayload JWT, verify signature with Apple's
    certificate chain, handle notification types:
      - DID_RENEW, DID_CHANGE_RENEWAL_STATUS, EXPIRED, REFUND, etc.
    """
    logger.info("Received Apple server notification (not yet configured)")
    return {"status": "received"}


@router.post("/google/webhook")
async def google_rtdn_notification(
    db: Prisma = Depends(get_db),
):
    """
    Google Real-Time Developer Notification endpoint.
    Configure in Google Play Console > Monetization > Real-time notifications.

    TODO: Parse the Pub/Sub message, decode the DeveloperNotification,
    handle subscriptionNotification types:
      - SUBSCRIPTION_PURCHASED, SUBSCRIPTION_RENEWED, SUBSCRIPTION_CANCELED,
        SUBSCRIPTION_EXPIRED, SUBSCRIPTION_REVOKED, etc.
    """
    logger.info("Received Google RTDN notification (not yet configured)")
    return {"status": "received"}
