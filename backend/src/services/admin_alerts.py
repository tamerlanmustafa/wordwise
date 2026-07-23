"""
Admin-only operational alerts, emailed via the existing Resend service.

Fired by the long-running workers when they detect they can no longer make
progress (e.g. every backlog query timing out — the 2026-07-22 sentence
worker outage went unnoticed for hours because nothing paged anyone).
Deliberately email-only: there is no server-side notification inbox, and a
stuck worker matters even when no admin is in the app.

Recipients come from `users.is_admin`, overridable with ADMIN_ALERT_EMAILS
(comma-separated). The override doubles as the fallback when the DB lookup
itself fails — which is likely, since a broken DB is a common reason a
worker gets stuck in the first place.

Spam control lives in ConsecutiveFailureAlerter: alert only after
`threshold` consecutive failures, then stay quiet for `cooldown` seconds;
send one recovery email when progress resumes after an alert. State is
in-process only — a worker restart can re-alert once, which is fine.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Awaitable, Callable, List, Optional, Sequence

from .email_service import build_worker_alert_email, send_email

logger = logging.getLogger(__name__)

DEFAULT_FAILURE_THRESHOLD = int(os.environ.get("ADMIN_ALERT_FAILURE_THRESHOLD", "5"))
DEFAULT_COOLDOWN_SECONDS = float(
    os.environ.get("ADMIN_ALERT_COOLDOWN_SECONDS", str(6 * 3600))
)

# Works through both DB stacks the workers use: prisma's `db.query_raw` and
# asyncpg's `pool.fetch` both accept a SQL string and return dict-like rows.
FetchRows = Callable[[str], Awaitable[Sequence]]

_ADMIN_EMAILS_SQL = (
    "SELECT email FROM users WHERE is_admin IS TRUE AND email IS NOT NULL"
)


def _env_emails() -> List[str]:
    raw = os.environ.get("ADMIN_ALERT_EMAILS", "")
    return [e.strip() for e in raw.split(",") if e.strip()]


async def resolve_admin_emails(fetch_rows: Optional[FetchRows]) -> List[str]:
    """ADMIN_ALERT_EMAILS if set, else the DB's admin users. Never raises."""
    env = _env_emails()
    if env:
        return env
    if fetch_rows is None:
        return []
    try:
        rows = await fetch_rows(_ADMIN_EMAILS_SQL)
        return [r["email"] for r in rows]
    except Exception as exc:
        logger.warning("[admin-alerts] admin email lookup failed: %s", exc)
        return []


async def send_admin_alert(
    fetch_rows: Optional[FetchRows], worker: str, event: str, detail: str
) -> int:
    """Email every admin. Returns the number of successful sends. Never raises."""
    emails = await resolve_admin_emails(fetch_rows)
    if not emails:
        logger.warning(
            "[admin-alerts] no recipients (no is_admin users reachable and "
            "ADMIN_ALERT_EMAILS unset); dropping alert %s/%s", worker, event,
        )
        return 0
    subject, html, text = build_worker_alert_email(worker, event, detail)
    sent = 0
    for to in emails:
        try:
            if await send_email(to, subject, html, text):
                sent += 1
        except Exception:  # send_email shouldn't raise, but an alert must never crash a worker
            logger.exception("[admin-alerts] send failed to=%s", to)
    logger.info("[admin-alerts] %s/%s alert sent to %d/%d admins", worker, event, sent, len(emails))
    return sent


class ConsecutiveFailureAlerter:
    """
    Tracks one worker loop's consecutive failures and emails admins when the
    loop looks stuck. Call record_failure(exc) on every failed iteration and
    record_success() on every productive one; both are safe to call from the
    loop's hot path (no I/O unless an alert or recovery actually fires).
    """

    def __init__(
        self,
        worker: str,
        *,
        fetch_rows: Optional[FetchRows] = None,
        threshold: Optional[int] = None,
        cooldown: Optional[float] = None,
    ):
        self.worker = worker
        self._fetch_rows = fetch_rows
        self.threshold = threshold if threshold is not None else DEFAULT_FAILURE_THRESHOLD
        self.cooldown = cooldown if cooldown is not None else DEFAULT_COOLDOWN_SECONDS
        self.failures = 0
        self._last_alert_at: Optional[float] = None
        self._alert_active = False

    async def record_failure(self, exc: BaseException) -> None:
        self.failures += 1
        if self.failures < self.threshold:
            return
        now = time.monotonic()
        if self._last_alert_at is not None and now - self._last_alert_at < self.cooldown:
            return
        self._last_alert_at = now
        self._alert_active = True
        await send_admin_alert(
            self._fetch_rows,
            self.worker,
            "stuck",
            f"{self.failures} consecutive failures; not making progress.\n"
            f"Last error: {exc!r}",
        )

    async def record_success(self) -> None:
        if self._alert_active:
            self._alert_active = False
            await send_admin_alert(
                self._fetch_rows,
                self.worker,
                "recovered",
                f"Making progress again after {self.failures} consecutive failures.",
            )
        self.failures = 0
