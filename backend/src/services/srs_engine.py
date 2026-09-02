"""
Shared SRS (Leitner) primitives.

The schedule and the per-card "advance" logic used to live solely inside
`routes/srs.py:record_review`. Extracted here so two callers can share it:

  1. `routes/srs.py` — one-card-at-a-time review flow (`POST /srs/review`).
  2. `routes/quiz.py` — many-cards-at-once session completion
     (`POST /quiz/sessions/{id}/complete`) needs to advance every scored
     card's box so the daily SRS queue eventually pulls it back.

Module split:
  • Pure helpers (no DB, no clock-side-effects) — easily unit-testable.
  • Async DB-touching `advance_*` functions — single source of truth for
    how a review writes back to `user_words` and the per-user rollup.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Optional

from prisma import Prisma

from .milestone_service import apply_milestone_unlocks, parse_unlocked

# Leitner intervals in days, indexed by (box - 1). Box 1 → 1 day after a
# correct answer, box 5 → 30 days. A card at box 5 that the user still
# remembers stays at box 5 and gets +30 days.
BOX_INTERVALS_DAYS: list[int] = [1, 3, 7, 14, 30]
MAX_BOX: int = len(BOX_INTERVALS_DAYS)


# ── Pure helpers ────────────────────────────────────────────────────────────

def next_due_after(box: int, *, now: Optional[datetime] = None) -> datetime:
    """Next-due timestamp for a card now in `box`. Clamped to [1, MAX_BOX]."""
    idx = max(0, min(box, MAX_BOX) - 1)
    base = now if now is not None else datetime.now(timezone.utc)
    return base + timedelta(days=BOX_INTERVALS_DAYS[idx])


def compute_new_box(current_box: Optional[int], correct: bool) -> int:
    """Correct → advance by one (clamped). Incorrect → reset to box 1."""
    if correct:
        return min(MAX_BOX, (current_box or 1) + 1)
    return 1


def can_free_user_start_session_today(
    last_session_started_at: Optional[datetime],
    *,
    now: Optional[datetime] = None,
) -> bool:
    """Daily-cap gate for /srs/session/start.

    Free users get one SRS session per UTC day. Returns True if a session
    is allowed right now — either because the user has never started one,
    or because the last start was on a different UTC date than `now`.
    Premium callers bypass this entirely; this helper is for the free path.

    UTC was picked over user-local time deliberately: the server has no
    reliable client timezone, and a single timezone shift at midnight UTC
    is easier to explain than per-user resets that vary by location.
    """
    if last_session_started_at is None:
        return True
    n = now if now is not None else datetime.now(timezone.utc)
    return last_session_started_at.date() != n.date()


def compute_new_streak(
    prev_streak: int,
    last_session_date: Optional[date],
    today: date,
) -> int:
    """Yesterday-or-today streak rule.

    - First-ever session, or gap ≥ 2 days → start fresh at 1.
    - Exactly one-day gap → previous streak + 1.
    - Same day → unchanged (idempotent re-bumps in a single session don't
      inflate the streak).

    Defensive: Prisma Python sometimes hands back `datetime` for an
    `@db.Date` column. Normalize either input to `.date()` so we don't
    crash on a `date - datetime` subtraction.
    """
    if last_session_date is None:
        return 1
    if isinstance(last_session_date, datetime):
        last_session_date = last_session_date.date()
    if isinstance(today, datetime):
        today = today.date()
    delta = (today - last_session_date).days
    if delta >= 2:
        return 1
    if delta == 1:
        return prev_streak + 1
    return prev_streak  # same day, or clock-skew negative


# ── DB-touching async helpers ───────────────────────────────────────────────

async def advance_word_after_review(
    db: Prisma,
    *,
    user_word_id: int,
    current_box: Optional[int],
    correct: bool,
    now: Optional[datetime] = None,
) -> tuple[int, datetime]:
    """Persist a single card's box advancement.

    Caller is responsible for authorization (verifying the userword row
    belongs to the requesting user) — this helper trusts its inputs.
    Returns the new (box, next_due) so the caller can echo it back to
    the client.
    """
    new_box = compute_new_box(current_box, correct)
    when = now if now is not None else datetime.now(timezone.utc)
    next_due = next_due_after(new_box, now=when)
    await db.userword.update(
        where={"id": user_word_id},
        data={
            "srsBox": new_box,
            "srsDueAt": next_due,
            "srsLastReviewedAt": when,
        },
    )
    return new_box, next_due


async def advance_user_rollup_after_review(
    db: Prisma,
    *,
    user_id: int,
    correct_count: int,
    total_count: int,
    today: Optional[date] = None,
) -> None:
    """Bump per-user SRS stats after a review session.

    `total_count` and `correct_count` may both be > 1 — the daily-quiz
    bridge submits a whole session's worth of cards at once and wants
    one rollup write covering them all (rather than N round-trips).

    Streak rule: see `compute_new_streak`. Same-day re-calls are
    idempotent on the streak number (still bump totals).
    """
    if total_count <= 0:
        return  # nothing scored, nothing to roll up

    user = await db.user.find_unique(where={"id": user_id})
    if user is None:
        return  # user disappeared mid-flight; nothing to do

    day = today if today is not None else datetime.now(timezone.utc).date()
    prev_total = user.srsTotalReviews or 0
    prev_correct = user.srsTotalCorrect or 0
    prev_streak = user.srsCurrentStreak or 0
    prev_longest = user.srsLongestStreak or 0
    last_date = user.srsLastSessionDate

    new_streak = compute_new_streak(prev_streak, last_date, day)
    new_longest = max(prev_longest, new_streak)

    # Prisma Python's JSON encoder rejects bare `date` — must hand it
    # a `datetime`. The @db.Date column stores just the date part.
    day_dt = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
    await db.user.update(
        where={"id": user_id},
        data={
            "srsTotalReviews": prev_total + total_count,
            "srsTotalCorrect": prev_correct + correct_count,
            "srsCurrentStreak": new_streak,
            "srsLongestStreak": new_longest,
            "srsLastSessionDate": day_dt,
        },
    )

    # v0.6 W10: persist any cinema-named milestone unlocks crossed by
    # this bump. Same-day re-bumps return [] from crossed_milestones
    # because the streak didn't change (compute_new_streak is idempotent
    # in that case), so this is naturally rate-limited.
    await apply_milestone_unlocks(
        db,
        user_id=user_id,
        prev_streak=prev_streak,
        new_streak=new_streak,
        current_unlocked=parse_unlocked(user.unlockedCosmetics),
    )


async def record_session_day(
    db: Prisma,
    *,
    user_id: int,
    today: Optional[date] = None,
) -> int:
    """Mark today as a completed-session day and return the resulting streak.

    The streak and `srsLastSessionDate` used to be written *only* by
    `advance_user_rollup_after_review`, i.e. only as a side effect of
    `POST /srs/review`. The mobile client fires those per-card calls
    fire-and-forget — a failure is logged and swallowed, on the reasoning
    that a lost card outcome just means the scheduler shows that word once
    more. That reasoning is right about the card and wrong about the day:
    with the per-card writes gone, nothing recorded that the user practised
    at all, so a session finished on a flaky connection left the client
    celebrating "day 5" while the server still believed 4.

    `POST /srs/session/complete` calls this so the *session*, not the
    individual card, is what anchors the habit. Deliberately separate from
    `advance_user_rollup_after_review`: that one also adds to
    `srsTotalReviews` / `srsTotalCorrect`, which must stay one-per-card, and
    calling it here would double-count every session's answers.

    Idempotent by construction — when `srsLastSessionDate` is already today
    there is nothing to write, so repeat calls (a retry, a premium user's
    second session, the last `/srs/review` landing after this one) all
    return the same number without touching the row.
    """
    user = await db.user.find_unique(where={"id": user_id})
    if user is None:
        return 0

    day = today if today is not None else datetime.now(timezone.utc).date()
    last_date = user.srsLastSessionDate
    if isinstance(last_date, datetime):
        last_date = last_date.date()
    prev_streak = user.srsCurrentStreak or 0
    if last_date == day:
        return prev_streak

    new_streak = compute_new_streak(prev_streak, last_date, day)
    day_dt = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
    await db.user.update(
        where={"id": user_id},
        data={
            "srsCurrentStreak": new_streak,
            "srsLongestStreak": max(user.srsLongestStreak or 0, new_streak),
            "srsLastSessionDate": day_dt,
        },
    )
    await apply_milestone_unlocks(
        db,
        user_id=user_id,
        prev_streak=prev_streak,
        new_streak=new_streak,
        current_unlocked=parse_unlocked(user.unlockedCosmetics),
    )
    return new_streak
