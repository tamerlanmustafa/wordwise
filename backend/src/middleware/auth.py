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
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    payload = verify_token(token)
    if payload is None:
        raise credentials_exception

    user_id: Optional[int] = payload.get("sub")
    if user_id is None:
        raise credentials_exception

    user = await db.user.find_unique(where={"id": user_id})
    if user is None:
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


