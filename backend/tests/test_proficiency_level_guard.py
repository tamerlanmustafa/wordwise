"""
A user's proficiency level cannot be set to UNKNOWN.

`proficiencylevel` is shared between two very different things: what CEFR band
a *word* is, and what level a *learner* is. Issue #91 added `UNKNOWN` to it as
the holding bucket for words the classifier could not place — 87% of the old
A2 registry turned out to be proper names and rare junk, and UNKNOWN is where
that now goes. The schema comment is explicit that it is "never written to
users.proficiency_level".

Nothing enforced that. `UserCreate` and `UserUpdate` typed the field as the
raw enum, so `POST /auth/register` and `PATCH /auth/me` both accepted
`"UNKNOWN"` and would have stored it on the account.

The reason this is worth a guard rather than a shrug is that it fails quietly.
`_band_levels_around` falls back to B1 for a level it does not recognise, so
nothing raises: the user's Practice deck and Explore mix would compose for B1
forever while Settings showed them a "level" that is not a level, and no error
would ever be logged. Rejecting at the edge turns a silent mis-composition
into a 422 the client can show.

Enum members are validated in one shared place so the two entry points cannot
drift — signup is the one that historically diverged, since it deliberately
*drops* a bad `language_preference` rather than failing account creation.
"""
from __future__ import annotations

import pytest
from prisma.enums import proficiencylevel
from pydantic import ValidationError

from src.schemas.user import LEARNER_LEVELS, UserCreate, UserUpdate

VALID = ["A1", "A2", "B1", "B2", "C1", "C2"]


def _signup(**overrides):
    base = dict(email="learner@example.com", username="learner", password="hunter2!!")
    base.update(overrides)
    return UserCreate(**base)


class TestLearnerLevels:
    def test_covers_every_cefr_band(self):
        assert {lvl.value for lvl in LEARNER_LEVELS} == set(VALID)

    def test_excludes_the_word_registry_bucket(self):
        assert proficiencylevel.UNKNOWN not in LEARNER_LEVELS

    def test_is_a_strict_subset_of_the_shared_enum(self):
        """If the enum grows another non-learner member, this test is the
        thing that notices the allowlist was not updated with it."""
        assert LEARNER_LEVELS < set(proficiencylevel)


class TestProfileUpdate:
    @pytest.mark.parametrize("level", VALID)
    def test_accepts_every_real_level(self, level):
        assert UserUpdate(proficiency_level=level).proficiency_level.value == level

    def test_rejects_unknown(self):
        with pytest.raises(ValidationError, match="not a proficiency level"):
            UserUpdate(proficiency_level="UNKNOWN")

    def test_omitting_the_field_still_means_do_not_touch_it(self):
        """`None` is how a PATCH says "this request doesn't set this field",
        and the guard must not turn that into a rejection."""
        assert UserUpdate().proficiency_level is None
        assert UserUpdate(username="renamed").proficiency_level is None

    def test_a_value_outside_the_enum_is_still_rejected(self):
        with pytest.raises(ValidationError):
            UserUpdate(proficiency_level="Z9")


class TestSignup:
    @pytest.mark.parametrize("level", VALID)
    def test_accepts_every_real_level(self, level):
        assert _signup(proficiency_level=level).proficiency_level.value == level

    def test_rejects_unknown(self):
        """Signup deliberately *drops* an unshippable `language_preference`
        rather than failing account creation. That leniency does not extend
        here: a dropped language costs a wrong label, a stored UNKNOWN costs
        every deck the account will ever be served."""
        with pytest.raises(ValidationError, match="not a proficiency level"):
            _signup(proficiency_level="UNKNOWN")

    def test_still_defaults_to_a1(self):
        assert _signup().proficiency_level == proficiencylevel.A1
