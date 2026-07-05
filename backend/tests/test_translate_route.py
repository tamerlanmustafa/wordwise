"""
Regression tests for the /translate route registration.

The translate endpoint must be registered at exactly `/translate` (no
trailing slash) and must carry the active-user auth guard. History: it was
registered as `@router.post("/")`, making the canonical path `/translate/`.
Clients call `/translate`, so Starlette issued a 307 redirect to add the
slash — and React Native's fetch drops the Authorization header when it
follows that redirect, so the retried request 401'd. Locking the path here
keeps the redirect from silently coming back.

These walk the router's registered routes directly — no DB, no network.
"""
from src.middleware.auth import get_current_active_user
from src.routes.translation import router


def _route(path: str, method: str):
    for route in router.routes:
        if getattr(route, "path", None) == path and method in getattr(route, "methods", set()):
            return route
    return None


def test_translate_registered_without_trailing_slash():
    # The canonical path both clients hit — must exist exactly, so no 307.
    assert _route("/translate", "POST") is not None


def test_translate_not_registered_with_trailing_slash():
    # The slashed form must NOT be the registered path (that's what caused
    # the auth-dropping redirect).
    assert _route("/translate/", "POST") is None


def test_translate_requires_active_user():
    route = _route("/translate", "POST")
    assert route is not None

    calls = set()

    def walk(dependant):
        for sub in dependant.dependencies:
            if sub.call is not None:
                calls.add(sub.call)
            walk(sub)

    walk(route.dependant)
    assert get_current_active_user in calls
