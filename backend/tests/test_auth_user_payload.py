"""Every auth entry point describes a user the same way.

## The bug

`AuthResponse.user` is typed `UserResponse`, which reads as a guarantee and is
not one. Prisma objects carry camelCase attributes; FastAPI's default
serializer looks for the snake_case names the schema declares, finds nothing,
and emits `null` — a 200 with a hollow body and no error anywhere.

For months `/auth/me` was the only route that called
`UserResponse.model_validate` explicitly. Register, login and refresh returned
the raw model, so signing in produced a user with no `entitlements`, no
`is_admin`, no `proficiency_level` and `onboarding_completed: false`. Observed
on device: an onboarded account was sent back through onboarding, and a paying
subscriber read as free until the app was killed and cold-started (only the
cold start calls `/auth/me`).

Google and Apple had their own variant — a narrower `UserInfo` schema that
hand-listed ten fields, so anything added to the user model after it was
written was simply absent there.

## What this pins

Not the fix, the *property*: the serialised shape does not depend on which door
you came in through. A new auth route that forgets the mapping fails here, and
so does a new field added to `UserResponse` but not carried by one path —
which is the failure mode a hand-written mapping has and a shared one cannot.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]

from src.schemas.oauth import GoogleLoginResponse, GoogleSignupResponse
from src.schemas.user import AuthResponse, UserResponse


def prisma_like_user(**overrides) -> SimpleNamespace:
    """A stand-in shaped like what Prisma hands the routes.

    camelCase attributes and nothing else — which is the whole point. A fixture
    that also carried snake_case aliases would pass against the broken
    serializer and prove nothing.
    """
    base = dict(
        id=7,
        email="someone@example.com",
        username="someone",
        languagePreference="tr",
        timezone="Europe/Istanbul",
        nativeLanguage="tr",
        learningLanguage="tr",
        proficiencyLevel="B2",
        defaultTab="movies",
        isActive=True,
        isAdmin=False,
        createdAt=datetime(2026, 1, 1, tzinfo=timezone.utc),
        profilePictureUrl=None,
        oauthProvider="email",
        onboardingCompletedAt=datetime(2026, 2, 2, tzinfo=timezone.utc),
        feedLevelMix=None,
        subscriptionTier="premium",
        subscriptionExpiresAt=None,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


# The fields whose absence was actually visible in the app. Each is here
# because a real symptom traced back to it, not because it exists.
LOAD_BEARING = (
    "entitlements",          # premium user hit the paywall right after signing in
    "is_admin",              # the Admin row vanished from Profile
    "proficiency_level",     # the level chip read B1 for an A1 account
    "onboarding_completed",  # an onboarded account replayed onboarding
    "language_preference",   # the app switched language on sign-in
)


class TestOneRepresentation:
    def test_model_validate_maps_camelcase(self):
        got = UserResponse.model_validate(prisma_like_user())
        assert got.username == "someone"
        assert got.native_language == "tr"
        assert got.proficiency_level == "B2"
        assert got.language_preference == "tr"

    def test_onboarding_flag_survives(self):
        # The one that sent a real user back through the placement quiz. It is
        # a timestamp on the model and a boolean on the wire, so it can only
        # come out right through the mapping.
        assert UserResponse.model_validate(prisma_like_user()).onboarding_completed is True
        never = prisma_like_user(onboardingCompletedAt=None)
        assert UserResponse.model_validate(never).onboarding_completed is False

    def test_entitlements_are_attached(self):
        # Not a column — derived by `entitlements_payload`. A hand-written
        # mapping has to remember it; this one cannot forget.
        ent = UserResponse.model_validate(prisma_like_user()).entitlements
        assert ent is not None
        assert ent.is_premium is True

    @pytest.mark.parametrize("field", LOAD_BEARING)
    def test_no_load_bearing_field_is_null(self, field):
        got = UserResponse.model_validate(prisma_like_user())
        assert getattr(got, field) is not None, (
            f"{field} serialised as null — this is the shape that shipped, and "
            "the app reads a null entitlement as 'free'."
        )


class TestEveryDoorAgrees:
    """The response schemas must all carry the same user type."""

    @pytest.mark.parametrize(
        "schema",
        [AuthResponse, GoogleLoginResponse, GoogleSignupResponse],
        ids=["password", "google-login", "google-signup"],
    )
    def test_user_field_is_the_shared_schema(self, schema):
        # `UserInfo` used to sit here for the two OAuth ones. A second schema
        # for one entity is how `entitlements` went missing on exactly the
        # paths that do not run on a cold start.
        assert schema.model_fields["user"].annotation is UserResponse

    def test_password_and_oauth_produce_identical_payloads(self):
        from src.routes.oauth import _create_user_response

        user = prisma_like_user(oauthProvider="google")
        assert _create_user_response(user).model_dump() == (
            UserResponse.model_validate(user).model_dump()
        )


class TestTheRoutesActuallyCallIt:
    """The half a schema assertion cannot reach.

    `AuthResponse.user` was *already* typed `UserResponse` while the bug was
    live — the routes handed it the raw Prisma object and the declared type
    changed nothing. So the only honest guard is on the call itself: reading
    source is crude, but the alternative is a real Postgres and a real bcrypt
    round-trip to assert one dictionary key, and this runs on every push.
    """

    @staticmethod
    def _returns_in(path: str) -> list[str]:
        import re

        src = (PROJECT_ROOT / path).read_text()
        # Every `"user": <expr>,` in a return dict.
        return re.findall(r'"user"\s*:\s*([^,\n]+)', src)

    def test_every_auth_route_maps_before_returning(self):
        exprs = self._returns_in("src/routes/auth.py")
        assert exprs, "no user returns found — did the routes move?"
        bare = [e for e in exprs if "UserResponse.model_validate" not in e]
        assert not bare, (
            f"{bare} returns a raw Prisma object. FastAPI will serialise every "
            "snake_case field as null, with a 200 and no error. Wrap it in "
            "UserResponse.model_validate — see the module docstring in auth.py."
        )

    def test_oauth_routes_map_before_returning(self):
        exprs = self._returns_in("src/routes/oauth.py")
        bare = [
            e
            for e in exprs
            if "UserResponse.model_validate" not in e and "_create_user_response" not in e
        ]
        assert not bare, f"{bare} bypasses the shared mapping"
