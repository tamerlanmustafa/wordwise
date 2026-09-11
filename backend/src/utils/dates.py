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
from typing import Any, Optional, Union
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


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


def local_today(user: Any, *, now: Optional[datetime] = None) -> date:
    """The calendar day it is **for this user**, for every streak decision.

    The streak, the free tier's one-lesson-a-day budget, the chest and the
    freeze gap arithmetic all used `datetime.now(timezone.utc).date()`. That
    was recorded as a deliberate choice — the server had no reliable client
    timezone — and the premise stopped being true once the mobile client began
    reporting one.

    What it cost while it was UTC: at UTC+13 a session practised at 10am local
    on Monday is stamped Sunday 21:00 UTC, so two consecutive local mornings
    can share one UTC day (the streak does not advance, and the user is told
    they have already practised) or straddle two (a single sitting spends two
    days of a free budget). At UTC-8 the day rolls over at 4pm local instead.

    Falls back to UTC on every failure path, and they are all real:

      * `user.timezone` is NULL — every account before the column existed, and
        every account whose client has not reported one yet.
      * the stored name is not a zone this machine knows. `zoneinfo` reads the
        host tzdata, so a name that resolves on a developer laptop can raise in
        a slim container. A wrong-but-consistent day beats a 500 on the streak.

    Takes the whole user rather than a zone string so call sites cannot pass
    the wrong field, and so the fallback lives in exactly one place.
    """
    moment = now if now is not None else datetime.now(timezone.utc)
    name = getattr(user, "timezone", None)
    if not name:
        return moment.astimezone(timezone.utc).date()
    try:
        return moment.astimezone(ZoneInfo(name)).date()
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        return moment.astimezone(timezone.utc).date()
