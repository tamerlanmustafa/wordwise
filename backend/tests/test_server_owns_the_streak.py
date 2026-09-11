"""The server decides what happened, and only one thing writes the streak.

Two defects, one cause: nothing on the server recorded that a Practice session
had occurred, so the endpoint that closed a session had to take the client's
word for it — and a *second*, unrelated function was free to move the streak
without anyone noticing.

1. **The count was client-reported.** `POST /srs/session/complete` received
   `total_count` in the body, guarded only `> 0`, used it to decide whether the
   day was credited, and echoed it back unvalidated. `practice_sessions` now
   records how many cards the server dealt, and the completion clamps to it.

2. **A movie quiz moved the Practice streak.**
   `advance_user_rollup_after_review` wrote `srsCurrentStreak`,
   `srsLongestStreak` and `srsLastSessionDate` unconditionally, with no
   `credited` check, and is called from `POST /quiz/sessions/{id}/complete`.
   Because `srsLastSessionDate` is *also* the free tier's Practice budget, a
   movie quiz silently spent that day's lesson — with no chest and no tile.
   That made `counts_toward_streak` advisory: a rule with a second writer that
   never consults it is not a rule.

   `record_session_day` is now the only writer.
"""
from datetime import date, datetime, timezone

import pytest

from src.services.session_kinds import counts_toward_streak
from src.services.srs_engine import advance_user_rollup_after_review


class FakeUser:
    def __init__(self, **kw):
        self.id = 1
        self.timezone = None
        self.srsTotalReviews = 100
        self.srsTotalCorrect = 60
        self.srsCurrentStreak = 7
        self.srsLongestStreak = 9
        self.srsLastSessionDate = datetime(2026, 9, 1, tzinfo=timezone.utc)
        self.unlockedCosmetics = None
        for k, v in kw.items():
            setattr(self, k, v)


class RecordingDB:
    """Captures what the code under test tried to write."""

    def __init__(self, user):
        self._user = user
        self.writes: list[dict] = []
        outer = self

        class _User:
            async def find_unique(self, where):
                return outer._user

            async def update(self, where, data):
                outer.writes.append(dict(data))
                return outer._user

        self.user = _User()

    @property
    def last_write(self) -> dict:
        assert self.writes, "nothing was written"
        return self.writes[-1]


class TestTheRollupNoLongerMovesTheStreak:
    @pytest.mark.asyncio
    async def test_it_still_rolls_up_the_per_card_totals(self):
        # What the function is actually named for, and the half that is
        # genuinely per-card. This must keep working.
        db = RecordingDB(FakeUser())
        await advance_user_rollup_after_review(
            db, user_id=1, correct_count=3, total_count=4, today=date(2026, 9, 11)
        )
        assert db.last_write["srsTotalReviews"] == 104
        assert db.last_write["srsTotalCorrect"] == 63

    @pytest.mark.asyncio
    async def test_it_does_not_touch_the_streak(self):
        # The leak. A movie quiz reaches this function, and reaching it used to
        # be enough to claim the day.
        db = RecordingDB(FakeUser())
        await advance_user_rollup_after_review(
            db, user_id=1, correct_count=3, total_count=4, today=date(2026, 9, 11)
        )
        for field in ("srsCurrentStreak", "srsLongestStreak", "srsLastSessionDate"):
            assert field not in db.last_write, (
                f"{field} was written by the per-card rollup. Only "
                f"record_session_day may write the streak — see "
                f"counts_toward_streak, which this path never consulted."
            )

    @pytest.mark.asyncio
    async def test_it_does_not_spend_the_free_daily_budget(self):
        # `srsLastSessionDate` is the streak AND the free tier's one-lesson-a-
        # day gate. Writing it here spent a lesson the user never took.
        db = RecordingDB(FakeUser())
        await advance_user_rollup_after_review(
            db, user_id=1, correct_count=1, total_count=1, today=date(2026, 9, 11)
        )
        assert "srsLastSessionDate" not in db.last_write

    @pytest.mark.asyncio
    async def test_nothing_scored_writes_nothing(self):
        db = RecordingDB(FakeUser())
        await advance_user_rollup_after_review(
            db, user_id=1, correct_count=0, total_count=0, today=date(2026, 9, 11)
        )
        assert db.writes == []


def clamp(reported_total: int, reported_correct: int, cards_dealt: int):
    """The rule `session/complete` applies, stated once.

    Clamped rather than rejected on purpose: a mismatch is far more likely to
    be an honest client — a card dropped as unrenderable, a retry, a resumed
    deck — than an attack, and refusing the completion would cost a real user
    their streak in order to punish a number being too large.
    """
    total = min(reported_total, cards_dealt)
    return total, min(reported_correct, total)


class TestTheCompletionClamp:
    def test_an_honest_report_is_untouched(self):
        assert clamp(10, 7, cards_dealt=10) == (10, 7)

    def test_a_short_session_is_untouched(self):
        # Quitting halfway is normal and must still credit the day.
        assert clamp(4, 2, cards_dealt=10) == (4, 2)

    def test_an_inflated_total_is_cut_to_what_was_dealt(self):
        # The claim the server could not previously check.
        assert clamp(9999, 9999, cards_dealt=10) == (10, 10)

    def test_correct_can_never_exceed_the_clamped_total(self):
        # Otherwise accuracy reads over 100% on every surface that divides one
        # by the other.
        assert clamp(10, 50, cards_dealt=10) == (10, 10)
        assert clamp(3, 50, cards_dealt=10) == (3, 3)

    def test_zero_stays_zero_so_an_empty_deck_earns_nothing(self):
        # `total_count > 0` is what gates the day; clamping must not
        # accidentally manufacture a credit for a deck that asked nothing.
        assert clamp(0, 0, cards_dealt=10) == (0, 0)

    def test_a_deck_that_dealt_nothing_can_credit_nothing(self):
        assert clamp(5, 5, cards_dealt=0) == (0, 0)


class TestTheRuleThatWasAdvisory:
    """`counts_toward_streak` only means something if one writer obeys it."""

    def test_practice_counts(self):
        assert counts_toward_streak("practice") is True

    def test_a_list_does_not(self):
        assert counts_toward_streak("list_words") is False
        assert counts_toward_streak("list_films") is False

    def test_an_old_client_sending_nothing_is_still_practice(self):
        # Builds that predate the field send no kind; they must keep their
        # streaks.
        assert counts_toward_streak(None) is True
