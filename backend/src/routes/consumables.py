"""
Consumable IAPs (v0.6+): freeze packs.

Distinct from `billing.py` (subscription receipts). Consumables are sold
in batches — the user buys a pack, we credit N items to their inventory,
and the item is "consumed" when used. Today's only consumable is the
streak freeze pack.

Real receipt validation requires the same Apple/Google credentials that
`billing.py` is waiting on (APPLE_SHARED_SECRET / GOOGLE_PLAY_CREDENTIALS_PATH).
Until those land, `/consumables/freeze-pack/verify` returns 501 — the
mobile app can still develop against `/consumables/freeze-pack/debug-grant`,
an admin/dev-only shortcut that credits the pack without an actual receipt.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from prisma import Prisma
from pydantic import BaseModel

from ..database import get_db
from ..middleware.auth import get_current_active_user
from ..services.streak_service import (
    MAX_FREEZES_HELD,
    count_held_freezes,
    grant_freeze,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/consumables", tags=["consumables"])

# Pack size for the consumable IAP product `wordwise.freeze_pack_5`.
# Tunable per-SKU when we ship multiple pack sizes.
FREEZE_PACK_SIZE: int = 5

# Whether the debug-grant endpoint is reachable for non-admins. Fail CLOSED:
# off unless ENABLE_DEBUG_GRANTS is explicitly truthy. A forgotten env var in
# prod must never hand out free consumables. Admins always bypass.
DEBUG_GRANTS_ENABLED: bool = os.environ.get("ENABLE_DEBUG_GRANTS", "").lower() in {"1", "true"}


class CreditedResponse(BaseModel):
    credited: int
    freezes_held: int
    capped: bool  # True iff the cap clipped some credits


class AppleConsumableReceiptBody(BaseModel):
    receipt_data: str
    product_id: str


class GoogleConsumableReceiptBody(BaseModel):
    purchase_token: str
    product_id: str
    package_name: str = "com.wordwise.app"


async def _credit_freezes(
    db: Prisma,
    *,
    user_id: int,
    pack_size: int,
    via: str,
) -> CreditedResponse:
    """Credit up to `pack_size` freezes, respecting MAX_FREEZES_HELD.

    Returns how many actually landed (could be fewer than requested if
    the user was near the cap) so the client can surface a "🛡️ +3 added
    (2 capped)" toast instead of silently dropping.
    """
    held = await count_held_freezes(db, user_id)
    room = max(0, MAX_FREEZES_HELD - held)
    to_credit = min(pack_size, room)
    now = datetime.now(timezone.utc)
    for _ in range(to_credit):
        await grant_freeze(db, user_id=user_id, via=via, now=now)
    new_held = held + to_credit
    return CreditedResponse(
        credited=to_credit,
        freezes_held=new_held,
        capped=to_credit < pack_size,
    )


@router.post("/freeze-pack/verify-apple", response_model=CreditedResponse)
async def verify_apple_freeze_pack(
    _body: AppleConsumableReceiptBody,
    _current_user=Depends(get_current_active_user),
    _db: Prisma = Depends(get_db),
):
    """Validate an Apple consumable receipt and credit the freeze pack.

    Stubbed pending Apple credentials — see `billing.py` for the same
    blocker on subscription receipts. The full flow will:
      1. POST receipt_data to Apple's verifyReceipt endpoint
      2. Check status == 0 and validate product_id matches
      3. Verify in_app entries to confirm the consumable isn't replayed
         (Apple's `transaction_id` should be deduped server-side)
      4. Call `_credit_freezes(..., via='iap')` on success
    """
    raise HTTPException(
        status_code=501,
        detail=(
            "Apple consumable validation not configured. Set "
            "APPLE_SHARED_SECRET (see billing.py setup notes) and "
            "implement the verifyReceipt call here before launch."
        ),
    )


@router.post("/freeze-pack/verify-google", response_model=CreditedResponse)
async def verify_google_freeze_pack(
    _body: GoogleConsumableReceiptBody,
    _current_user=Depends(get_current_active_user),
    _db: Prisma = Depends(get_db),
):
    """Validate a Google Play consumable purchase and credit the freeze
    pack. Stubbed pending Google credentials — see `billing.py`. Use
    `purchases.products.get` with the purchase_token, validate
    purchaseState == 0 (purchased), and dedupe orderId server-side."""
    raise HTTPException(
        status_code=501,
        detail=(
            "Google Play consumable validation not configured. Set "
            "GOOGLE_PLAY_CREDENTIALS_PATH (see billing.py setup notes) "
            "and implement the purchases.products.get call here before launch."
        ),
    )


@router.post("/freeze-pack/debug-grant", response_model=CreditedResponse)
async def debug_grant_freeze_pack(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """Dev-only shortcut: credit a freeze pack without an actual IAP.

    Restricted to admins, OR to any caller only when ENABLE_DEBUG_GRANTS is
    explicitly set truthy (fail-closed). Lets the mobile app exercise the full
    UX flow before real receipt validation lands. Any environment that doesn't
    set ENABLE_DEBUG_GRANTS blocks non-admin callers.
    """
    is_admin = bool(getattr(current_user, "isAdmin", False))
    if not (is_admin or DEBUG_GRANTS_ENABLED):
        raise HTTPException(
            status_code=403,
            detail="Debug grants disabled in this environment.",
        )
    return await _credit_freezes(
        db,
        user_id=current_user.id,
        pack_size=FREEZE_PACK_SIZE,
        via="debug_grant",
    )
