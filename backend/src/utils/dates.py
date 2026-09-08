"""Reading and writing `@db.Date` columns without getting the type wrong.

Postgres `DATE` maps to `DateTime?` in `schema.prisma`, and prisma-client-py
0.11 is asymmetric about it in both directions:

  * **Writing** a bare `datetime.date` raises. The client serialises query
    arguments itself and has no encoder for that type, so the whole request
    dies with `TypeError: Type <class 'datetime.date'> not serializable`.
  * **Reading** never gives you a `date`. The column always comes back as a
    `datetime` at midnight, so `row.some_date == today` — the obvious thing to
    write, against a column whose name and schema type both say "date" — is
    False on the very day it should be True.

Neither half announces itself. The write throws somewhere the caller has often
stopped watching; the read produces a plausible-looking `False` that reads as
"the user hasn't done it yet". Between them they accounted for three live bugs
found on 2026-09-08, on three different columns:

  * `srsLastChestDate` — the write threw on every credited session completion,
    so the column stayed NULL forever and the daily chest had **never** been
    handed out. Fixing that exposed the read half on the same column, which
    would have granted a chest per session instead of per day.
  * `srsLastSessionDate` — `/daily/state` compared it to a `date`, so
    `today_done` was False for a user who had practised an hour earlier.

They are one-line mistakes that are individually invisible and collectively a
pattern, which is the case for a named helper rather than a comment repeated at
each site. Use `utc_midnight` on the way in and `as_date` on the way out, and
neither mistake is available to make.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional, Union


def utc_midnight(day: Union[date, datetime]) -> datetime:
    """The `datetime` to store for a calendar day in a `@db.Date` column.

    Accepts either type so a caller does not have to know which one it is
    holding — the common shape is `now.date()` on one path and a column read
    back on another, and the whole point is that those look alike and are not.
    """
    if isinstance(day, datetime):
        day = day.date()
    return datetime(day.year, day.month, day.day, tzinfo=timezone.utc)


def as_date(value: Union[date, datetime, None]) -> Optional[date]:
    """The `date` a `@db.Date` column meant, whatever it handed back.

    Call this before comparing such a column to anything. `None` passes
    through, because "never" is a real value for every column this guards and
    is already correctly unequal to any day.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    return value
