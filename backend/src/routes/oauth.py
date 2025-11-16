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
from ..schemas.oauth import GoogleLoginRequest, GoogleLoginResponse
from ..utils.google_auth import verify_google_token, GoogleAuthError, generate_username_from_email
from ..utils.auth import create_access_token
from ..config import get_settings

router = APIRouter(prefix="/auth/google", tags=["oauth"])
settings = get_settings()


@router.post("/login", response_model=GoogleLoginResponse, status_code=status.HTTP_200_OK)
async def google_login(request: GoogleLoginRequest, db: Session = Depends(get_db)):
    """
    Authenticate user with Google OAuth 2.0.

    Flow:
    1. Verify Google ID token
    2. Check if user exists (by google_id or email)
    3. Create new user if doesn't exist
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
        HTTPException 400: If email not verified or missing
    """
    try:
        # Verify Google ID token and extract user info
        google_user_info = verify_google_token(
            request.id_token,
            settings.google_client_id
        )

        if not google_user_info:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid Google token"
            )

        # Check if email is verified
        if not google_user_info.get('email_verified'):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email not verified with Google"
            )

        google_id = google_user_info['google_id']
        email = google_user_info['email']

        # Check if user exists by Google ID
        user = db.query(User).filter(User.google_id == google_id).first()

        # If not found by Google ID, check by email (for existing users migrating to Google OAuth)
        if not user:
            user = db.query(User).filter(User.email == email).first()

            if user:
                # Existing user logging in with Google for the first time
                # Update their account to link with Google
                user.google_id = google_id
                user.oauth_provider = OAuthProvider.GOOGLE
                user.profile_picture_url = google_user_info.get('picture')
                db.commit()
                db.refresh(user)
            else:
                # New user - create account
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
                    password_hash=None,  # No password for OAuth users
                    is_active=True
                )

                db.add(user)
                db.commit()
                db.refresh(user)
        else:
            # Existing Google user - update profile picture if changed
            if user.profile_picture_url != google_user_info.get('picture'):
                user.profile_picture_url = google_user_info.get('picture')
                db.commit()
                db.refresh(user)

        # Generate JWT access token
        access_token_expires = timedelta(hours=settings.jwt_expiration_hours)
        access_token = create_access_token(
            data={"sub": user.id, "email": user.email},
            expires_delta=access_token_expires
        )

        # Return token and user info
        return {
            "access_token": access_token,
            "token_type": "bearer",
            "user": {
                "id": user.id,
                "email": user.email,
                "username": user.username,
                "oauth_provider": user.oauth_provider,
                "profile_picture_url": user.profile_picture_url
            }
        }

    except GoogleAuthError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred during authentication: {str(e)}"
        )