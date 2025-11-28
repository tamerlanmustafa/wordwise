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
    """Create a JWT access token"""
    import logging
    logger = logging.getLogger(__name__)

    to_encode = data.copy()

    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(hours=settings.jwt_expiration_hours)

    to_encode.update({"exp": expire})
    logger.info(f"[JWT] Creating token with secret key: {settings.jwt_secret_key[:20]}... (len={len(settings.jwt_secret_key)})")
    logger.info(f"[JWT] Payload: {to_encode}")
    encoded_jwt = jwt.encode(to_encode, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
    logger.info(f"[JWT] Created token: {encoded_jwt[:50]}...")

    return encoded_jwt


def verify_token(token: str) -> Optional[dict]:
    """Verify and decode a JWT token"""
    import logging
    logger = logging.getLogger(__name__)

    try:
        logger.info(f"[JWT] Verifying with secret key: {settings.jwt_secret_key[:20]}... (len={len(settings.jwt_secret_key)})")
        logger.info(f"[JWT] Algorithm: {settings.jwt_algorithm}")
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        logger.info(f"[JWT] Successfully decoded payload: {payload}")
        return payload
    except JWTError as e:
        logger.error(f"[JWT] Verification failed: {type(e).__name__}: {str(e)}")
        return None


