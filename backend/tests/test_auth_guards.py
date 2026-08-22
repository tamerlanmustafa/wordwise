"""
Unit tests for the auth dependency chain: get_current_active_user,
get_admin_user, get_current_user — plus route-level guard assertions.

We call the functions directly with fake user objects (from fixtures),
bypassing FastAPI's Depends resolution. No DB, no network, no Prisma
engine (route modules import the prisma package but never connect).

These cover the auth-leak surface — the single highest-impact failure
in a backend like this (anyone-is-admin by accident). The RouteGuards
class exists because exactly that happened: /api/scripts/fetch shipped
with no auth at all and /admin/reprocess-* shipped admin actions behind
a plain user check.
"""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from .conftest import fake_request
from src.middleware.auth import (
    get_admin_user,
    get_current_active_user,
    get_current_user,
)
from src.utils.auth import create_access_token, create_refresh_token


async def test_admin_user_accepts_admin(admin_user):
    result = await get_admin_user(current_user=admin_user)
    assert result is admin_user


async def test_admin_user_rejects_non_admin(test_user):
    with pytest.raises(HTTPException) as exc:
        await get_admin_user(current_user=test_user)
    assert exc.value.status_code == 403
    assert "admin" in exc.value.detail.lower()


async def test_active_user_rejects_inactive(inactive_user):
    with pytest.raises(HTTPException) as exc:
        await get_current_active_user(current_user=inactive_user)
    assert exc.value.status_code == 400


async def test_active_user_accepts_active(test_user):
    result = await get_current_active_user(current_user=test_user)
    assert result is test_user


async def test_admin_chain_rejects_inactive_admin(admin_user):
    """Even an admin must be active — inactive admin should be blocked by the
    active-user check before reaching the admin check."""
    admin_user.isActive = False
    with pytest.raises(HTTPException) as exc:
        await get_current_active_user(current_user=admin_user)
    assert exc.value.status_code == 400


# ── get_current_user: token-type discipline ─────────────────────────────────
#
# A refresh token is a 60-day credential meant ONLY for POST /auth/refresh.
# get_current_user must reject it as a bearer token, otherwise a leaked
# refresh token grants two months of full API access.

class _FakeDb:
    """Just enough Prisma surface for get_current_user: db.user.find_unique."""

    def __init__(self, user):
        async def find_unique(where):
            return user if user and where.get("id") == user.id else None

        self.user = SimpleNamespace(find_unique=find_unique)


async def test_access_token_accepted(test_user):
    token = create_access_token({"sub": str(test_user.id), "email": test_user.email})
    result = await get_current_user(fake_request(), token=token, db=_FakeDb(test_user))
    assert result is test_user


async def test_refresh_token_rejected_as_bearer(test_user):
    token = create_refresh_token({"sub": str(test_user.id), "email": test_user.email})
    with pytest.raises(HTTPException) as exc:
        await get_current_user(fake_request(), token=token, db=_FakeDb(test_user))
    assert exc.value.status_code == 401


async def test_legacy_untyped_token_still_accepted(test_user):
    """Access tokens minted before the `type` claim existed carry no type.
    Those must keep working — only an explicit type of 'refresh' is banned."""
    from jose import jwt

    from src.config import get_settings

    settings = get_settings()
    legacy = jwt.encode(
        {"sub": str(test_user.id), "email": test_user.email},
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )
    result = await get_current_user(fake_request(), token=legacy, db=_FakeDb(test_user))
    assert result is test_user


async def test_garbage_token_rejected(test_user):
    with pytest.raises(HTTPException) as exc:
        await get_current_user(fake_request(), token="not-a-jwt", db=_FakeDb(test_user))
    assert exc.value.status_code == 401


# ── Route-level guard assertions ────────────────────────────────────────────
#
# Walk each router's dependency tree and assert the cost/destructive
# endpoints actually declare the guard they're supposed to have. This is
# the regression net for the class of bug where an endpoint ships without
# its auth dependency — dependency-function unit tests above can't see that.

def _dependency_calls(router, path: str, method: str) -> set:
    """Collect every dependency callable (recursively) for one route."""
    for route in router.routes:
        if getattr(route, "path", None) == path and method in getattr(route, "methods", set()):
            calls = set()

            def walk(dependant):
                for sub in dependant.dependencies:
                    if sub.call is not None:
                        calls.add(sub.call)
                    walk(sub)

            walk(route.dependant)
            return calls
    raise AssertionError(f"route {method} {path} not found on router")


def _has_rate_limit(calls: set) -> bool:
    return any(
        getattr(c, "__qualname__", "").startswith("rate_limit.") for c in calls
    )


class TestRouteGuards:
    def test_scripts_fetch_requires_auth_and_throttle(self):
        from src.routes.scripts import router

        calls = _dependency_calls(router, "/api/scripts/fetch", "POST")
        assert get_current_active_user in calls
        assert _has_rate_limit(calls)

    def test_scripts_search_requires_auth_and_throttle(self):
        from src.routes.scripts import router

        calls = _dependency_calls(router, "/api/scripts/search", "GET")
        assert get_current_active_user in calls
        assert _has_rate_limit(calls)

    def test_scripts_delete_requires_admin(self):
        from src.routes.scripts import router

        calls = _dependency_calls(router, "/api/scripts/{script_id}", "DELETE")
        assert get_admin_user in calls

    def test_admin_reprocess_script_requires_admin(self):
        from src.routes.admin import router

        calls = _dependency_calls(router, "/admin/reprocess-script/{script_id}", "POST")
        assert get_admin_user in calls

    def test_admin_reprocess_all_requires_admin(self):
        from src.routes.admin import router

        calls = _dependency_calls(router, "/admin/reprocess-all-scripts", "POST")
        assert get_admin_user in calls

    def test_create_movie_requires_admin(self):
        """#102: POST /movies shipped with a docstring saying "admin only" over
        a TODO and a plain active-user check, so any signed-in account could
        insert a movie row."""
        from src.routes.movies import router

        calls = _dependency_calls(router, "/movies/", "POST")
        assert get_admin_user in calls

    def test_tmdb_autocomplete_throttled(self):
        from src.routes.tmdb import router

        calls = _dependency_calls(router, "/api/tmdb/autocomplete", "GET")
        assert _has_rate_limit(calls)

    def test_books_search_throttled(self):
        from src.routes.books import router

        calls = _dependency_calls(router, "/api/books/search", "GET")
        assert _has_rate_limit(calls)

    def test_books_epub_throttled(self):
        from src.routes.books import router

        calls = _dependency_calls(
            router, "/api/books/gutenberg/{gutenberg_id}/epub", "GET"
        )
        assert _has_rate_limit(calls)

    def test_account_deletion_requires_auth_and_throttle(self):
        """DELETE /auth/me must never ship unauthenticated (App Store
        5.1.1(v) requires the feature; auth requires it be self-only)."""
        from src.routes.auth import router

        calls = _dependency_calls(router, "/auth/me", "DELETE")
        assert get_current_user in calls
        assert _has_rate_limit(calls)

    def test_apple_login_throttled(self):
        """Sign in with Apple must carry the same brute-force ceiling as the
        Google and password login paths."""
        from src.routes.oauth import apple_router

        calls = _dependency_calls(apple_router, "/auth/apple/login", "POST")
        assert _has_rate_limit(calls)
