"""
Password hashing off the event loop, and in constant time (issue #141).

bcrypt is ~173ms of pure CPU per call at cost factor 12 — that slowness is its
security property, not a bug. What *was* a bug: it ran inline in `async def`
handlers, so on a single-process API every login froze every other request in
flight for that window, and login is the one endpoint reachable with no
credentials at all.

The second defect lived on the same line: `not user or not user.passwordHash or
not verify_password(...)` short-circuits, so an unknown email answered in ~0ms
while a real account cost 173ms — a measurable "does this account exist" oracle.

Asserted here:
1. The three hashing routes run bcrypt on a worker thread, and the loop keeps
   serving while they do.
2. A login for an account that doesn't exist still spends a full verify.
3. With real bcrypt, the unknown-email path costs what the real one costs.
4. A full CPU pool sheds with 503 instead of queueing — identically for both
   branches, so shedding doesn't become an oracle of its own.
5. A static guard against reintroducing an inline hash in a handler.

Same strategy as test_password_reset.py: route functions called directly with
fake Prisma surfaces; no DB, no network.
"""
from __future__ import annotations

import ast
import asyncio
import threading
import time
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks, HTTPException

from src.routes.auth import login, register, reset_password_submit
from src.schemas.user import UserCreate, UserLogin
from src.utils import auth as auth_utils
from src.utils.auth import (
    check_password,
    create_password_reset_token,
    get_password_hash,
)
from src.utils.offload import DEFAULT_CPU_MAX_PENDING, cpu_slot

BCRYPT_HASH = "$2b$12$fakedhashfakedhashfakedhashfakedhashfakedhashfakedha"


# ── Fakes ───────────────────────────────────────────────────────────────────

class _RecordingContext:
    """Stands in for the passlib CryptContext.

    Records the thread each call landed on (the whole point of the fix) and
    how many times it ran (the enumeration fix), without paying 173ms a call.
    `delay` stands in for bcrypt's cost when a test needs the work to be slow.
    """

    def __init__(self, *, delay: float = 0.0, result: bool = True):
        self.delay = delay
        self.result = result
        self.verify_calls: list[tuple[str, str]] = []
        self.hash_calls: list[str] = []
        self.threads: set[int] = set()

    def verify(self, plain: str, hashed: str) -> bool:
        self.threads.add(threading.current_thread().ident)
        self.verify_calls.append((plain, hashed))
        time.sleep(self.delay)
        return self.result

    def hash(self, raw: str) -> str:
        self.threads.add(threading.current_thread().ident)
        self.hash_calls.append(raw)
        time.sleep(self.delay)
        return f"hashed:{raw}"


class _FakeUserTable:
    def __init__(self, user):
        self._user = user
        self.created: list[dict] = []
        self.updates: list[dict] = []

    async def find_unique(self, where):
        u = self._user
        if u is None:
            return None
        if where.get("id") == u.id or where.get("email") == u.email:
            return u
        return None

    async def create(self, data):
        self.created.append(data)
        return SimpleNamespace(id=42, **data)

    async def update(self, where, data):
        self.updates.append({"where": where, "data": data})
        for k, v in data.items():
            setattr(self._user, k, v)
        return self._user


class _FakeDb:
    def __init__(self, user=None):
        self.user = _FakeUserTable(user)


def _user(**overrides) -> SimpleNamespace:
    base = dict(
        id=7,
        email="movielover@example.com",
        username="movielover",
        passwordHash=BCRYPT_HASH,
        isActive=True,
        isAdmin=False,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def _signup(**overrides) -> UserCreate:
    base = dict(
        email="newcomer@example.com",
        username="newcomer",
        password="strong-enough-9",
    )
    base.update(overrides)
    return UserCreate(**base)


@pytest.fixture(autouse=True)
def fresh_decoy_hash():
    """The decoy hash is a process-wide cache. A test that swaps in a fake
    CryptContext would otherwise leave a non-bcrypt decoy behind for the tests
    that use the real one."""
    auth_utils._decoy_hash = None
    yield
    auth_utils._decoy_hash = None


@pytest.fixture
def fake_bcrypt(monkeypatch):
    def _install(**kwargs) -> _RecordingContext:
        ctx = _RecordingContext(**kwargs)
        monkeypatch.setattr(auth_utils, "pwd_context", ctx)
        return ctx

    return _install


# ── 1. The hashing runs off the event loop ──────────────────────────────────

async def test_login_hashes_on_a_worker_thread(fake_bcrypt):
    ctx = fake_bcrypt()

    await login(credentials=UserLogin(email="movielover@example.com", password="pw"),
                db=_FakeDb(_user()), _=None)

    assert ctx.threads and threading.current_thread().ident not in ctx.threads


async def test_register_hashes_on_a_worker_thread(fake_bcrypt):
    ctx = fake_bcrypt()

    await register(user_data=_signup(), background_tasks=BackgroundTasks(),
                   db=_FakeDb(), _=None)

    assert ctx.hash_calls == ["strong-enough-9"]
    assert threading.current_thread().ident not in ctx.threads


async def test_password_reset_hashes_on_a_worker_thread(fake_bcrypt):
    user = _user()
    db = _FakeDb(user)
    token = create_password_reset_token(user.id, user.email, user.passwordHash)
    ctx = fake_bcrypt()

    res = await reset_password_submit(
        token=token, new_password="brand-new-pass-9", db=db, _=None
    )

    assert res.status_code == 200
    assert db.user.updates[0]["data"]["passwordHash"] == "hashed:brand-new-pass-9"
    assert threading.current_thread().ident not in ctx.threads


async def test_event_loop_keeps_serving_during_a_login(fake_bcrypt):
    """The #117 regression guard, applied to auth: an unrelated request has to
    make progress while a login's bcrypt is in flight."""
    fake_bcrypt(delay=0.2)
    ticks = 0

    async def unrelated_request():
        nonlocal ticks
        while True:
            ticks += 1
            await asyncio.sleep(0.005)

    ticker = asyncio.create_task(unrelated_request())
    try:
        await login(credentials=UserLogin(email="movielover@example.com", password="pw"),
                    db=_FakeDb(_user()), _=None)
    finally:
        ticker.cancel()

    assert ticks > 1


# ── 2-3. No enumeration oracle ──────────────────────────────────────────────

@pytest.mark.parametrize(
    "user",
    [
        None,                       # no such account
        _user(passwordHash=None),   # OAuth-only account: nothing to verify against
    ],
    ids=["unknown-email", "oauth-only-account"],
)
async def test_login_without_a_stored_hash_still_verifies(fake_bcrypt, user):
    ctx = fake_bcrypt(result=False)

    with pytest.raises(HTTPException) as exc:
        await login(credentials=UserLogin(email="movielover@example.com", password="pw"),
                    db=_FakeDb(user), _=None)

    assert exc.value.status_code == 401
    assert len(ctx.verify_calls) == 1, "short-circuited — login latency leaks account existence"
    # Verified against the decoy, which the live context produced — not a
    # sentinel that would cost less than the hash it stands in for.
    assert auth_utils._decoy_hash
    assert ctx.verify_calls[0][1] == auth_utils._decoy_hash


async def test_a_real_account_and_an_unknown_one_do_the_same_amount_of_work(fake_bcrypt):
    ctx = fake_bcrypt(result=False)
    creds = UserLogin(email="movielover@example.com", password="wrong-guess")

    for db in (_FakeDb(_user()), _FakeDb(None)):
        with pytest.raises(HTTPException):
            await login(credentials=creds, db=db, _=None)

    assert len(ctx.verify_calls) == 2


def test_unknown_email_costs_real_bcrypt_time():
    """The structural assertions above use a fake context; this one pays for a
    real bcrypt to prove the decoy is not a cheap stand-in."""
    real_hash = get_password_hash("correct-horse-battery")
    check_password("warm-up", None)  # generate the decoy outside the measurement

    started = time.perf_counter()
    assert check_password("wrong-guess", real_hash) is False
    known = time.perf_counter() - started

    started = time.perf_counter()
    assert check_password("wrong-guess", None) is False
    unknown = time.perf_counter() - started

    assert unknown > known * 0.5, (
        f"unknown-email login took {unknown * 1000:.0f}ms against "
        f"{known * 1000:.0f}ms for a real account — that gap is an oracle"
    )


# ── 4. A full pool sheds rather than queues ─────────────────────────────────

@pytest.fixture
def saturated_cpu_pool():
    with ExitStack() as stack:
        for _ in range(DEFAULT_CPU_MAX_PENDING):
            stack.enter_context(cpu_slot())
        yield


@pytest.mark.parametrize("user", [_user(), None], ids=["real-account", "unknown-email"])
async def test_login_sheds_with_503_when_the_pool_is_full(saturated_cpu_pool, user):
    """503 either way: an overload response that differed by account would put
    the enumeration oracle back, one step to the left."""
    with pytest.raises(HTTPException) as exc:
        await login(credentials=UserLogin(email="movielover@example.com", password="pw"),
                    db=_FakeDb(user), _=None)

    assert exc.value.status_code == 503
    assert exc.value.headers["Retry-After"] == "1"


async def test_register_sheds_with_503_when_the_pool_is_full(saturated_cpu_pool):
    db = _FakeDb()

    with pytest.raises(HTTPException) as exc:
        await register(user_data=_signup(), background_tasks=BackgroundTasks(),
                       db=db, _=None)

    assert exc.value.status_code == 503
    assert db.user.created == [], "shed registration must not create a user"


async def test_password_reset_sheds_with_503_when_the_pool_is_full(saturated_cpu_pool):
    user = _user()
    db = _FakeDb(user)
    token = create_password_reset_token(user.id, user.email, user.passwordHash)

    res = await reset_password_submit(
        token=token, new_password="brand-new-pass-9", db=db, _=None
    )

    # HTML, not JSON: this endpoint is a form opened from a mail client.
    assert res.status_code == 503
    assert db.user.updates == [], "shed reset must not half-apply"
    assert b"still valid" in res.body


# ── 5. Static guard: no inline hashing in a handler ─────────────────────────
#
# The blocking versions still exist and are still correct — `check_password`
# and `get_password_hash` are what the worker thread runs. The mistake this
# catches is calling one of them *from* request-handling code, which reads
# perfectly well in isolation and is invisible to ruff's ASYNC rules.

BLOCKING_HASH_CALLS = {"verify_password", "get_password_hash", "check_password"}
ROUTES_DIR = Path(__file__).resolve().parents[1] / "src" / "routes"


@pytest.mark.parametrize(
    "src_file",
    sorted(p for p in ROUTES_DIR.rglob("*.py") if "__pycache__" not in p.parts),
    ids=lambda p: p.name,
)
def test_no_route_hashes_a_password_inline(src_file):
    offenders = [
        (name, node.lineno)
        for node in ast.walk(ast.parse(src_file.read_text()))
        if isinstance(node, ast.Call)
        and (name := getattr(node.func, "id", None) or getattr(node.func, "attr", None))
        in BLOCKING_HASH_CALLS
    ]

    assert not offenders, (
        f"{src_file.name} calls {offenders} directly. bcrypt is ~173ms of CPU; "
        "in an async handler that stalls every concurrent request (#141). Use "
        "check_password_async / get_password_hash_async."
    )
