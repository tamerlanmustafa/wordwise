"""
Google OAuth 2.0 authentication routes using Prisma.
"""

from fastapi import APIRouter, HTTPException, status, Depends
from datetime import timedelta
from prisma import Prisma
from ..database import get_db
from ..schemas.oauth import (
    GoogleLoginRequest,
    GoogleLoginResponse,
    GoogleSignupRequest,
    GoogleSignupResponse,
    UserInfo
)
from ..utils.google_auth import verify_google_token, generate_username_from_email
from ..utils.auth import create_access_token
from ..config import get_settings

router = APIRouter(prefix="/auth/google", tags=["oauth"])
settings = get_settings()


def _verify_and_get_google_user_info(id_token: str) -> dict:
    """Verify Google ID token and extract user info."""
    google_user_info = None

    # Try dev client ID first
    try:
        google_user_info = verify_google_token(id_token, settings.google_client_id)
    except Exception:
        pass

    # Try prod client ID if dev failed and prod is configured
    if not google_user_info and settings.google_client_id_prod:
        try:
            google_user_info = verify_google_token(id_token, settings.google_client_id_prod)
        except Exception:
            pass

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


async def _create_or_update_user(
    google_user_info: dict,
    db: Prisma,
    allow_new: bool = True,
    native_language: str | None = None,
    learning_language: str | None = None
):
    """Create or update user based on Google info using Prisma."""
    google_id = google_user_info['google_id']
    email = google_user_info['email']
    is_new_user = False

    # Check if user exists by Google ID
    user = await db.user.find_first(
        where={"googleId": google_id}
    )

    # If not found by Google ID, check by email
    if not user:
        user = await db.user.find_unique(
            where={"email": email}
        )

        if user:
            # Existing user logging in with Google for the first time
            update_data = {
                "googleId": google_id,
                "oauthProvider": "google",
                "profilePictureUrl": google_user_info.get('picture')
            }
            # Update language preferences if provided and not already set
            if native_language and not user.nativeLanguage:
                update_data["nativeLanguage"] = native_language
            if learning_language and not user.learningLanguage:
                update_data["learningLanguage"] = learning_language

            user = await db.user.update(
                where={"id": user.id},
                data=update_data
            )
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
            while await db.user.find_unique(where={"username": username}):
                username = f"{base_username}{counter}"
                counter += 1

            # Create new user with Prisma
            user_data = {
                "email": email,
                "username": username,
                "googleId": google_id,
                "oauthProvider": "google",
                "profilePictureUrl": google_user_info.get('picture'),
                "isActive": True
            }
            # Add language preferences if provided
            if native_language:
                user_data["nativeLanguage"] = native_language
            if learning_language:
                user_data["learningLanguage"] = learning_language

            user = await db.user.create(data=user_data)
            is_new_user = True
    else:
        # Existing Google user - update profile picture if changed
        update_data = {}
        if user.profilePictureUrl != google_user_info.get('picture'):
            update_data["profilePictureUrl"] = google_user_info.get('picture')
        # Update language preferences if provided and not already set
        if native_language and not user.nativeLanguage:
            update_data["nativeLanguage"] = native_language
        if learning_language and not user.learningLanguage:
            update_data["learningLanguage"] = learning_language

        if update_data:
            user = await db.user.update(
                where={"id": user.id},
                data=update_data
            )

    return user, is_new_user


def _create_user_response(user) -> UserInfo:
    """Create UserInfo response object from Prisma User model."""
    return UserInfo(
        id=user.id,
        email=user.email,
        username=user.username,
        oauth_provider=user.oauthProvider,
        profile_picture_url=user.profilePictureUrl
    )


@router.post("/signup", response_model=GoogleSignupResponse, status_code=status.HTTP_201_CREATED)
async def google_signup(request: GoogleSignupRequest, db: Prisma = Depends(get_db)):
    """Sign up a new user with Google OAuth 2.0 using Prisma."""
    try:
        # Verify Google ID token
        google_user_info = _verify_and_get_google_user_info(request.id_token)

        # Check if user already exists
        google_id = google_user_info['google_id']
        email = google_user_info['email']

        existing_user = await db.user.find_first(
            where={
                "OR": [
                    {"googleId": google_id},
                    {"email": email}
                ]
            }
        )

        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="An account with this Google account or email already exists. Please use the login endpoint."
            )

        # Create new user
        user, is_new_user = await _create_or_update_user(google_user_info, db, allow_new=True)

        # Generate JWT access token
        access_token_expires = timedelta(hours=settings.jwt_expiration_hours)
        access_token = create_access_token(
            data={"sub": str(user.id), "email": user.email},
            expires_delta=access_token_expires
        )

        return GoogleSignupResponse(
            access_token=access_token,
            token_type="bearer",
            user=_create_user_response(user),
            is_new_user=is_new_user
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred during signup: {str(e)}"
        )


@router.post("/login", response_model=GoogleLoginResponse, status_code=status.HTTP_200_OK)
async def google_login(request: GoogleLoginRequest, db: Prisma = Depends(get_db)):
    """Authenticate user with Google OAuth 2.0 using Prisma."""
    try:
        # Verify Google ID token
        google_user_info = _verify_and_get_google_user_info(request.id_token)

        # Create or update user (allows new users), with language preferences
        user, _ = await _create_or_update_user(
            google_user_info,
            db,
            allow_new=True,
            native_language=request.native_language,
            learning_language=request.learning_language
        )

        # Generate JWT access token
        access_token_expires = timedelta(hours=settings.jwt_expiration_hours)
        access_token = create_access_token(
            data={"sub": str(user.id), "email": user.email},
            expires_delta=access_token_expires
        )

        return GoogleLoginResponse(
            access_token=access_token,
            token_type="bearer",
            user=_create_user_response(user)
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred during authentication: {str(e)}"
        )
