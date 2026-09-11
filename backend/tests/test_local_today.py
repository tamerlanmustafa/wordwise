"""The day a streak is measured in belongs to the user, not to the server.

Every date this product cares about — the streak, the free tier's one lesson a
day, the chest, the freeze gap arithmetic — used `datetime.now(timezone.utc)
.date()`. The reasoning was recorded in `srs_engine.can_free_user_start_session
_today`: "the server has no reliable client timezone." That premise stopped
being true when the mobile client began reporting an IANA zone.

What it cost, and what these tests pin: at UTC+13 a session practised at 10am
local on Monday is stamped Sunday 21:00 UTC. Two consecutive local mornings can
therefore share one UTC day — the streak does not advance and the user is told
they have already practised — or straddle two, spending two days of a free
tier's budget on one sitting.

The fallbacks matter as much as the happy path. Every account predates the
column, so NULL has to behave exactly as the old code did, and `zoneinfo` reads
the host tzdata, so a name that resolves on a laptop can raise in a slim
container. Both fall back to UTC: a wrong-but-consistent day beats a 500 on the
streak.
"""
from datetime import date, datetime, timezone

from src.services.srs_engine import (
    can_free_user_start_session_today,
    compute_new_streak,
)
from src.utils.dates import local_today


class FakeUser:
    """Just the attribute `local_today` reads. Deliberately not a Prisma row —
    the helper takes the whole user so call sites cannot pass the wrong field,
    and duck typing is the whole of that contract."""

    def __init__(self, tz):
        self.timezone = tz


# 21:30 UTC on the 11th. Already the 12th east of UTC+3, still the 11th west.
EVENING_UTC = datetime(2026, 9, 11, 21, 30, tzinfo=timezone.utc)


class TestLocalToday:
    def test_null_timezone_is_the_utc_day(self):
        # Every account before the column existed. This is the compatibility
        # guarantee: unknown zone ⇒ exactly the old behaviour.
        assert local_today(FakeUser(None), now=EVENING_UTC) == date(2026, 9, 11)

    def test_missing_attribute_is_the_utc_day(self):
        # A caller handing over something that is not a user at all should
        # degrade, not explode — this runs on the streak path.
        class Nothing:
            pass

        assert local_today(Nothing(), now=EVENING_UTC) == date(2026, 9, 11)

    def test_unresolvable_zone_is_the_utc_day(self):
        # zoneinfo reads the host tzdata. A slim container can lack a zone a
        # developer laptop has, and the streak must not 500 over it.
        assert local_today(FakeUser("Not/AZone"), now=EVENING_UTC) == date(2026, 9, 11)

    def test_east_of_utc_is_already_tomorrow(self):
        assert local_today(FakeUser("Pacific/Auckland"), now=EVENING_UTC) == date(2026, 9, 12)
        assert local_today(FakeUser("Europe/Istanbul"), now=EVENING_UTC) == date(2026, 9, 12)

    def test_west_of_utc_is_still_today(self):
        assert local_today(FakeUser("America/Los_Angeles"), now=EVENING_UTC) == date(2026, 9, 11)

    def test_one_instant_is_two_different_days(self):
        # The whole point, stated once: the same moment is a different calendar
        # day for two users, and each of them is right.
        auckland = local_today(FakeUser("Pacific/Auckland"), now=EVENING_UTC)
        la = local_today(FakeUser("America/Los_Angeles"), now=EVENING_UTC)
        assert auckland != la
        assert (auckland - la).days == 1

    def test_an_offset_would_have_been_wrong_across_dst(self):
        # Why the column stores an IANA name and not a number. London is UTC+1
        # in August and UTC+0 in December; a stored offset is right for half
        # the year, and a streak that breaks on the clock change is exactly the
        # bug this replaces.
        summer = datetime(2026, 8, 15, 23, 30, tzinfo=timezone.utc)
        winter = datetime(2026, 12, 15, 23, 30, tzinfo=timezone.utc)
        assert local_today(FakeUser("Europe/London"), now=summer) == date(2026, 8, 16)
        assert local_today(FakeUser("Europe/London"), now=winter) == date(2026, 12, 15)


class TestTheBugThisFixes:
    """The two failures that made this worth doing, as scenarios."""

    def test_two_local_mornings_no_longer_share_one_utc_day(self):
        # Auckland, UTC+12. Monday 10am local = Sunday 22:00 UTC; Tuesday 10am
        # local = Monday 22:00 UTC. Under the old rule both days' *UTC* dates
        # differ, so this one was fine — but the evening case below was not.
        mon_local = local_today(FakeUser("Pacific/Auckland"),
                                now=datetime(2026, 9, 13, 22, 0, tzinfo=timezone.utc))
        tue_local = local_today(FakeUser("Pacific/Auckland"),
                                now=datetime(2026, 9, 14, 22, 0, tzinfo=timezone.utc))
        assert (tue_local - mon_local).days == 1
        assert compute_new_streak(4, mon_local, tue_local) == 5

    def test_an_evening_session_is_not_tomorrows_lesson(self):
        # Istanbul, UTC+3. 11pm Friday local is 20:00 Friday UTC — same day
        # either way. But 2am Saturday local is 23:00 FRIDAY UTC, so a user
        # practising just after midnight was credited to the day before and
        # then told, hours later, that they had already practised "today".
        tz = FakeUser("Europe/Istanbul")
        late_friday = datetime(2026, 9, 11, 20, 0, tzinfo=timezone.utc)   # 23:00 Fri
        after_midnight = datetime(2026, 9, 11, 23, 0, tzinfo=timezone.utc)  # 02:00 Sat

        assert local_today(tz, now=late_friday) == date(2026, 9, 11)
        assert local_today(tz, now=after_midnight) == date(2026, 9, 12)
        # Under UTC both instants are the 11th — one day, not two.
        assert late_friday.date() == after_midnight.date()

    def test_the_free_budget_resets_on_the_users_midnight(self):
        # The gate takes the caller's day now. Finished on the 11th local, and
        # it is the 12th local ⇒ a new lesson is available, even though both
        # instants sit inside one UTC day.
        tz = FakeUser("Europe/Istanbul")
        finished_on = local_today(tz, now=datetime(2026, 9, 11, 20, 0, tzinfo=timezone.utc))
        now_local = local_today(tz, now=datetime(2026, 9, 11, 23, 0, tzinfo=timezone.utc))

        assert can_free_user_start_session_today(finished_on, today=now_local) is True
        # …and the same day twice is still one lesson.
        assert can_free_user_start_session_today(finished_on, today=finished_on) is False

    def test_the_gate_still_falls_back_to_utc_without_a_day(self):
        # The degenerate call with no user in hand keeps its old behaviour.
        noon = datetime(2026, 9, 11, 12, 0, tzinfo=timezone.utc)
        assert can_free_user_start_session_today(date(2026, 9, 11), now=noon) is False
        assert can_free_user_start_session_today(date(2026, 9, 10), now=noon) is True


class TestUserResponseCarriesTheZone:
    """The client cannot skip a redundant write if it never learns the value.

    `UserResponse.model_validate` is overridden with a hand-built dict, and
    that branch is a **whitelist**: a field declared on the model but absent
    from the dict is silently dropped. `timezone` was declared and not listed,
    so `/auth/me` returned `null` for a user whose row held a zone — and the
    client, comparing the device zone against `null`, re-sent the same PATCH on
    every single launch.

    The fixture below carries `profilePictureUrl` **on purpose**. That
    attribute is what selects the whitelist branch, and a fixture without it
    takes the passthrough branch instead — which is how the first version of
    this test passed while production dropped the field.
    """

    class PrismaishUser:
        id = 2
        email = "verifybot@example.com"
        username = "verifybot"
        languagePreference = None
        timezone = "America/New_York"
        nativeLanguage = "en"
        learningLanguage = "en"
        proficiencyLevel = None
        defaultTab = "movies"
        isActive = True
        isAdmin = False
        createdAt = None
        profilePictureUrl = None   # selects the whitelist branch
        oauthProvider = None
        onboardingCompletedAt = None
        feedLevelMix = None
        subscriptionTier = None
        subscriptionExpiresAt = None
        adsEligible = True

    def test_the_zone_survives_serialization(self):
        from src.schemas.user import UserResponse

        out = UserResponse.model_validate(self.PrismaishUser()).model_dump()
        assert out["timezone"] == "America/New_York"

    def test_the_fixture_really_takes_the_whitelist_branch(self):
        # Guards the test itself. If this attribute is ever removed the test
        # above starts passing for the wrong reason and stops protecting
        # anything — which is exactly what happened the first time.
        assert hasattr(self.PrismaishUser(), "profilePictureUrl")

    def test_a_null_zone_round_trips_as_null(self):
        from src.schemas.user import UserResponse

        row = self.PrismaishUser()
        row.timezone = None
        assert UserResponse.model_validate(row).model_dump()["timezone"] is None
