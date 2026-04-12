"""
Entitlement helpers for WordWise Plus (see docs/MONETIZATION_PLAN.md §6).

One helper function, one truth. Every gated check in the app routes through
`is_premium(user)`. Never read `subscription_tier` directly in business logic
— admin/comped/trial handling lives here and nowhere else.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def _tier(user: Any) -> str:
    tier = getattr(user, "subscriptionTier", None) or getattr(user, "subscription_tier", None)
    if tier is None:
        return "free"
    # Prisma enum values render as .value; tolerate raw strings too.
    return getattr(tier, "value", tier)


def _expires_at(user: Any) -> datetime | None:
    return getattr(user, "subscriptionExpiresAt", None) or getattr(
        user, "subscription_expires_at", None
    )


def is_premium(user: Any) -> bool:
    """
    Entitlement check for Plus features. True when:
      - user is an admin (admins get full access, see §6)
      - tier is 'premium' or 'comped' (comped never expires)
      - tier is 'trial' and the expiry is still in the future

    Everything else is free.
    """
    if user is None:
        return False
    if getattr(user, "isAdmin", False) or getattr(user, "is_admin", False):
        return True

    tier = _tier(user)
    if tier in ("premium", "comped"):
        return True
    if tier == "trial":
        exp = _expires_at(user)
        if exp is None:
            return False
        # Prisma returns tz-aware; guard against naive just in case.
        now = datetime.now(timezone.utc)
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        return exp > now
    return False


def is_ad_eligible(user: Any) -> bool:
    """
    True → we MAY show ads to this user. False → never show ads.

    Ads are suppressed for: premium/comped/admin users AND users whose
    `ads_eligible` flag is false (underage / regulated regions, see §5).
    """
    if is_premium(user):
        return False
    flag = getattr(user, "adsEligible", None)
    if flag is None:
        flag = getattr(user, "ads_eligible", None)
    # Default to True when unset — ads_eligible is an opt-out flag.
    return flag is not False


def entitlements_payload(user: Any) -> dict:
    """
    The `entitlements` object the mobile app reads from /auth/me. Everything
    the client needs to decide what to gate, in one place.
    """
    tier = _tier(user)
    exp = _expires_at(user)
    return {
        "tier": tier,
        "is_premium": is_premium(user),
        "is_admin": bool(getattr(user, "isAdmin", False) or getattr(user, "is_admin", False)),
        "ads_eligible": is_ad_eligible(user),
        "subscription_expires_at": exp.isoformat() if exp else None,
    }
