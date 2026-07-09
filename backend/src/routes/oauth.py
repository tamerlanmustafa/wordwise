"""
OAuth authentication routes (Google + Apple) using Prisma.
"""

from fastapi import APIRouter, HTTPException, status, Depends
from datetime import timedelta
from prisma import Prisma
from ..database import get_db
from ..schemas.oauth import (
    AppleLoginRequest,
    GoogleLoginRequest,
    GoogleLoginResponse,
    UserInfo,
)
from ..utils.apple_auth import verify_apple_token, AppleAuthError
from ..utils.google_auth import verify_google_token, generate_username_from_email
from ..utils.auth import create_access_token, create_refresh_token
from ..config import get_settings
from ..utils.rate_limit import rate_limit
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth/google", tags=["oauth"])
# Separate router because the Google one's prefix bakes in "google".
# Registered alongside it in main.py.
apple_router = APIRouter(prefix="/auth/apple", tags=["oauth"])
settings = get_settings()

# Same brute-force/abuse ceiling as the password login path.
_google_login_throttle = rate_limit(10, 60.0, scope="auth-google")
_apple_login_throttle = rate_limit(10, 60.0, scope="auth-apple")


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

    # Try mobile client ID if others failed
    if not google_user_info and settings.google_client_id_mobile:
        try:
            google_user_info = verify_google_token(id_token, settings.google_client_id_mobile)
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
        profile_picture_url=user.profilePictureUrl,
        native_language=user.nativeLanguage,
        learning_language=user.learningLanguage,
        proficiency_level=user.proficiencyLevel.value if hasattr(user.proficiencyLevel, 'value') else user.proficiencyLevel,
        default_tab=user.defaultTab or "movies",
        is_admin=user.isAdmin or False
    )


@router.post("/login", response_model=GoogleLoginResponse, status_code=status.HTTP_200_OK)
async def google_login(
    request: GoogleLoginRequest,
    db: Prisma = Depends(get_db),
    _: None = Depends(_google_login_throttle),
):
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

        # Generate JWT token pair
        token_payload = {"sub": str(user.id), "email": user.email}
        access_token = create_access_token(
            data=token_payload,
            expires_delta=timedelta(hours=settings.jwt_expiration_hours),
        )
        refresh_token = create_refresh_token(
            data=token_payload,
            expires_delta=timedelta(days=settings.jwt_refresh_expiration_days),
        )

        return GoogleLoginResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            token_type="bearer",
            user=_create_user_response(user)
        )

    except HTTPException:
        raise
    except Exception:
        # Log the real cause server-side; never echo internal error text to
        # the client (it can leak stack/library details).
        logger.exception("Google authentication failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred during authentication."
        )


# ── Sign in with Apple ──────────────────────────────────────────────────────
# Required by App Store Guideline 4.8: an app offering Google Sign-In must
# offer an equivalent privacy-focused option. Mirrors the Google flow above:
# verify token → find-or-create/link user → issue the same JWT pair.

async def _create_or_update_apple_user(
    apple_user_info: dict,
    db: Prisma,
    full_name: str | None = None,
    native_language: str | None = None,
    learning_language: str | None = None,
):
    """Find-or-create a user from verified Apple info (mirror of the Google
    helper). Linking rule: match by appleId first; else by verified email
    (existing account adds Apple as a login method); else create."""
    apple_id = apple_user_info["apple_id"]
    # A trusted email is one Apple attests: an unverified address must neither
    # link to an existing account (takeover) nor mint a fresh one under an
    # address the sender may not own.
    email = (
        apple_user_info.get("email")
        if apple_user_info.get("email_verified")
        else None
    )
    is_new_user = False

    user = await db.user.find_first(where={"appleId": apple_id})

    if not user and email:
        user = await db.user.find_unique(where={"email": email})
        if user:
            update_data = {"appleId": apple_id, "oauthProvider": "apple"}
            if native_language and not user.nativeLanguage:
                update_data["nativeLanguage"] = native_language
            if learning_language and not user.learningLanguage:
                update_data["learningLanguage"] = learning_language
            user = await db.user.update(where={"id": user.id}, data=update_data)

    if not user:
        if not email:
            # No trusted email: either a repeat login for an Apple ID we've
            # never stored (e.g. the row was deleted), or an unverified
            # address. Without a trusted email we can't create an account.
            # The client fix is Settings → Apple ID → Sign in with Apple →
            # revoke WordWise, then sign in again (Apple resends the email).
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Apple did not share an email for this Apple ID and no "
                    "existing account matches it. Revoke WordWise in your "
                    "Apple ID settings and try again."
                ),
            )

        # Username: prefer the client-forwarded name (first auth only),
        # fall back to the email local part; both deduped with a counter.
        base_username = (
            "_".join(full_name.split()).lower()
            if full_name
            else generate_username_from_email(email)
        )
        username = base_username
        counter = 1
        while await db.user.find_unique(where={"username": username}):
            username = f"{base_username}{counter}"
            counter += 1

        user_data = {
            "email": email,
            "username": username,
            "appleId": apple_id,
            "oauthProvider": "apple",
            "isActive": True,
        }
        if native_language:
            user_data["nativeLanguage"] = native_language
        if learning_language:
            user_data["learningLanguage"] = learning_language

        user = await db.user.create(data=user_data)
        is_new_user = True
    else:
        update_data = {}
        if native_language and not user.nativeLanguage:
            update_data["nativeLanguage"] = native_language
        if learning_language and not user.learningLanguage:
            update_data["learningLanguage"] = learning_language
        if update_data:
            user = await db.user.update(where={"id": user.id}, data=update_data)

    return user, is_new_user


@apple_router.post("/login", response_model=GoogleLoginResponse, status_code=status.HTTP_200_OK)
async def apple_login(
    request: AppleLoginRequest,
    db: Prisma = Depends(get_db),
    _: None = Depends(_apple_login_throttle),
):
    """Authenticate a user with Sign in with Apple."""
    try:
        try:
            apple_user_info = verify_apple_token(
                request.identity_token, settings.apple_bundle_id
            )
        except AppleAuthError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid Apple token",
            )

        user, _is_new = await _create_or_update_apple_user(
            apple_user_info,
            db,
            full_name=request.full_name,
            native_language=request.native_language,
            learning_language=request.learning_language,
        )

        token_payload = {"sub": str(user.id), "email": user.email}
        access_token = create_access_token(
            data=token_payload,
            expires_delta=timedelta(hours=settings.jwt_expiration_hours),
        )
        refresh_token = create_refresh_token(
            data=token_payload,
            expires_delta=timedelta(days=settings.jwt_refresh_expiration_days),
        )

        return GoogleLoginResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            token_type="bearer",
            user=_create_user_response(user),
        )

    except HTTPException:
        raise
    except Exception:
        # Same fail-closed logging posture as the Google route: real cause
        # server-side only, generic message to the client.
        logger.exception("Apple authentication failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred during authentication.",
        )
