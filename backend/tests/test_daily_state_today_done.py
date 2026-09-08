"""
`/daily/state` → `today_done`, which had never once been true.

The flag is derived rather than stored — `srsLastSessionDate == today` — and
the route compared an `@db.Date` column, which prisma-client-py hands back as a
`datetime`, against `datetime.now(timezone.utc).date()`, a `date`. Those are
never equal, so a user who finished a lesson an hour earlier was told today was
still outstanding.

Caught on 2026-09-08 against a real local account whose column read
`2026-09-08` while the endpoint answered `"today_done": false` on 2026-09-08.

It is the third instance of one mistake — see `test_db_date_columns.py` for the
other two and for `utils/dates`, which exists so there is not a fourth. This
file guards the derivation itself, because `today_done` is what the daily-habit
UI reads to decide whether the day is already satisfied, and because the free
tier's Practice budget now keys off the same column: a comparison that is
always False would hand every user an unlimited supply of "first session of the
day".
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from src.utils.dates import as_date

TODAY = date(2026, 9, 8)


def _column(day: date) -> datetime:
    """What prisma actually returns for an `@db.Date` column."""
    return datetime(day.year, day.month, day.day, tzinfo=timezone.utc)


def _today_done(column_value, today: date) -> bool:
    """The route's derivation, as `routes/daily.py` performs it."""
    return as_date(column_value) == today


class TestTodayDone:
    def test_true_when_the_lesson_was_finished_today(self):
        assert _today_done(_column(TODAY), TODAY) is True

    def test_false_the_day_after(self):
        assert _today_done(_column(TODAY - timedelta(days=1)), TODAY) is False

    def test_false_for_an_account_that_has_never_practised(self):
        assert _today_done(None, TODAY) is False

    def test_the_unnormalised_comparison_is_what_was_broken(self):
        """Stated explicitly so the regression is recognisable rather than
        merely absent: this is the line that shipped, and it is False on the
        one day it has to be True."""
        assert (_column(TODAY) == TODAY) is False
        assert _today_done(_column(TODAY), TODAY) is True

    def test_the_route_normalises_before_comparing(self):
        """A source guard, because the bug is a missing call rather than a
        wrong expression — nothing about `last_date == today` looks incorrect,
        which is exactly why it survived review."""
        from pathlib import Path

        source = Path(__file__).resolve().parents[1] / "src" / "routes" / "daily.py"
        text = source.read_text(encoding="utf-8")

        assert "as_date(user.srsLastSessionDate)" in text
        # And the raw read is gone, so the two cannot coexist with the
        # normalised one quietly shadowed.
        assert "last_date = user.srsLastSessionDate if user else None" not in text
