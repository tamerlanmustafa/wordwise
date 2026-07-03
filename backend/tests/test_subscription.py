"""
Unit tests for src/utils/subscription.py — the single entitlement gate.

Pure functions over fake user objects; no DB. The expiry rules matter
because billing writes `subscription_expires_at` on every activation:
a lapsed premium must drop to free on its own, without waiting for a
webhook to flip the tier column.
"""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from src.utils.subscription import entitlements_payload, is_premium


def _user(tier=None, expires_at=None, is_admin=False):
    return SimpleNamespace(
        subscriptionTier=tier,
        subscriptionExpiresAt=expires_at,
        isAdmin=is_admin,
        adsEligible=True,
    )


def _future():
    return datetime.now(timezone.utc) + timedelta(days=30)


def _past():
    return datetime.now(timezone.utc) - timedelta(days=1)


class TestIsPremium:
    def test_none_user_is_not_premium(self):
        assert is_premium(None) is False

    def test_free_tier_is_not_premium(self):
        assert is_premium(_user("free")) is False

    def test_missing_tier_defaults_to_free(self):
        assert is_premium(_user(None)) is False

    def test_admin_is_always_premium(self):
        assert is_premium(_user("free", is_admin=True)) is True

    def test_comped_never_expires(self):
        assert is_premium(_user("comped", expires_at=_past())) is True

    def test_premium_without_expiry_is_perpetual(self):
        # Admin grant-premium can set no expiry — that's a manual perpetual
        # grant and must keep working.
        assert is_premium(_user("premium", expires_at=None)) is True

    def test_premium_with_future_expiry(self):
        assert is_premium(_user("premium", expires_at=_future())) is True

    def test_premium_with_past_expiry_has_lapsed(self):
        # The regression this file exists for: an expired premium used to
        # stay premium forever because only `trial` checked the expiry.
        assert is_premium(_user("premium", expires_at=_past())) is False

    def test_trial_with_future_expiry(self):
        assert is_premium(_user("trial", expires_at=_future())) is True

    def test_trial_with_past_expiry(self):
        assert is_premium(_user("trial", expires_at=_past())) is False

    def test_trial_without_expiry_is_not_premium(self):
        assert is_premium(_user("trial", expires_at=None)) is False

    def test_naive_datetime_treated_as_utc(self):
        naive_past = datetime.utcnow() - timedelta(days=1)
        assert is_premium(_user("premium", expires_at=naive_past)) is False


class TestEntitlementsPayload:
    def test_lapsed_premium_reports_not_premium(self):
        exp = _past()
        payload = entitlements_payload(_user("premium", expires_at=exp))
        assert payload["is_premium"] is False
        assert payload["tier"] == "premium"
        assert payload["subscription_expires_at"] == exp.isoformat()

    def test_active_premium_suppresses_ads(self):
        payload = entitlements_payload(_user("premium", expires_at=_future()))
        assert payload["is_premium"] is True
        assert payload["ads_eligible"] is False
