"""Per-caller daily character budget for paid work (issue #152).

Machine translation is billed per *character*, so a request-rate limit cannot
bound cost on its own: 30 requests/minute is a fine ceiling when a request
carries 100 characters and a catastrophic one when it carries 100,000. This
module meters the dimension the provider actually charges for.

Two limits are needed and they do different jobs:

* a per-request cap bounds one call (enforced by the request model, so it
  fails before any provider client is built);
* this daily budget bounds one caller *over time*, which is the only thing
  that stops an abuser who stays under every per-request limit.

Same in-process limitation as `rate_limit`: counters live in this process's
memory, so a second replica would give every caller a second budget. That is
acceptable at one replica by deliberate decision (issue #149) and would need a
shared store before `numReplicas` is ever raised.
"""

from __future__ import annotations

import threading
from datetime import date, datetime, time, timedelta, timezone
from typing import Callable, Dict, Tuple

from fastapi import HTTPException, status


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def seconds_until_utc_midnight(now: datetime) -> int:
    """Whole seconds until the budget rolls over, for `Retry-After`.

    At least 1: a zero tells the client to retry immediately, which is the one
    answer that is never true here.
    """
    tomorrow = datetime.combine(
        now.date() + timedelta(days=1), time.min, tzinfo=timezone.utc
    )
    return max(1, int((tomorrow - now).total_seconds()))


class DailyCharBudget:
    """How many characters one key may spend per UTC day.

    Keys are opaque strings — callers decide what identity to meter (user id
    here, since every metered endpoint requires authentication). `now` is
    injectable so the day rollover can be tested without waiting for one.
    """

    # Keys are cheap (a tuple per caller), but an unbounded dict is still a
    # leak on a long-lived process. Swept at this size, dropping anything from
    # a previous day — which is exactly the entries that no longer bind.
    _GC_THRESHOLD = 10_000

    def __init__(
        self,
        limit: int,
        *,
        scope: str,
        now: Callable[[], datetime] = _utc_now,
    ) -> None:
        self.limit = limit
        self.scope = scope
        self._now = now
        self._spent: Dict[str, Tuple[date, int]] = {}
        self._lock = threading.Lock()

    def _today_and_spent(self, key: str) -> Tuple[date, int]:
        today = self._now().date()
        day, spent = self._spent.get(key, (today, 0))
        return today, (spent if day == today else 0)

    def spent(self, key: str) -> int:
        """Characters `key` has spent so far today."""
        with self._lock:
            return self._today_and_spent(key)[1]

    def remaining(self, key: str) -> int:
        with self._lock:
            return max(0, self.limit - self._today_and_spent(key)[1])

    def reserve(self, key: str, chars: int) -> bool:
        """Charge `chars` to `key`, or return False and charge nothing.

        All-or-nothing on purpose: a partially served batch would leave the
        caller unable to tell which texts came back, and the per-request cap
        already bounds how much one rejection wastes.
        """
        with self._lock:
            today, spent = self._today_and_spent(key)
            if spent + chars > self.limit:
                # Still record the rollover so today's tally starts clean.
                self._spent[key] = (today, spent)
                return False
            self._spent[key] = (today, spent + chars)
            if len(self._spent) > self._GC_THRESHOLD:
                self._gc(today)
            return True

    def charge(self, key: str, chars: int) -> None:
        """`reserve`, or 429 with the seconds until the budget rolls over."""
        if self.reserve(key, chars):
            return
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "Daily translation limit reached. "
                "Your allowance resets at midnight UTC."
            ),
            headers={"Retry-After": str(seconds_until_utc_midnight(self._now()))},
        )

    def _gc(self, today: date) -> None:
        stale = [k for k, (day, _) in self._spent.items() if day != today]
        for k in stale:
            del self._spent[k]

    def reset(self) -> None:
        """Drop every tally. For tests; never call this on a live budget."""
        with self._lock:
            self._spent.clear()
