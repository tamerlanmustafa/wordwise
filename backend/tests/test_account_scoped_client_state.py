"""
Client state that belongs to the account, not to the phone.

An audit on 2026-09-04 (prompted by a Practice lesson number that read 34 on
iOS and 8 on Android) found the same shape twice more in AsyncStorage, which
is per *install*:

  • `onboarding.v1`  — so an existing user reinstalling, or signing in on a
    second device, was shown the **entire first-run flow again**, placement
    quiz included. The gate in core/App.tsx reads nothing but the local flag.
  • `feedLevelMix`   — the Explore CEFR mix is a setting the user deliberately
    dialled in, and each phone held a different one.

Both now live on `users`, and both are written through the profile PATCH that
already existed rather than through new endpoints of their own.

The property this file defends is that **neither can go backwards**. That is
not a stylistic preference: the client has no way to distinguish "this account
has never onboarded" from "this install has no record of it", so a fresh
install necessarily reports `False`. If the server honoured that, the fix
would cause the exact bug it was written to remove.
"""
from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from prisma import Json as PrismaJson
from pydantic import ValidationError

from src.routes.auth import update_user_profile
from src.schemas.user import UserResponse, UserUpdate

BALANCED = {"A1": 10, "A2": 10, "B1": 30, "B2": 30, "C1": 10, "C2": 10}


def _user(**overrides) -> SimpleNamespace:
    base = dict(
        id=7,
        email="movielover@example.com",
        username="movielover",
        passwordHash="$2b$12$fake",
        languagePreference=None,
        nativeLanguage="en",
        learningLanguage="en",
        proficiencyLevel="B1",
        defaultTab="movies",
        isActive=True,
        isAdmin=False,
        createdAt=None,
        profilePictureUrl=None,
        oauthProvider="email",
        googleId=None,
        appleId=None,
        subscriptionTier=None,
        subscriptionExpiresAt=None,
        adsEligible=True,
        onboardingCompletedAt=None,
        feedLevelMix=None,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


class _FakeUserTable:
    def __init__(self, user=None):
        self._user = user
        self.updates: list[dict] = []

    async def find_unique(self, where):
        u = self._user
        return u if u is not None and where.get("id") == u.id else None

    async def find_first(self, where):
        """The username-uniqueness probe. Nobody else exists in these tests."""
        return None

    async def update(self, where, data):
        self.updates.append(data)
        for k, v in data.items():
            # `prisma.Json` is a write-side wrapper, not a dict — Postgres
            # hands the value back as plain JSON on the next read. Unwrapping
            # here is what makes the fake round-trip like the database, and
            # skipping it would let a read path pass in tests that cannot work
            # against a real row.
            setattr(self._user, k, v.data if isinstance(v, PrismaJson) else v)
        return self._user


class _FakeDb:
    def __init__(self, user=None):
        self.user = _FakeUserTable(user)


async def _patch(db, **fields):
    return await update_user_profile(
        UserUpdate(**fields), current_user=db.user._user, db=db
    )


# ---------------------------------------------------------------------------
# 1. Onboarding is a one-way flag
# ---------------------------------------------------------------------------

class TestOnboardingFlag:
    async def test_finishing_onboarding_stamps_the_account(self):
        db = _FakeDb(_user())

        res = await _patch(db, onboarding_completed=True)

        assert res.onboarding_completed is True
        assert isinstance(db.user._user.onboardingCompletedAt, datetime)

    async def test_a_fresh_install_cannot_un_onboard_an_account(self):
        """The whole reason the field is not a plain boolean write. A reinstall
        has no local record and reports False; honouring that would put a
        long-standing user back through the placement quiz."""
        stamped = datetime(2026, 1, 1, tzinfo=timezone.utc)
        db = _FakeDb(_user(onboardingCompletedAt=stamped))

        res = await _patch(db, onboarding_completed=False)

        assert res.onboarding_completed is True
        assert db.user._user.onboardingCompletedAt == stamped
        assert db.user.updates == []

    async def test_re_sending_true_keeps_the_original_date(self):
        """Every launch of an onboarded install sends True. That must be a
        no-op, not a fresh timestamp — otherwise 'when did they onboard'
        becomes 'when did they last open the app'."""
        stamped = datetime(2026, 1, 1, tzinfo=timezone.utc)
        db = _FakeDb(_user(onboardingCompletedAt=stamped))

        await _patch(db, onboarding_completed=True)

        assert db.user._user.onboardingCompletedAt == stamped
        assert db.user.updates == []

    async def test_an_untouched_patch_leaves_the_flag_alone(self):
        """None means 'this PATCH does not touch the field' — a Settings form
        saving a username must not disturb onboarding."""
        db = _FakeDb(_user())

        await _patch(db, username="movielover2")

        assert "onboardingCompletedAt" not in db.user.updates[0]

    async def test_the_response_reports_a_boolean_not_a_date(self):
        """The client's only question is whether, and handing it a date invites
        arithmetic against a clock we don't control."""
        db = _FakeDb(_user(onboardingCompletedAt=datetime.now(timezone.utc)))

        res = UserResponse.model_validate(db.user._user)

        assert res.onboarding_completed is True
        assert not hasattr(res, "onboarding_completed_at")

    async def test_a_never_onboarded_account_reads_false(self):
        assert UserResponse.model_validate(_user()).onboarding_completed is False


# ---------------------------------------------------------------------------
# 2. The feed mix has to be servable, not merely stored
# ---------------------------------------------------------------------------

class TestFeedLevelMix:
    async def test_a_balanced_mix_is_stored(self):
        db = _FakeDb(_user())

        res = await _patch(db, feed_level_mix=BALANCED)

        assert res.feed_level_mix == BALANCED

    async def test_missing_bands_are_filled_in_as_zero(self):
        """A four-level mix from an older build arrives with A1 and C2 absent.
        It already totals 100, so it is legal — but the stored shape should be
        the full six bands rather than whatever the client happened to send."""
        db = _FakeDb(_user())

        res = await _patch(db, feed_level_mix={"A2": 25, "B1": 25, "B2": 25, "C1": 25})

        assert res.feed_level_mix == {"A1": 0, "A2": 25, "B1": 25, "B2": 25, "C1": 25, "C2": 0}

    @pytest.mark.parametrize(
        "mix",
        [
            {"A1": 50, "A2": 40},                                            # totals 90
            {"A1": 60, "A2": 60},                                            # totals 120
            {"A1": 100, "B7": 0},                                            # unknown band
            {"A1": 110, "A2": -10},                                          # out of range
        ],
    )
    async def test_a_mix_the_feed_would_reject_is_refused_here(self, mix):
        """This column is what a fresh device hydrates from. Storing a mix
        `/srs/feed` will not serve would hand that device an empty Explore tab
        with nothing in the logs to explain it."""
        with pytest.raises(ValidationError):
            UserUpdate(feed_level_mix=mix)

    async def test_an_untouched_patch_leaves_the_mix_alone(self):
        db = _FakeDb(_user(feedLevelMix=BALANCED))

        await _patch(db, username="movielover2")

        assert "feedLevelMix" not in db.user.updates[0]

    async def test_an_account_that_never_set_one_reads_null(self):
        """Distinct from an all-zero mix: NULL is what tells the client to keep
        deriving a default from the user's level."""
        assert UserResponse.model_validate(_user()).feed_level_mix is None

    async def test_an_account_that_never_set_one_is_not_overwritten_by_absence(self):
        db = _FakeDb(_user(feedLevelMix=BALANCED))

        await _patch(db, feed_level_mix=None)

        assert db.user._user.feedLevelMix == BALANCED

    async def test_a_corrupt_stored_mix_reads_as_unset(self):
        """JSONB holds whatever was written, including by an older build. A row
        that no longer parses should degrade to the derived default rather than
        500 the profile endpoint every request."""
        for junk in ["not a dict", {"A1": "many"}, {"A1": 3}, {"Z9": 100}]:
            assert UserResponse.model_validate(_user(feedLevelMix=junk)).feed_level_mix is None


# ---------------------------------------------------------------------------
# 3. The translation language was the one that needed no new column
# ---------------------------------------------------------------------------

class TestTranslationLanguage:
    """`users.learning_language` already existed — the picker never wrote to it.

    Now that it does, the set this endpoint accepts has to be a superset of
    what the picker offers. It was not: `az` (Azerbaijani, offered in the app
    as Beta) would have been rejected, and because the write is deliberately
    fire-and-forget the user would have seen nothing at all — the language
    would apply on this phone and never reach the account.
    """

    # apps/mobile/src/types/constants.ts → AVAILABLE_LANGUAGES, lowercased.
    PICKER_CODES = [
        "es", "fr", "de", "it", "pt", "ru", "tr", "ja", "zh", "nl", "pl", "az",
    ]

    @pytest.mark.parametrize("code", PICKER_CODES)
    async def test_every_language_the_app_offers_can_be_stored(self, code):
        db = _FakeDb(_user())

        res = await _patch(db, learning_language=code)

        assert res.learning_language == code

    async def test_a_language_the_app_does_not_offer_is_still_rejected(self):
        """The superset rule is not 'accept anything' — a typo should still be
        a 400 the settings form can show, not a silently stored value."""
        from fastapi import HTTPException

        db = _FakeDb(_user())
        with pytest.raises(HTTPException) as exc:
            await _patch(db, learning_language="klingon")
        assert exc.value.status_code == 400
