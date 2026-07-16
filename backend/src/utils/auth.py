from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from ..config import get_settings

settings = get_settings()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash"""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Hash a password"""
    return pwd_context.hash(password)


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


