"""A username is validated where it is written, not where it is typed.

The rules existed in `apps/mobile/src/utils/username.ts` (2–30, no spaces) and
onboarding enforced them. Settings trimmed and nothing else. This schema had no
validator at all, so `PATCH /auth/me` accepted — measured against the running
API, not reasoned about:

    "   "                       → stored, renders as a blank name everywhere
    "A" * 300                   → stored
    "a\\nb\\n<script>x</script>" → stored

Usernames are shown to other people (the leaderboard, the `@name` on family
plan member rows), so the client cannot be the place the rule lives: any client
can decline to run it, and the one that mattered here simply never had it.

Character set is deliberately **not** restricted. Names are not ASCII, and an
alphanumeric-only rule would reject most of the world's while doing nothing
about the two things that actually broke rendering: length and whitespace.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from src.schemas.user import USERNAME_MAX, USERNAME_MIN, UserCreate, UserUpdate


def make_update(username):
    return UserUpdate(username=username)


def make_create(username):
    return UserCreate(email="a@b.com", username=username, password="longenough1")


BOTH = pytest.mark.parametrize("build", [make_update, make_create], ids=["patch", "register"])


class TestRejected:
    """Every case here was accepted by the running API before this validator."""

    @BOTH
    def test_whitespace_only(self, build):
        # The worst of the three: truthy, so the UI renders it rather than
        # falling back to a placeholder — the account appears to have no name.
        with pytest.raises(ValidationError):
            build("   ")

    @BOTH
    def test_too_long(self, build):
        with pytest.raises(ValidationError):
            build("A" * 300)

    @BOTH
    def test_embedded_newlines(self, build):
        with pytest.raises(ValidationError):
            build("a\nb\n<script>x</script>")

    @BOTH
    def test_single_character(self, build):
        with pytest.raises(ValidationError):
            build("a")

    @BOTH
    def test_interior_space(self, build):
        # A tab counts too — `isspace`, not a literal " " check.
        with pytest.raises(ValidationError):
            build("john smith")
        with pytest.raises(ValidationError):
            build("john\tsmith")


class TestAccepted:
    @BOTH
    @pytest.mark.parametrize("name", ["movielover", "jane_doe42", "a.b-c", "Ünal", "小明"])
    def test_ordinary_names(self, build, name):
        # Non-ASCII included on purpose: this validator must not become a
        # quiet English-only rule.
        assert build(name).username == name

    @BOTH
    def test_surrounding_whitespace_is_trimmed_not_rejected(self, build):
        # Trimmed rather than refused, so " bob " and "bob" cannot both exist
        # and read as the same person in a members list.
        assert build("  bob  ").username == "bob"

    @BOTH
    def test_boundaries_are_inclusive(self, build):
        assert build("x" * USERNAME_MIN).username == "x" * USERNAME_MIN
        assert build("x" * USERNAME_MAX).username == "x" * USERNAME_MAX

    def test_absent_username_is_still_a_valid_patch(self):
        # `None` means "this PATCH doesn't touch the field" and must stay
        # distinct from a bad value — most PATCHes send no username at all.
        assert UserUpdate(proficiency_level=None).username is None


class TestServerGeneratedNamesObeyTheSameRule:
    """OAuth mints usernames itself, bypassing the schema entirely."""

    def test_long_email_local_part_is_fitted(self):
        from src.routes.oauth import _fit_username

        got = _fit_username("a.very.long.email.local.part.indeed".replace(".", "_"))
        assert len(got) <= USERNAME_MAX
        # Room left for the uniqueness counter the caller appends.
        assert len(got) <= USERNAME_MAX - 4

    def test_fitted_names_pass_the_account_validator(self):
        from src.routes.oauth import _fit_username

        # The point of the clamp: before it, Google could mint a 40-character
        # username its owner could never re-save from Settings, because the
        # PATCH would 422 on a name the server itself had chosen.
        for raw in ["x" * 60, "a", "", "____", "ok_name"]:
            fitted = _fit_username(raw)
            assert UserUpdate(username=fitted).username == fitted
