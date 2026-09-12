"""The chest is off, and the way it is off is the point.

Three of its four rewards were not real. XP (65% of rolls) accumulates on
`UserQuizStats.xp` and the only screen rendering that total is the leaderboard,
which nothing in the app navigates to. The cosmetic (15%) is a name with no
collection behind it, as the reward pool's own comment admits. That left the
freeze at 20% as the only outcome with consequences, wrapped in a reveal
animation implying four.

So it is paused, not deleted — and these tests exist to keep "paused" from
quietly becoming "broken". A feature nobody exercises rots: the last time this
one was silently non-functional (two serialisation bugs on `srsLastChestDate`)
it cost every user the chest for months and nobody noticed, because the failure
was a missing animation rather than an error. The switch must therefore be the
*only* thing standing between here and a working chest.

What these pin:

  * the flag is off, and flipping it is a source edit somebody reviews;
  * with it off, the ledger column is never stamped — so re-enabling is clean
    and needs no unwind;
  * with it forced on, the whole path still works.
"""
from datetime import datetime, timezone

import pytest

from src.services.chest_service import CHEST_ENABLED, pick_chest_reward

pytestmark = pytest.mark.asyncio


class TestTheSwitch:
    async def test_it_is_off(self):
        assert CHEST_ENABLED is False

    async def test_it_is_a_constant_not_an_environment_variable(self):
        # Deliberate: an env var invites a flip in the Railway dashboard by
        # someone who has not read why it is off. The reason is a product gap
        # (XP has no surface and no sink), not a deployment preference.
        import inspect

        import src.services.chest_service as mod

        src = inspect.getsource(mod)
        flag_line = next(
            line for line in src.splitlines() if line.startswith("CHEST_ENABLED")
        )
        assert "environ" not in flag_line
        assert "getenv" not in flag_line

    async def test_the_picker_still_works_underneath(self):
        # The logic is intact, not stubbed out. Whoever re-enables this should
        # find a working feature, not a shell.
        reward = pick_chest_reward(freezes_held=0)
        assert reward.kind in {"xp_small", "xp_large", "freeze", "cosmetic"}
        assert reward.label


class TestNothingIsWrittenWhileItIsOff:
    """The half that makes re-enabling clean."""

    async def test_a_completed_session_stamps_no_chest_date(self):
        # If the ledger were stamped while the feature were off, re-enabling
        # would silently owe the user nothing until the next day — a bug whose
        # only symptom is an absent animation, which is the exact shape of the
        # last one that lived here for months.
        from tests.test_session_completion import _FakeDb, _complete, _user

        db = _FakeDb(_user(srsLastChestDate=None))
        res = await _complete(db, correct=8, total=10, kind="practice")

        assert res.chest is None
        assert not [u for u in db.user.updates if "srsLastChestDate" in u]

    async def test_it_does_not_report_the_chest_as_already_claimed(self):
        # `already_claimed` exists only to explain a MISSING chest, and "the
        # feature is off" is not the same explanation as "you already have
        # today's". A client that predates this switch renders on `chest`
        # being null either way, so the flag is free to stay honest.
        from tests.test_session_completion import _FakeDb, _complete, _user

        db = _FakeDb(_user(srsLastChestDate=None))
        res = await _complete(db, correct=8, total=10, kind="practice")

        assert res.already_claimed is False

    async def test_the_rest_of_the_completion_is_untouched(self):
        # The chest sat at the end of a handler that also moves the streak and
        # the tile. Switching it off must not take those with it.
        from tests.test_session_completion import (
            REAL_YESTERDAY,
            _FakeDb,
            _complete,
            _dt,
            _user,
        )

        db = _FakeDb(_user(
            srsCurrentStreak=4,
            srsLastSessionDate=_dt(REAL_YESTERDAY),
            practiceLessonsCompleted=12,
        ))
        res = await _complete(db, correct=8, total=10, kind="practice")

        assert res.streak == 5
        assert res.lessons_completed == 13


class TestTurningItBackOn:
    async def test_the_flag_alone_restores_the_chest(self, monkeypatch):
        # The claim this whole file is defending: one edit, and it works. If
        # this ever fails, the feature stopped being paused and started being
        # decayed, and whoever wants it back needs to know that up front.
        from tests.test_session_completion import _FakeDb, _complete, _user

        class _Reward:
            def as_dict(self):
                return {"kind": "xp_small", "label": "XP", "payload": {"xp": 10}}

        async def _award(db, *, user_id, max_held=None):
            return _Reward()

        monkeypatch.setattr("src.routes.srs.award_session_chest", _award)
        monkeypatch.setattr("src.routes.srs.CHEST_ENABLED", True)

        db = _FakeDb(_user(srsLastChestDate=None))
        res = await _complete(db, correct=8, total=10, kind="practice")

        assert res.chest is not None
        stamped = [u for u in db.user.updates if "srsLastChestDate" in u]
        assert len(stamped) == 1
        # A `datetime`, never a bare `date` — prisma-client-py 0.11 has no
        # encoder for the latter and 500s the whole request. That bug is what
        # made the chest invisible for months.
        assert isinstance(stamped[0]["srsLastChestDate"], datetime)
        assert stamped[0]["srsLastChestDate"].date() == datetime.now(timezone.utc).date()
