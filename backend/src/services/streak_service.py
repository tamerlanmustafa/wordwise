"""
v0.6 streak mercy infrastructure.

Two layers:
  • Pure helpers (no DB): the decisions about when to grant a weekly
    freeze, how many missed-day freezes to consume, and whether to offer
    a repair window. Easily unit-tested.
  • Async DB-touching wrappers: read the user's freeze inventory, apply
    the decisions, and update `users` + `user_streak_freezes` atomically.

Accrual is the same for everyone: one freeze per ISO week, earned by
COMPLETING a session (not by opening the app), plus a 20% chest roll once a
day. Deliberately not tiered — the grant rewards the habit, and slowing it for
free users would punish the exact behaviour the feature exists to encourage.

What is tiered is what you can do with them: free arms one at a time and banks
two, Plus arms two and banks five (`max_equipped_for` / `max_held_for`). Since
consumption is all-or-nothing and only ARMED freezes are ever spent, the armed
count is the whole promise — one covers a one-day absence, two covers two
consecutive days.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import logging
from typing import Optional

from prisma import Prisma

from ..utils.dates import as_date, local_today, utc_midnight
from ..utils.subscription import is_premium

logger = logging.getLogger(__name__)

# Ceiling on simultaneously-held freezes, ACROSS ALL TIERS. Goes well past the
# "one freeze per week" baseline to allow IAP top-ups, but small enough that we
# don't accumulate a hoard that defeats the mercy intent.
#
# The per-tier caps are `max_held_for` / `max_equipped_for` below; these two
# constants remain the widest any account can go, which is what the chest's
# reroll and the pure helpers' defaults are written against.
MAX_FREEZES_HELD: int = 5

# Cap on how many freezes may be ARMED at once.
#
# Without a cap the arming "decision" is not one: consumption is all-or-
# nothing, so more armed is strictly better with no downside, and the rational
# move is always to arm everything — which makes the equip UI decoration.
#
# A cap does not turn it into a free choice either, and it is worth being
# honest about that: with one fungible resource and no cost to arming, a user
# will still arm up to the cap every time. What the cap actually buys is a
# BOUND on automatic mercy — a long absence can no longer quietly drain a hoard
# of five — and a legible promise: "you are covered for up to two days". Making
# arming a genuine trade-off needs unarmed freezes to be good for something
# else (a manual repair of an already-broken streak, say), which is a separate
# feature rather than a constant.
#
# Two, matching the shape this model was taken from. This is the PREMIUM cap
# and the ceiling across all tiers; free accounts get `FREE_MAX_EQUIPPED`.
MAX_EQUIPPED_FREEZES: int = 2


# ── Per-tier caps ───────────────────────────────────────────────────────────
#
# Exactly one knob differs between the tiers, and it is the armed-slot count,
# because it is the only one that turns into a sentence a user can hold in
# their head: free is "covered if you miss a day", Plus is "covered if you miss
# two in a row".
#
# What deliberately does NOT differ: the weekly grant and the chest odds. Those
# are earned by practising, and slowing accrual for free users would punish the
# exact behaviour the whole feature exists to encourage. The tier difference
# lives entirely in what you can DO with what you earned.
#
# The hold cap moves with the slot count only to keep the UI honest: letting a
# free user bank five freezes they can never arm more than one of reads as a
# broken screen ("why do I have five if only one works?"), not as generosity.
FREE_MAX_HELD: int = 2
FREE_MAX_EQUIPPED: int = 1


def max_held_for(user: object) -> int:
    """How many freezes this account may bank.

    **A grant gate, never a confiscation.** A free user who is already holding
    five — every free user is, since the caps used to be uniform — keeps all
    five. The cap only stops new ones arriving until they have spent down. Any
    other reading means taking something a user already earned, on a release
    they did not ask for.
    """
    return MAX_FREEZES_HELD if is_premium(user) else FREE_MAX_HELD


def max_equipped_for(user: object) -> int:
    """How many freezes this account may have standing guard at once.

    Because consumption is all-or-nothing and only armed freezes are ever
    spent, this number IS the promise: one armed covers a one-day absence, two
    covers two consecutive days, and a longer gap breaks the streak whatever is
    in the inventory.
    """
    return MAX_EQUIPPED_FREEZES if is_premium(user) else FREE_MAX_EQUIPPED


# ── Pure helpers ────────────────────────────────────────────────────────────

def should_auto_grant_weekly(
    today: date,
    held_count: int,
    last_weekly_grant: Optional[date],
    *,
    max_held: int = MAX_FREEZES_HELD,
) -> bool:
    """Decide whether to grant a free weekly freeze right now.

    Rule: the first /daily/state read each ISO calendar week earns one
    freeze, unless the user already holds the cap. Idempotent for repeat
    reads in the same week (last_weekly_grant carries the marker).
    """
    if held_count >= max_held:
        return False
    if last_weekly_grant is None:
        return True
    return today.isocalendar()[:2] != last_weekly_grant.isocalendar()[:2]


def freezes_to_consume_for_gap(
    today: date,
    last_session_date: Optional[date],
    held_count: int,
) -> int:
    """How many armed freezes to burn right now — all of them, or none.

    A freeze covers exactly one missed day. With `(today - last) = k` the user
    has missed `k - 1` days (none when k <= 1).

    ## All or nothing, and why that is the whole fix

    This used to return `min(missed_days, held_count)` — "burn what we have",
    asserted on purpose by a test of that name. It is wrong in the one case
    that matters, because a freeze that does not bridge the *entire* gap saves
    nothing: `compute_new_streak` resets on any remaining gap of two or more
    days, so the partial burn buys a shorter gap and an identical outcome.
    Simulated against these functions before the change:

        gap  held  burned  streak after
         3     2      2      kept
         3     1      1      LOST      <- freeze spent for nothing
         5     2      2      LOST      <- two spent for nothing
        10     8      8      LOST      <- eight spent for nothing

    A user who was away ten days came back to no freezes and a streak of 1.
    Doing nothing would have left them the freezes. So: spend only when the
    spend achieves the thing the resource exists for, and otherwise spend
    nothing and let the streak break honestly.

    `held_count` is the count of **armed** freezes (see `count_equipped_freezes`).
    Held-but-unarmed ones are inventory, not insurance, and are never spent.
    """
    if last_session_date is None or held_count <= 0:
        return 0
    delta = (today - last_session_date).days
    missed_days = max(0, delta - 1)
    if missed_days == 0:
        return 0
    # The whole gap, or nothing at all.
    if missed_days > held_count:
        return 0
    return missed_days


def repair_window_active(
    today: date,
    last_session_date: Optional[date],
    held_count: int,
) -> bool:
    """True iff the user is in the narrow repair window.

    Eligible: missed exactly one day, held no freezes when that day
    rolled over (so auto-consume couldn't save them). The frontend uses
    this to offer the "save your streak" modal.
    """
    if last_session_date is None or held_count > 0:
        return False
    return (today - last_session_date).days == 2


# ── DB-touching wrappers ────────────────────────────────────────────────────

async def count_held_freezes(db: Prisma, user_id: int) -> int:
    """Everything in the inventory, armed or not — what the UI counts."""
    return await db.userstreakfreeze.count(
        where={"userId": user_id, "consumedAt": None}
    )


async def count_equipped_freezes(db: Prisma, user_id: int) -> int:
    """What is actually standing between the user and a broken streak.

    Held-but-unarmed freezes are inventory; only an armed one is ever spent.
    That distinction is the whole of "the user decides": the decision is made
    in advance, when they arm it, rather than by the app on a day they are not
    even in the app to see.
    """
    return await db.userstreakfreeze.count(
        where={"userId": user_id, "consumedAt": None, "equippedAt": {"not": None}}
    )


async def equip_freeze(
    db: Prisma,
    *,
    user_id: int,
    max_equipped: int = MAX_EQUIPPED_FREEZES,
    now: Optional[datetime] = None,
) -> bool:
    """Arm the oldest unarmed freeze. False when nothing to arm, or at the cap.

    `max_equipped` is the caller's tier cap (`max_equipped_for`). It defaults
    to the widest any account can go, so a caller that forgets it is permissive
    rather than silently punitive — the failure the user would never report.

    Oldest-first for the same reason `consume_freeze` is: freezes are
    fungible, and spending the one that has been sitting longest keeps the
    inventory from developing a permanently-stuck tail.

    ## Why this takes a lock, when `consume_freeze` needed only one statement

    Both guard a limit against concurrent callers, and the cheap trick that
    works for one does not work for the other.

    `consume_freeze` claims a *specific row*, so `UPDATE ... WHERE id = (SELECT
    ... FOR UPDATE SKIP LOCKED)` is enough: two callers contend over the same
    row and exactly one wins. The cap here is not a property of any row — it is
    a property of a COUNT over rows, and no row lock covers a count. Folding
    the count into the statement as a subquery reads no better: under READ
    COMMITTED the subquery sees the snapshot taken when the statement began, so
    two equips that start together both count 1, both find a *different* unarmed
    freeze (the second one's `find` runs after the first one's commit), and both
    arm. Three armed, against a cap of two. That is a phantom read, and the
    classic fix is to serialise on a row that all the contending statements must
    hold — the parent.

    So: lock `users` for this user, then count and arm inside that transaction.
    The lock is per-user and held for two short statements, which is the right
    granularity — it blocks this user's own second device and nobody else's
    request, and the server's rule is that one user must never block another.

    The alternative, a `slot` column with a partial unique index, would make the
    cap structurally impossible to exceed rather than merely serialised. Worth
    revisiting if arming ever becomes frequent enough for the lock to show up,
    but it is a migration to solve a problem this does not have.
    """
    when = now if now is not None else datetime.now(timezone.utc)
    async with db.tx() as tx:
        # The serialisation point. Nothing reads this row's contents — taking
        # the lock IS the statement's purpose, so a concurrent equip for the
        # same user waits here rather than racing the count below.
        await tx.query_raw("SELECT id FROM users WHERE id = $1 FOR UPDATE", user_id)

        if await count_equipped_freezes(tx, user_id) >= max_equipped:
            return False
        spare = await tx.userstreakfreeze.find_first(
            where={"userId": user_id, "consumedAt": None, "equippedAt": None},
            order={"acquiredAt": "asc"},
        )
        if spare is None:
            return False
        await tx.userstreakfreeze.update(
            where={"id": spare.id}, data={"equippedAt": when}
        )
        return True


async def unequip_freeze(db: Prisma, *, user_id: int) -> bool:
    """Disarm the most recently armed freeze. False when none is armed.

    Newest-first, the mirror of `equip_freeze`: disarming should undo the most
    recent arming rather than reach past it.
    """
    armed = await db.userstreakfreeze.find_first(
        where={"userId": user_id, "consumedAt": None, "equippedAt": {"not": None}},
        order={"equippedAt": "desc"},
    )
    if armed is None:
        return False
    await db.userstreakfreeze.update(
        where={"id": armed.id}, data={"equippedAt": None}
    )
    return True


async def autoarm_freezes_once(db: Prisma, *, user: object) -> int:
    """Arm a pre-existing inventory, one time only. Returns how many were armed.

    ## The seam this patches

    Two decisions, each right on its own. The migration that added `equipped_at`
    left every existing freeze UNARMED, because nobody should lose a freeze to a
    rule they were never shown. The consume path then started spending only
    ARMED freezes, because the spend is the user's decision. Together they made
    every freeze already in the wild inert — earned, counted in the header, and
    incapable of covering anything. No user chose that and no user can see it.

    So the app arms up to the tier cap once, on the next visit, and says so.

    ## Why a stored marker rather than "has never armed anything"

    They are different questions. A user who deliberately stands every freeze
    down is, by that second test, indistinguishable from a user who has never
    touched the control — so the app would silently re-arm them on the next
    launch, overriding the decision this whole feature exists to hand over.
    `users.freeze_autoarm_at` answers the question that was actually asked.

    Idempotent by the same compare-and-swap shape as the rest of this module:
    the stamp is claimed in one statement, and only the caller that claims it
    arms anything. A second device racing the first finds the marker already
    set and does nothing.
    """
    user_id = getattr(user, "id")
    if getattr(user, "freezeAutoarmAt", None) is not None:
        return 0

    # Claim the marker BEFORE arming. Losing this race means another request is
    # already doing the work, and doing nothing is the correct response — the
    # opposite order would let two callers each arm up to the cap.
    claimed = await db.execute_raw(
        "UPDATE users SET freeze_autoarm_at = $2::timestamptz "
        "WHERE id = $1 AND freeze_autoarm_at IS NULL",
        user_id,
        datetime.now(timezone.utc),
    )
    if not claimed:
        return 0

    cap = max_equipped_for(user)
    armed = 0
    while armed < cap:
        if not await equip_freeze(db, user_id=user_id, max_equipped=cap):
            break
        armed += 1
    if armed:
        logger.info("[streak] auto-armed %s freeze(s) for user=%s", armed, user_id)
    return armed


async def find_last_weekly_grant(db: Prisma, user_id: int) -> Optional[date]:
    """Most-recent auto_weekly grant date for this user, or None."""
    row = await db.userstreakfreeze.find_first(
        where={"userId": user_id, "acquiredVia": "auto_weekly"},
        order={"acquiredAt": "desc"},
    )
    return row.acquiredAt.date() if row else None


async def grant_freeze(
    db: Prisma,
    *,
    user_id: int,
    via: str,
    now: Optional[datetime] = None,
) -> None:
    """Credit one freeze to the user. Caller is responsible for cap checks."""
    when = now if now is not None else datetime.now(timezone.utc)
    await db.userstreakfreeze.create(data={
        "userId": user_id,
        "acquiredAt": when,
        "acquiredVia": via,
    })


async def consume_freeze(
    db: Prisma,
    *,
    user_id: int,
    reason: str,
    now: Optional[datetime] = None,
    covered_date: Optional[date] = None,
) -> bool:
    """Claim and spend the oldest ARMED freeze. False when none is claimable.

    Armed only. An unarmed freeze is inventory the user has not chosen to put
    at risk, and spending it is what this model exists to stop.

    ## One statement, not find-then-update

    This was `find_first` followed by `update`, which is a lost update waiting
    to happen: two callers read the same row and both write it, so one freeze
    pays for two days. The claim is now a single `UPDATE ... WHERE id = (SELECT
    ... FOR UPDATE SKIP LOCKED)` — the database picks the row and marks it in
    one statement, `SKIP LOCKED` hands a concurrent caller the *next* row
    instead of blocking on the same one, and `consumed_at IS NULL` in the outer
    WHERE means a loser updates nothing rather than overwriting a spend.

    `auto_apply_mercy` additionally serialises the *decision* above this (see
    its compare-and-swap), because atomic claims alone would still let two
    callers spend N rows each. Both guards are wanted: this one makes the
    function correct on its own terms, that one makes the policy correct.
    """
    when = now if now is not None else datetime.now(timezone.utc)
    covered = utc_midnight(covered_date) if covered_date is not None else None
    claimed = await db.execute_raw(
        """
        UPDATE user_streak_freezes
           SET consumed_at = $2::timestamptz,
               consumed_reason = $3,
               covered_date = $4::date
         WHERE id = (
               SELECT id FROM user_streak_freezes
                WHERE user_id = $1
                  AND consumed_at IS NULL
                  AND equipped_at IS NOT NULL
                ORDER BY acquired_at ASC
                LIMIT 1
                  FOR UPDATE SKIP LOCKED
               )
           AND consumed_at IS NULL
        """,
        user_id,
        when,
        reason,
        covered,
    )
    return bool(claimed)


async def auto_apply_mercy(
    db: Prisma,
    *,
    user_id: int,
    now: Optional[datetime] = None,
) -> dict:
    """Spend armed freezes to cover a gap, if they can cover all of it.

    Run lazily from `GET /daily/state`, because the user is by definition not
    in the app on the day they miss — something has to notice on their return.
    What changed is *what* it is allowed to notice:

      * only **armed** freezes are ever spent (see `count_equipped_freezes`);
        held-but-unarmed ones are inventory the user never put at risk;
      * they are spent **only if they cover the whole gap**. A partial burn
        bought a shorter gap and an identical broken streak — see
        `freezes_to_consume_for_gap`;
      * the **weekly grant no longer happens here**. It moved to
        `POST /srs/session/complete`, so mercy is earned by practising rather
        than by opening the app, and this read stops writing on a path the user
        did not ask for anything on.

    Returns the snapshot `/daily/state` serialises:
    `{ freezes_held, freezes_equipped, last_session_date, repair_window_active,
    auto_granted, auto_consumed }`. `auto_granted` is retained and always
    False so the response shape does not change under installed clients.
    """
    when = now if now is not None else datetime.now(timezone.utc)

    # The user is fetched FIRST so every date below is the user's own calendar
    # day. It used to be `when.date()` — the server's UTC day — which decided
    # how many days the gap arithmetic thought had been missed. See
    # utils/dates.local_today.
    user = await db.user.find_unique(where={"id": user_id})
    today = local_today(user, now=when) if user is not None else when.date()

    held = await count_held_freezes(db, user_id)
    equipped = await count_equipped_freezes(db, user_id)

    if user is None:
        return {
            "freezes_held": held,
            "freezes_equipped": equipped,
            "last_session_date": None,
            "repair_window_active": False,
            "auto_granted": False,
            "auto_consumed": 0,
        }

    # Prisma Python surfaces `@db.Date` as a `datetime`, but the gap
    # math below subtracts `today: date - last_date`. Normalize to
    # `date` at the boundary so the operands match.
    last_date_raw = user.srsLastSessionDate
    last_date: Optional[date] = (
        last_date_raw.date() if isinstance(last_date_raw, datetime) else last_date_raw
    )
    # Armed count, not held: an unarmed freeze cannot save anything, so
    # including it here would decide to burn freezes that do not exist for
    # this purpose and then fail to find them.
    burn = freezes_to_consume_for_gap(today, last_date, equipped)
    consumed = 0

    if burn > 0 and last_date is not None:
        # ── Win the right to spend, THEN spend ──────────────────────────────
        #
        # This pass runs on a GET that the Practice tab fires on mount and on
        # every hidden→visible transition, so two devices — or one app
        # double-mounting — reach here at the same moment, both read the same
        # gap, and both decide to burn it. Reproduced before this guard: five
        # concurrent /daily/state calls against 3 armed freezes and ONE missed
        # day consumed TWO freezes and rolled the date twice.
        #
        # An atomic claim on the freeze rows alone does not fix that: both
        # callers still computed `burn` from the same stale read, so they claim
        # different rows and spend 2N between them. The thing that has to be
        # serialised is the DECISION, and the anchor it was derived from is
        # `srs_last_session_date`. So: compare-and-swap it from exactly the
        # value we read. Whoever moves it first has bought the right to spend;
        # everyone else sees 0 rows affected and goes home having spent
        # nothing.
        #
        # Deliberately ordered anchor-first. If the process dies between the
        # two steps the user gets the mercy without paying for it — the wrong
        # way round is spending the freeze and then failing to roll the date,
        # which is the exact "paid and got nothing" failure the previous bug in
        # this function produced.
        rolled = last_date + timedelta(days=burn)
        won = await db.execute_raw(
            # Explicit ::date casts. prisma-client-py sends raw parameters as
            # text, and Postgres will not compare `date = text` — it raises
            # rather than coercing. The same date-type trap `utils/dates`
            # documents for the ORM path, in its SQL form.
            "UPDATE users SET srs_last_session_date = $2::date "
            "WHERE id = $1 AND srs_last_session_date = $3::date",
            user_id,
            utc_midnight(rolled),
            utc_midnight(last_date),
        )
        if won:
            for step in range(burn):
                # The day THIS freeze pays for. Recorded rather than inferred,
                # because `consumedAt` is when the pass noticed — a Tuesday
                # covered by a freeze spent on Thursday — and the week strip
                # has to tell a frozen day from a missed one.
                covers = last_date + timedelta(days=step + 1)
                ok = await consume_freeze(
                    db,
                    user_id=user_id,
                    reason="equipped_covered_missed_day",
                    now=when,
                    covered_date=covers,
                )
                if not ok:
                    # Cannot normally happen: we hold the anchor, and the armed
                    # count was read before it. If it does, the user keeps the
                    # mercy already granted by the roll — failing toward them.
                    logger.warning(
                        "[mercy] user=%s claimed %s days but only %s freezes were "
                        "claimable; the difference was granted unpaid",
                        user_id, burn, step,
                    )
                    break
                consumed += 1
            last_date = rolled
            held -= consumed
            equipped -= consumed

    return {
        "freezes_held": held,
        "freezes_equipped": equipped,
        "last_session_date": last_date,
        "repair_window_active": repair_window_active(today, last_date, equipped),
        # Retained, always False: the grant moved to session completion. Kept
        # in the shape so an installed client reading it keeps parsing.
        "auto_granted": False,
        "auto_consumed": consumed,
    }


async def grant_weekly_if_due(
    db: Prisma,
    *,
    user_id: int,
    today: date,
    max_held: int = MAX_FREEZES_HELD,
    now: Optional[datetime] = None,
) -> bool:
    """Earn the weekly freeze by practising. Called from session completion.

    It used to live inside `GET /daily/state`, which made freezes accrue by
    *opening the app* — and, because the grant keyed on the ISO week of a read,
    opening on a Sunday and again on the Monday paid two freezes in two days
    for no practice at all. Mercy for a habit should be earned by the habit.

    ## One statement

    `count` then `find` then `create` is the same lost-update shape as the
    freeze consume: two completions landing together both see "none granted
    this week" and both grant. `INSERT ... SELECT ... WHERE NOT EXISTS` makes
    the cap check and the insert one statement, so a retry or a double-tap
    cannot pay twice.

    Honest limit: under READ COMMITTED two *truly simultaneous* transactions
    can each fail to see the other's uncommitted row, so this closes retries
    and sequential double-calls but is not a hard guarantee. A guarantee needs
    a uniqueness constraint on (user, week), which needs a stored week column —
    a migration whose cost is not obviously worth an occasional extra freeze.
    Recorded here rather than silently accepted.
    """
    when = now if now is not None else datetime.now(timezone.utc)
    granted = await db.execute_raw(
        """
        INSERT INTO user_streak_freezes (user_id, acquired_at, acquired_via)
        SELECT $1, $2::timestamptz, 'auto_weekly'::freezeacquisition
         WHERE (
                 SELECT count(*) FROM user_streak_freezes
                  WHERE user_id = $1 AND consumed_at IS NULL
               ) < $3
           AND NOT EXISTS (
                 SELECT 1 FROM user_streak_freezes
                  WHERE user_id = $1
                    AND acquired_via = 'auto_weekly'
                    AND date_trunc('week', acquired_at)
                        = date_trunc('week', $2::timestamptz)
               )
        """,
        user_id,
        when,
        max_held,
    )
    return bool(granted)


# ── The week strip ──────────────────────────────────────────────────────────

#: What a single day in the strip can be. `done` and `frozen` both keep the
#: streak alive; the distinction matters because a frozen day drawn as a gap
#: reports the freeze as having failed, which is the opposite of what happened.
WEEK_DAY_STATES = ("done", "frozen", "missed", "future")


def week_bounds(today: date) -> tuple[date, date]:
    """The user's current Monday–Sunday, in their own calendar.

    Monday-first because `date.weekday()` is, and because the alternative is a
    per-locale first-day-of-week rule that the strip does not need: what the
    user reads off it is "how did this week go", and any seven consecutive days
    ending at or after today answers that. Worth revisiting only if the copy
    ever names the days.
    """
    monday = today - timedelta(days=today.weekday())
    return monday, monday + timedelta(days=6)


async def build_week(
    db: Prisma,
    *,
    user_id: int,
    today: date,
) -> list[dict]:
    """Seven days of the user's current week, for the Practice header.

    Two queries, both index-covered, both bounded to seven days:

      * completed `practice_sessions` by `local_date`
        (`ix_practice_sessions_user_day`, partial on `completed_at IS NOT NULL`)
      * spent freezes by `covered_date` (`ix_user_streak_freezes_covered`)

    Deliberately derived rather than stored. A denormalised "week" column would
    be a second copy of the same fact and would need invalidating on every
    completion, every freeze spend and every timezone change; seven rows off
    two indexes is cheaper than the bug that eventually follows from that.

    A day can be both practised and frozen only if something has gone wrong
    upstream — a freeze covering a day the user was active. `done` wins,
    because that is the fact the user experienced.
    """
    start, end = week_bounds(today)

    done_rows = await db.practicesession.find_many(
        where={
            "userId": user_id,
            "completedAt": {"not": None},
            "localDate": {"gte": utc_midnight(start), "lte": utc_midnight(end)},
        },
    )
    done = {as_date(r.localDate) for r in done_rows if r.localDate is not None}

    frozen_rows = await db.userstreakfreeze.find_many(
        where={
            "userId": user_id,
            "coveredDate": {"gte": utc_midnight(start), "lte": utc_midnight(end)},
        },
    )
    frozen = {as_date(r.coveredDate) for r in frozen_rows if r.coveredDate is not None}

    week: list[dict] = []
    for i in range(7):
        day = start + timedelta(days=i)
        if day in done:
            state = "done"
        elif day in frozen:
            state = "frozen"
        elif day > today:
            state = "future"
        else:
            state = "missed"
        week.append({"date": day.isoformat(), "state": state, "is_today": day == today})
    return week
