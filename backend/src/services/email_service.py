"""
Transactional email via the Resend HTTP API.

Design (MVP, deliberately small):
  • One low-level `send_email` that POSTs to Resend with httpx. When
    RESEND_API_KEY is empty (local dev, tests, prod-before-signup) every
    send becomes a logged no-op that returns False — no network, no crash.
  • Template builders are pure functions returning (subject, html, text)
    so they can be unit-tested without any I/O.
  • Callers fire these from FastAPI BackgroundTasks: email must never
    block or fail a signup. `send_email` therefore swallows transport
    errors after logging them.

Ops: set RESEND_API_KEY and EMAIL_FROM in Railway (the FROM domain must be
verified in the Resend dashboard, e.g. getwordwise.us) to turn sending on.
"""
from __future__ import annotations

import logging

import httpx

from ..config import get_settings

logger = logging.getLogger(__name__)

RESEND_ENDPOINT = "https://api.resend.com/emails"
_SEND_TIMEOUT_SECONDS = 10.0

# Shared shell for every mail we send: dark header bar with the wordmark,
# warm paper body. Inline styles only — email clients strip <style> blocks.
_LAYOUT = """\
<div style="margin:0;padding:24px 12px;background-color:#f4efe7;font-family:Georgia,'Times New Roman',serif;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5dcc9;border-radius:12px;overflow:hidden;">
    <div style="background:#1c1a17;padding:18px 28px;">
      <span style="color:#d4af37;font-size:18px;font-weight:bold;letter-spacing:1px;">WordWise</span>
    </div>
    <div style="padding:28px;color:#2b2620;font-size:15px;line-height:1.6;">
      {body}
    </div>
    <div style="padding:16px 28px;border-top:1px solid #e5dcc9;color:#8a8272;font-size:12px;">
      You're receiving this because an account was created on WordWise with this address.
    </div>
  </div>
</div>
"""


def build_welcome_email(username: str) -> tuple[str, str, str]:
    """(subject, html, text) for the post-signup welcome email."""
    subject = "Welcome to WordWise 🎬"
    body = (
        f"<p style=\"margin:0 0 14px;\">Hi {username},</p>"
        "<p style=\"margin:0 0 14px;\">Welcome to <strong>WordWise</strong> — you now learn "
        "English from the movies you actually want to watch.</p>"
        "<p style=\"margin:0 0 6px;\">Three ways to get going:</p>"
        "<ul style=\"margin:0 0 14px;padding-left:20px;\">"
        "<li>Add a film you love and explore its vocabulary</li>"
        "<li>Save words as you read — they go straight to your review deck</li>"
        "<li>Do one short review a day to build your streak</li>"
        "</ul>"
        "<p style=\"margin:0;\">See you in the app,<br/>The WordWise team</p>"
    )
    text = (
        f"Hi {username},\n\n"
        "Welcome to WordWise — you now learn English from the movies you actually want to watch.\n\n"
        "Three ways to get going:\n"
        "  - Add a film you love and explore its vocabulary\n"
        "  - Save words as you read — they go straight to your review deck\n"
        "  - Do one short review a day to build your streak\n\n"
        "See you in the app,\nThe WordWise team\n"
    )
    return subject, _LAYOUT.format(body=body), text


def build_password_reset_email(username: str, reset_url: str) -> tuple[str, str, str]:
    """(subject, html, text) for the forgot-password email."""
    subject = "Reset your WordWise password"
    body = (
        f"<p style=\"margin:0 0 14px;\">Hi {username},</p>"
        "<p style=\"margin:0 0 18px;\">Tap the button below to choose a new password. "
        "The link is valid for 30 minutes and can be used once.</p>"
        f"<p style=\"margin:0 0 18px;\"><a href=\"{reset_url}\" "
        "style=\"display:inline-block;background:#d4af37;color:#1c1a17;text-decoration:none;"
        "font-weight:bold;padding:12px 22px;border-radius:8px;\">Reset password</a></p>"
        "<p style=\"margin:0 0 14px;color:#8a8272;font-size:13px;\">Or paste this link into your browser:<br/>"
        f"<a href=\"{reset_url}\" style=\"color:#8a8272;word-break:break-all;\">{reset_url}</a></p>"
        "<p style=\"margin:0;color:#8a8272;font-size:13px;\">Didn't request this? "
        "You can safely ignore this email — your password stays unchanged.</p>"
    )
    text = (
        f"Hi {username},\n\n"
        "Choose a new WordWise password by opening the link below "
        "(valid for 30 minutes, single use):\n\n"
        f"{reset_url}\n\n"
        "Didn't request this? You can safely ignore this email — your password stays unchanged.\n"
    )
    return subject, _LAYOUT.format(body=body), text


def build_worker_alert_email(worker: str, event: str, detail: str) -> tuple[str, str, str]:
    """(subject, html, text) for an admin-only worker health alert.

    `event` is a short state ("stuck", "recovered"); `detail` is the
    plain-text explanation (failure counts, last error). Both bodies carry
    the worker name and detail so the email is actionable from a phone
    notification alone.
    """
    subject = f"[WordWise ops] {worker} {event}"
    body = (
        f"<p style=\"margin:0 0 14px;\"><strong>{worker}</strong> — {event}.</p>"
        f"<p style=\"margin:0 0 14px;white-space:pre-wrap;\">{detail}</p>"
        "<p style=\"margin:0;color:#8a8272;font-size:13px;\">Automated alert "
        "from the WordWise background workers. Check the Railway worker logs "
        "for the full traceback.</p>"
    )
    text = (
        f"{worker} — {event}.\n\n"
        f"{detail}\n\n"
        "Automated alert from the WordWise background workers. "
        "Check the Railway worker logs for the full traceback.\n"
    )
    return subject, _LAYOUT.format(body=body), text


async def send_email(to: str, subject: str, html: str, text: str) -> bool:
    """POST one email to Resend. Returns True only on a 2xx response.

    Never raises: transactional email is best-effort by design — the caller
    (a BackgroundTask behind /auth/register) must not care whether the
    provider was up.
    """
    settings = get_settings()
    if not settings.resend_api_key:
        logger.info("[email] RESEND_API_KEY not set — skipping send to=%s subject=%r", to, subject)
        return False

    payload = {
        "from": settings.email_from,
        "to": [to],
        "subject": subject,
        "html": html,
        "text": text,
    }
    try:
        async with httpx.AsyncClient(timeout=_SEND_TIMEOUT_SECONDS) as client:
            res = await client.post(
                RESEND_ENDPOINT,
                json=payload,
                headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            )
        if res.is_success:
            logger.info("[email] sent to=%s subject=%r", to, subject)
            return True
        logger.error("[email] provider rejected send to=%s status=%s body=%s", to, res.status_code, res.text[:500])
        return False
    except Exception:
        logger.exception("[email] send failed to=%s subject=%r", to, subject)
        return False


async def send_welcome_email(to: str, username: str) -> bool:
    subject, html, text = build_welcome_email(username)
    return await send_email(to, subject, html, text)


async def send_password_reset_email(to: str, username: str, reset_url: str) -> bool:
    subject, html, text = build_password_reset_email(username, reset_url)
    return await send_email(to, subject, html, text)
