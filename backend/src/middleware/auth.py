from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from prisma import Prisma
from typing import Optional
from ..database import get_db
from ..utils.auth import verify_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Prisma = Depends(get_db)
):
    """Get current authenticated user from JWT token"""
    import logging
    logger = logging.getLogger(__name__)

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    logger.info(f"[AUTH] Verifying token: {token[:20]}...")
    payload = verify_token(token)
    if payload is None:
        logger.error("[AUTH] Token verification failed")
        raise credentials_exception

    logger.info(f"[AUTH] Token payload: {payload}")
    user_id: Optional[int] = payload.get("sub")
    if user_id is None:
        logger.error("[AUTH] No user_id in token payload")
        raise credentials_exception

    logger.info(f"[AUTH] Looking up user_id: {user_id}")
    user = await db.user.find_unique(where={"id": user_id})
    if user is None:
        logger.error(f"[AUTH] User not found with id: {user_id}")
        raise credentials_exception

    logger.info(f"[AUTH] User found: {user.email}, active: {user.isActive}")
    return user


async def get_current_active_user(
    current_user = Depends(get_current_user)
):
    """Get current active user"""
    if not current_user.isActive:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user"
        )
    return current_user


