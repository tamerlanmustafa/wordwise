import secrets
import threading
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from ..config import get_settings
from .offload import cpu_slot, run_cpu

settings = get_settings()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash.

    Blocking: ~173ms of pure CPU at cost factor 12, which is bcrypt working as
    intended. Never call this from an `async def` handler — use
    `check_password_async`, which also handles the missing-account case.
    """
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Hash a password.

    Blocking, same ~173ms as `verify_password`. From a request handler, use
    `get_password_hash_async`.
    """
    return pwd_context.hash(password)


# A real hash of a value nobody can present, so a login for an account that
# doesn't exist can still spend a full bcrypt verify. Built once from the live
# CryptContext rather than hardcoded: a literal would drift the moment the cost
# factor changed, and a decoy that is cheaper than a real hash reopens exactly
# the timing gap it exists to close. Computed on first use — inside the worker
# thread, since every caller reaches it through `check_password`.
_decoy_hash: Optional[str] = None
_decoy_lock = threading.Lock()


def _get_decoy_hash() -> str:
    global _decoy_hash
    with _decoy_lock:
        if _decoy_hash is None:
            _decoy_hash = pwd_context.hash(secrets.token_urlsafe(32))
        return _decoy_hash


def check_password(plain_password: str, hashed_password: Optional[str]) -> bool:
    """Answer "is this the password for this account?" in constant work.

    A missing user, or an OAuth-only account with no `passwordHash`, still pays
    a full verify against the decoy hash. Short-circuiting on the absent hash
    instead — the obvious way to write this — turns login latency into an
    account-existence oracle: ~0ms for an unknown email against ~173ms for a
    real one is trivially measurable from outside, and no rate limit hides it.

    Blocking; `check_password_async` is the handler-facing version.
    """
    if not hashed_password:
        pwd_context.verify(plain_password, _get_decoy_hash())
        return False
    return pwd_context.verify(plain_password, hashed_password)


async def check_password_async(plain_password: str, hashed_password: Optional[str]) -> bool:
    """`check_password` on the CPU worker pool.

    The API is one uvicorn process with one replica, so 173ms of inline bcrypt
    is 173ms in which *every* concurrent request is stalled, not just this
    login. `cpu_slot` bounds the queue on the way in: past the cap this raises
    `CPUOverloaded` rather than admitting work whose caller will have given up
    before it runs. Login is unauthenticated and per-IP throttling doesn't bind
    behind Railway's proxy (see `rate_limit._client_ip`), so the bound on the
    scarce resource is the part that actually holds.
    """
    with cpu_slot():
        return await run_cpu(check_password, plain_password, hashed_password)


async def get_password_hash_async(password: str) -> str:
    """`get_password_hash` on the CPU worker pool. Same reasoning as
    `check_password_async`: registration and password reset must not stall
    everyone else's requests for the duration of a hash."""
    with cpu_slot():
        return await run_cpu(get_password_hash, password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a short-lived JWT access token."""
    to_encode = data.copy()

    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(hours=settings.jwt_expiration_hours)

    # `type` lets the refresh endpoint reject an access token presented in
    # place of a refresh token. Access tokens minted before this claim
    # existed simply lack it, which is fine — only the refresh endpoint
    # cares, and it treats a missing type as "not a refresh token".
    to_encode.update({"exp": expire, "type": "access"})
    encoded_jwt = jwt.encode(to_encode, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)

    return encoded_jwt


def create_refresh_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a long-lived JWT refresh token. Used solely to obtain a fresh
    access token via POST /auth/refresh — never accepted as a bearer token
    on protected routes (`get_current_user` rejects any explicit type other
    than "access")."""
    to_encode = data.copy()

    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(days=settings.jwt_refresh_expiration_days)

    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def password_hash_fingerprint(password_hash: str) -> str:
    """Short stable digest of a bcrypt hash, embedded in reset tokens as the
    `pwh` claim. Changing the password changes the fingerprint, which
    invalidates every previously-issued reset link — single-use semantics
    without any server-side token store."""
    import hashlib

    return hashlib.sha256(password_hash.encode()).hexdigest()[:16]


def create_password_reset_token(user_id: int, email: str, password_hash: str,
                                expires_delta: Optional[timedelta] = None) -> str:
    """Create the single-purpose token embedded in the reset-password link.

    `type: "password_reset"` keeps it useless as an access or refresh token
    (get_current_user rejects any explicit type other than "access", and the
    refresh endpoint requires "refresh"), and the reset endpoint only accepts
    this type — so a leaked reset link can never authenticate anyone."""
    to_encode = {
        "sub": str(user_id),
        "email": email,
        "pwh": password_hash_fingerprint(password_hash),
        "exp": datetime.utcnow() + (expires_delta or timedelta(minutes=30)),
        "type": "password_reset",
    }
    return jwt.encode(to_encode, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def verify_token(token: str) -> Optional[dict]:
    """Verify and decode a JWT token"""
    import logging
    logger = logging.getLogger(__name__)

    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        return payload
    except JWTError as e:
        logger.error(f"[JWT] Verification failed: {type(e).__name__}: {str(e)}")
        return None


