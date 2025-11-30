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

    payload = verify_token(token)
    if payload is None:
        logger.error("[AUTH] Token verification failed")
        raise credentials_exception

    user_id_str = payload.get("sub")
    if user_id_str is None:
        logger.error("[AUTH] No user_id in token payload")
        raise credentials_exception

    try:
        user_id: int = int(user_id_str)
    except (ValueError, TypeError):
        logger.error(f"[AUTH] Invalid user_id format: {user_id_str}")
        raise credentials_exception

    user = await db.user.find_unique(where={"id": user_id})
    if user is None:
        logger.error(f"[AUTH] User not found with id: {user_id}")
        raise credentials_exception

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


