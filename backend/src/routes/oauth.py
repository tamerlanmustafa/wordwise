"""
Google OAuth 2.0 authentication routes.

Handles Google Sign-In flow:
1. Client sends Google ID token
2. Server verifies token with Google
3. Create or update user in database
4. Return JWT access token
"""

# python -m venv .venv
# source .venv/bin/activate
# pip install --upgrade pip
# pip install fastapi uvicorn[standard] sqlalchemy
# add other project deps if needed, e.g.:
# pip install python-jose[cryptography] passlib[bcrypt] python-dotenv psycopg2-binary
from sqlalchemy.orm import Session
from datetime import timedelta
from fastapi import APIRouter
from fastapi import HTTPException
from fastapi import status
from fastapi import Depends
from ..database import get_db
from ..models.user import User, OAuthProvider
from ..schemas.oauth import (
    GoogleLoginRequest,
    GoogleLoginResponse,
    GoogleSignupRequest,
    GoogleSignupResponse,
    UserInfo
)
from ..utils.google_auth import verify_google_token, GoogleAuthError, generate_username_from_email
from ..utils.auth import create_access_token
from ..config import get_settings

router = APIRouter(prefix="/auth/google", tags=["oauth"])
settings = get_settings()


def _verify_and_get_google_user_info(id_token: str) -> dict:
    """
    Verify Google ID token and extract user info.

    Args:
        id_token: Google ID token from client

    Returns:
        Dictionary with user info from Google

    Raises:
        HTTPException: If token is invalid or email not verified
    """
    google_user_info = verify_google_token(id_token, settings.google_client_id)

    if not google_user_info:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Google token"
        )

    if not google_user_info.get('email_verified'):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email not verified with Google"
        )

    return google_user_info


def _create_or_update_user(google_user_info: dict, db: Session, allow_new: bool = True) -> tuple[User, bool]:
    """
    Create or update user based on Google info.

    Args:
        google_user_info: User info from Google
        db: Database session
        allow_new: Whether to create new users (False for login-only)

    Returns:
        Tuple of (User object, is_new_user boolean)

    Raises:
        HTTPException: If user doesn't exist and allow_new is False
    """
    google_id = google_user_info['google_id']
    email = google_user_info['email']
    is_new_user = False

    # Check if user exists by Google ID
    user = db.query(User).filter(User.google_id == google_id).first()

    # If not found by Google ID, check by email
    if not user:
        user = db.query(User).filter(User.email == email).first()

        if user:
            # Existing user logging in with Google for the first time
            user.google_id = google_id
            user.oauth_provider = OAuthProvider.GOOGLE
            user.profile_picture_url = google_user_info.get('picture')
            db.commit()
            db.refresh(user)
        else:
            # New user
            if not allow_new:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="No account found with this Google account. Please sign up first."
                )

            username = generate_username_from_email(email)

            # Ensure username is unique
            base_username = username
            counter = 1
            while db.query(User).filter(User.username == username).first():
                username = f"{base_username}{counter}"
                counter += 1

            # Create new user
            user = User(
                email=email,
                username=username,
                google_id=google_id,
                oauth_provider=OAuthProvider.GOOGLE,
                profile_picture_url=google_user_info.get('picture'),
                password_hash=None,
                is_active=True
            )

            db.add(user)
            db.commit()
            db.refresh(user)
            is_new_user = True
    else:
        # Existing Google user - update profile picture if changed
        if user.profile_picture_url != google_user_info.get('picture'):
            user.profile_picture_url = google_user_info.get('picture')
            db.commit()
            db.refresh(user)

    return user, is_new_user


def _create_user_response(user: User) -> UserInfo:
    """Create UserInfo response object from User model."""
    return UserInfo(
        id=user.id,
        email=user.email,
        username=user.username,
        oauth_provider=user.oauth_provider.value,
        profile_picture_url=user.profile_picture_url
    )


@router.post("/signup", response_model=GoogleSignupResponse, status_code=status.HTTP_201_CREATED)
async def google_signup(request: GoogleSignupRequest, db: Session = Depends(get_db)):
    """
    Sign up a new user with Google OAuth 2.0.

    Flow:
    1. Verify Google ID token
    2. Check if user already exists
    3. Create new user account
    4. Generate JWT access token
    5. Return token and user info

    Args:
        request: Contains the Google ID token
        db: Database session

    Returns:
        Access token and user information with is_new_user flag

    Raises:
        HTTPException 401: If token verification fails
        HTTPException 400: If email not verified or user already exists
    """
    try:
        # Verify Google ID token
        google_user_info = _verify_and_get_google_user_info(request.id_token)

        # Check if user already exists
        google_id = google_user_info['google_id']
        email = google_user_info['email']

        existing_user = (
            db.query(User)
            .filter((User.google_id == google_id) | (User.email == email))
            .first()
        )

        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="An account with this Google account or email already exists. Please use the login endpoint."
            )

        # Create new user
        user, is_new_user = _create_or_update_user(google_user_info, db, allow_new=True)

        # Generate JWT access token
        access_token_expires = timedelta(hours=settings.jwt_expiration_hours)
        access_token = create_access_token(
            data={"sub": user.id, "email": user.email},
            expires_delta=access_token_expires
        )

        return GoogleSignupResponse(
            access_token=access_token,
            token_type="bearer",
            user=_create_user_response(user),
            is_new_user=is_new_user
        )

    except GoogleAuthError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e)
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred during signup: {str(e)}"
        )


@router.post("/login", response_model=GoogleLoginResponse, status_code=status.HTTP_200_OK)
async def google_login(request: GoogleLoginRequest, db: Session = Depends(get_db)):
    """
    Authenticate user with Google OAuth 2.0.

    This endpoint handles both existing users and new signups for convenience.
    For explicit signup flow, use the /signup endpoint instead.

    Flow:
    1. Verify Google ID token
    2. Check if user exists (by google_id or email)
    3. Create new user if doesn't exist (auto-signup)
    4. Update existing user info if exists
    5. Generate JWT access token
    6. Return token and user info

    Args:
        request: Contains the Google ID token
        db: Database session

    Returns:
        Access token and user information

    Raises:
        HTTPException 401: If token verification fails
        HTTPException 400: If email not verified
    """
    try:
        # Verify Google ID token
        google_user_info = _verify_and_get_google_user_info(request.id_token)

        # Create or update user (allows new users)
        user, _ = _create_or_update_user(google_user_info, db, allow_new=True)

        # Generate JWT access token
        access_token_expires = timedelta(hours=settings.jwt_expiration_hours)
        access_token = create_access_token(
            data={"sub": user.id, "email": user.email},
            expires_delta=access_token_expires
        )

        return GoogleLoginResponse(
            access_token=access_token,
            token_type="bearer",
            user=_create_user_response(user)
        )

    except GoogleAuthError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e)
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred during authentication: {str(e)}"
        )