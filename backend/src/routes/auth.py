from fastapi import APIRouter, Depends, HTTPException, status
from prisma import Prisma
from datetime import timedelta
from ..database import get_db
from ..schemas.user import UserCreate, UserResponse, UserLogin, Token
from ..utils.auth import verify_password, get_password_hash, create_access_token
from ..config import get_settings
from ..middleware.auth import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(user_data: UserCreate, db: Prisma = Depends(get_db)):
    """Register a new user"""
    # Check if email already exists
    existing_user = await db.user.find_unique(where={"email": user_data.email})
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )

    # Check if username already exists
    existing_username = await db.user.find_unique(where={"username": user_data.username})
    if existing_username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already taken"
        )

    # Create new user
    hashed_password = get_password_hash(user_data.password)
    new_user = await db.user.create(
        data={
            "email": user_data.email,
            "username": user_data.username,
            "passwordHash": hashed_password,
            "languagePreference": user_data.language_preference,
            "proficiencyLevel": user_data.proficiency_level,
            "oauthProvider": "email",
            "isActive": True,
            "isAdmin": False
        }
    )

    return new_user


@router.post("/login", response_model=Token)
async def login(credentials: UserLogin, db: Prisma = Depends(get_db)):
    """Login user and return JWT token"""
    user = await db.user.find_unique(where={"email": credentials.email})

    if not user or not user.passwordHash or not verify_password(credentials.password, user.passwordHash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.isActive:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user"
        )

    # Create access token
    access_token_expires = timedelta(hours=settings.jwt_expiration_hours)
    access_token = create_access_token(
        data={"sub": user.id, "email": user.email},
        expires_delta=access_token_expires
    )

    return {"access_token": access_token, "token_type": "bearer"}


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(current_user = Depends(get_current_user)):
    """Get current user information"""
    return current_user


