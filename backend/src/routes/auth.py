import logging
from fastapi import APIRouter, Depends, Header, HTTPException, status
from prisma import Prisma
from datetime import timedelta
from ..database import get_db
from ..schemas.user import (
    UserCreate, UserResponse, UserLogin, AuthResponse, UserUpdate,
    RefreshRequest, RefreshResponse, SUPPORTED_LANGUAGES,
)
from ..utils.auth import (
    verify_password, get_password_hash, create_access_token,
    create_refresh_token, verify_token,
)
from ..config import get_settings
from ..middleware.auth import get_current_user
from ..utils.rate_limit import rate_limit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()

# Throttle the unauthenticated credential endpoints to blunt brute-force /
# credential-stuffing / account-enumeration attempts. Keyed per-IP.
_login_throttle = rate_limit(10, 60.0, scope="auth-login")
_register_throttle = rate_limit(5, 60.0, scope="auth-register")
_refresh_throttle = rate_limit(30, 60.0, scope="auth-refresh")


def _issue_tokens(user) -> tuple[str, str]:
    """Mint an (access, refresh) token pair for a user. Single source of
    truth so every auth entry point (register/login/refresh) stays in sync."""
    payload = {"sub": str(user.id), "email": user.email}
    access_token = create_access_token(
        data=payload,
        expires_delta=timedelta(hours=settings.jwt_expiration_hours),
    )
    refresh_token = create_refresh_token(
        data=payload,
        expires_delta=timedelta(days=settings.jwt_refresh_expiration_days),
    )
    return access_token, refresh_token


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(
    user_data: UserCreate,
    db: Prisma = Depends(get_db),
    _: None = Depends(_register_throttle),
):
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
            "nativeLanguage": user_data.native_language,
            "learningLanguage": user_data.learning_language,
            "proficiencyLevel": user_data.proficiency_level,
            "oauthProvider": "email",
            "isActive": True,
            "isAdmin": False
        }
    )

    # Create token pair (sub must be a string for JWT compliance)
    access_token, refresh_token = _issue_tokens(new_user)

    return {
        "user": new_user,
        "token": access_token,
        "refresh_token": refresh_token,
    }


@router.post("/login", response_model=AuthResponse)
async def login(
    credentials: UserLogin,
    db: Prisma = Depends(get_db),
    _: None = Depends(_login_throttle),
):
    """Login user and return JWT token"""
    logger.info("Login attempt for email: %s", credentials.email)
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

    # Create token pair (sub must be a string for JWT compliance)
    access_token, refresh_token = _issue_tokens(user)

    return {
        "user": user,
        "token": access_token,
        "refresh_token": refresh_token,
    }


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(current_user = Depends(get_current_user)):
    """Get current user information"""
    # Prisma returns camelCase attrs; UserResponse.model_validate handles
    # the camelCase→snake_case mapping AND attaches entitlements. Calling
    # it explicitly avoids FastAPI's default serializer, which would read
    # snake_case attributes that don't exist on the Prisma object.
    return UserResponse.model_validate(current_user)


@router.post("/refresh", response_model=RefreshResponse)
async def refresh_token(
    body: RefreshRequest | None = None,
    authorization: str | None = Header(default=None),
    db: Prisma = Depends(get_db),
    _: None = Depends(_refresh_throttle),
):
    """Exchange a token for a fresh access+refresh pair.

    Deliberately does NOT depend on `get_current_user`: the whole point is
    to work when the *access* token has expired. Two accepted shapes:

      • Mobile (preferred): a long-lived refresh token in the JSON body.
        We require `type == "refresh"` and rotate the refresh token, so a
        leaked-and-used token dies as soon as the real client refreshes.
      • Web (legacy): the access token in the Authorization header with an
        empty body. Only succeeds while that access token is still valid —
        unchanged from the endpoint's prior behavior.
    """
    invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired refresh token",
        headers={"WWW-Authenticate": "Bearer"},
    )

    token_str = body.refresh_token if body else None
    # Only enforce the refresh-type guard on the body path; the legacy
    # header path carries an access token by design.
    require_refresh_type = token_str is not None
    if token_str is None and authorization and authorization.lower().startswith("bearer "):
        token_str = authorization[7:].strip()
    if not token_str:
        raise invalid

    payload = verify_token(token_str)
    # verify_token returns None on bad signature OR expiry. On the body
    # path also reject an access token presented as a refresh token.
    if payload is None or (require_refresh_type and payload.get("type") != "refresh"):
        raise invalid

    user_id_str = payload.get("sub")
    try:
        user_id = int(user_id_str)
    except (ValueError, TypeError):
        raise invalid

    user = await db.user.find_unique(where={"id": user_id})
    if user is None or not user.isActive:
        raise invalid

    access_token, new_refresh_token = _issue_tokens(user)
    return {
        "token": access_token,
        "refresh_token": new_refresh_token,
        "user": user,
    }


@router.patch("/me", response_model=UserResponse)
async def update_user_profile(
    user_update: UserUpdate,
    current_user = Depends(get_current_user),
    db: Prisma = Depends(get_db)
):
    """Update current user's profile"""
    update_data = {}

    if user_update.username is not None:
        # Check if username is already taken
        existing = await db.user.find_first(
            where={"username": user_update.username, "id": {"not": current_user.id}}
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already taken"
            )
        update_data["username"] = user_update.username

    if user_update.language_preference is not None:
        update_data["languagePreference"] = user_update.language_preference

    if user_update.native_language is not None:
        if user_update.native_language not in SUPPORTED_LANGUAGES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported language: {user_update.native_language}"
            )
        update_data["nativeLanguage"] = user_update.native_language

    if user_update.learning_language is not None:
        if user_update.learning_language not in SUPPORTED_LANGUAGES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported language: {user_update.learning_language}"
            )
        update_data["learningLanguage"] = user_update.learning_language

    if user_update.proficiency_level is not None:
        update_data["proficiencyLevel"] = user_update.proficiency_level

    if user_update.default_tab is not None:
        if user_update.default_tab not in ["movies", "books"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid default_tab: {user_update.default_tab}. Must be 'movies' or 'books'"
            )
        update_data["defaultTab"] = user_update.default_tab

    if not update_data:
        return current_user

    updated_user = await db.user.update(
        where={"id": current_user.id},
        data=update_data
    )

    return updated_user


