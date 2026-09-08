"""
`@db.Date` columns, and the two ways prisma-client-py 0.11 gets them wrong.

Postgres `DATE` is `DateTime?` in `schema.prisma`, and the client is
asymmetric about it in both directions:

  * **writing** a bare `datetime.date` raises `TypeError: Type <class
    'datetime.date'> not serializable` and 500s the request;
  * **reading** always yields a `datetime`, so `column == today` — the obvious
    thing to write against a column whose name and schema type both say
    "date" — is False on the exact day it should be True.

Both are one-line mistakes, both are invisible in review, and on 2026-09-08
three of them were live at once on three different columns:

  * `srsLastChestDate` write → the daily chest had **never** been awarded, on
    any account, since the feature shipped. The throw came after the streak and
    lesson writes had already committed, so the numbers moved and only the
    response was lost; the client logs a failed completion and shows the done
    screen anyway. The symptom was an absence, which reads as a design choice.
  * `srsLastChestDate` read → hidden behind the above. With the write fixed but
    not the read, the once-a-day guard would never fire and every session would
    have opened its own chest.
  * `srsLastSessionDate` read in `/daily/state` → `today_done` was False for a
    user who had finished a lesson an hour earlier.

`utils/dates` exists so there is one place to be right. These tests pin the
helpers, and — more usefully — pin the *shape* of the bug, so the next person
to add a date column has something to read.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from src.utils.dates import as_date, utc_midnight

DAY = date(2026, 9, 8)
COLUMN_VALUE = datetime(2026, 9, 8, 0, 0, tzinfo=timezone.utc)


class TestUtcMidnight:
    """The write side."""

    def test_a_date_becomes_a_datetime(self):
        got = utc_midnight(DAY)

        assert isinstance(got, datetime)
        # `type(...) is datetime` and not just isinstance: `datetime` is a
        # subclass of `date`, which is the whole reason this bug is easy to
        # write — a `date` passes an `isinstance(x, date)` check and a
        # `datetime` passes it too, so neither type nor linter objects.
        assert type(got) is datetime

    def test_it_is_midnight_utc(self):
        got = utc_midnight(DAY)

        assert (got.hour, got.minute, got.second, got.microsecond) == (0, 0, 0, 0)
        assert got.tzinfo == timezone.utc
        assert got.date() == DAY

    def test_a_datetime_is_flattened_to_its_day(self):
        """Callers hold `now` on one path and a column read back on another.
        Those look alike and are not, so the helper takes either rather than
        making every call site remember which it has."""
        noon = datetime(2026, 9, 8, 12, 34, 56, tzinfo=timezone.utc)

        assert utc_midnight(noon) == COLUMN_VALUE

    def test_it_is_idempotent(self):
        assert utc_midnight(utc_midnight(DAY)) == utc_midnight(DAY)


class TestAsDate:
    """The read side."""

    def test_the_datetime_a_date_column_returns_becomes_a_date(self):
        got = as_date(COLUMN_VALUE)

        assert got == DAY
        assert type(got) is date

    def test_a_date_passes_through(self):
        assert as_date(DAY) == DAY

    def test_none_passes_through(self):
        """"Never" is a real value for every column this guards, and it is
        already correctly unequal to any day."""
        assert as_date(None) is None


class TestTheBugItself:
    """Why the helpers exist, stated as the failing comparison."""

    def test_comparing_a_date_column_to_a_date_is_false_without_normalising(self):
        # This is the line that shipped three times. It looks correct.
        assert (COLUMN_VALUE == DAY) is False

    def test_and_true_with_it(self):
        assert as_date(COLUMN_VALUE) == DAY

    def test_a_round_trip_survives(self):
        """Write a day, read the column back, recognise the same day."""
        stored = utc_midnight(DAY)
        assert as_date(stored) == DAY
