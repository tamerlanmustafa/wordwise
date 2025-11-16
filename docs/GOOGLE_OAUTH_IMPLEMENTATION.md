# Google OAuth 2.0 Implementation Guide

This document contains the complete implementation for Google Single Sign-On in WordWise.

## Table of Contents
1. [Backend Implementation](#backend-implementation)
2. [Frontend Implementation](#frontend-implementation)
3. [Google OAuth Setup](#google-oauth-setup)
4. [Environment Configuration](#environment-configuration)
5. [Testing](#testing)

---

## Backend Implementation

### 1. Install Required Dependencies

Already installed:
```bash
pip install google-auth google-auth-oauthlib google-auth-httplib2
```

### 2. Update Environment Configuration

**File: `backend/src/config.py`**

Add Google OAuth settings:

```python
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Database
    database_url: str

    # JWT
    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    jwt_expiration_hours: int = 24

    # Application
    app_name: str = "WordWise"
    app_version: str = "1.0.0"
    debug: bool = True

    # CORS
    allowed_origins: str = "http://localhost:3000"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # Google OAuth - ADD THESE
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:3000/auth/callback"

    # External APIs
    oxford_api_key: str = ""
    oxford_app_id: str = ""
    google_translate_api_key: str = ""

    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    return Settings()
```

### 3. Create Google OAuth Utility

**File: `backend/src/utils/google_auth.py`** (NEW FILE)

```python
"""
Google OAuth 2.0 authentication utilities.

This module handles Google ID token verification and user info extraction.
"""

from google.auth.transport import requests
from google.oauth2 import id_token
from typing import Optional, Dict, Any
import logging

logger = logging.getLogger(__name__)


class GoogleAuthError(Exception):
    """Custom exception for Google authentication errors"""
    pass


def verify_google_token(token: str, client_id: str) -> Optional[Dict[str, Any]]:
    """
    Verify Google ID token and extract user information.

    Args:
        token: The Google ID token to verify
        client_id: Your Google OAuth client ID

    Returns:
        Dictionary containing user info (sub, email, name, picture) if valid,
        None if verification fails

    Raises:
        GoogleAuthError: If token verification fails
    """
    try:
        # Verify the token
        idinfo = id_token.verify_oauth2_token(
            token,
            requests.Request(),
            client_id
        )

        # Verify the token is for our app
        if idinfo['iss'] not in ['accounts.google.com', 'https://accounts.google.com']:
            raise GoogleAuthError('Invalid token issuer')

        # Extract user information
        user_info = {
            'google_id': idinfo['sub'],  # Google user ID (unique identifier)
            'email': idinfo.get('email'),
            'name': idinfo.get('name'),
            'given_name': idinfo.get('given_name'),
            'family_name': idinfo.get('family_name'),
            'picture': idinfo.get('picture'),  # Profile picture URL
            'email_verified': idinfo.get('email_verified', False)
        }

        logger.info(f"Successfully verified Google token for user: {user_info['email']}")
        return user_info

    except ValueError as e:
        # Invalid token
        logger.error(f"Invalid Google token: {str(e)}")
        raise GoogleAuthError(f"Invalid token: {str(e)}")
    except Exception as e:
        logger.error(f"Error verifying Google token: {str(e)}")
        raise GoogleAuthError(f"Token verification failed: {str(e)}")


def generate_username_from_email(email: str) -> str:
    """
    Generate a unique username from email address.

    Args:
        email: User's email address

    Returns:
        Username derived from email (part before @)
    """
    return email.split('@')[0].lower().replace('.', '_')
```

### 4. Create OAuth Schema

**File: `backend/src/schemas/oauth.py`** (NEW FILE)

```python
"""
OAuth authentication schemas for request/response validation.
"""

from pydantic import BaseModel, Field


class GoogleLoginRequest(BaseModel):
    """Request body for Google OAuth login"""
    id_token: str = Field(..., description="Google ID token from client")

    class Config:
        json_schema_extra = {
            "example": {
                "id_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6IjI3..."
            }
        }


class GoogleLoginResponse(BaseModel):
    """Response for successful Google OAuth login"""
    access_token: str
    token_type: str = "bearer"
    user: dict

    class Config:
        json_schema_extra = {
            "example": {
                "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                "token_type": "bearer",
                "user": {
                    "id": 1,
                    "email": "user@example.com",
                    "username": "user_example",
                    "oauth_provider": "google"
                }
            }
        }
```

### 5. Create Google OAuth Route

**File: `backend/src/routes/oauth.py`** (NEW FILE)

```python
"""
Google OAuth 2.0 authentication routes.

Handles Google Sign-In flow:
1. Client sends Google ID token
2. Server verifies token with Google
3. Create or update user in database
4. Return JWT access token
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import timedelta

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
```

### 6. Register OAuth Router

**File: `backend/src/routes/__init__.py`**

Update to include OAuth router:

```python
from .auth import router as auth_router
from .movies import router as movies_router
from .users import router as users_router
from .oauth import router as oauth_router  # ADD THIS

__all__ = ["auth_router", "movies_router", "users_router", "oauth_router"]  # ADD oauth_router
```

**File: `backend/src/main.py`**

Register the OAuth router:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import get_settings
from .routes import auth_router, movies_router, users_router, oauth_router  # ADD oauth_router

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    debug=settings.debug
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth_router)
app.include_router(movies_router)
app.include_router(users_router)
app.include_router(oauth_router)  # ADD THIS

@app.get("/")
def read_root():
    return {"message": "Welcome to WordWise API"}

@app.get("/health")
def health_check():
    return {"status": "healthy"}
```

---

## Frontend Implementation

### 1. Install Google OAuth Library

```bash
cd frontend
npm install @react-oauth/google
```

### 2. Add Google Client ID to Environment

**File: `frontend/.env.local`**

```
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-google-client-id-here.apps.googleusercontent.com
```

### 3. Create Google Login Button Component

**File: `frontend/src/components/GoogleLoginButton.tsx`** (NEW FILE)

```typescript
/**
 * Google OAuth Login Button Component
 *
 * Displays Google's branded "Sign in with Google" button
 * and handles the OAuth flow.
 */

import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';
import { useRouter } from 'next/router';
import { useState } from 'react';

interface GoogleLoginButtonProps {
  onSuccess?: (user: any) => void;
  onError?: (error: string) => void;
}

export function GoogleLoginButton({ onSuccess, onError }: GoogleLoginButtonProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleSuccess = async (credentialResponse: any) => {
    setIsLoading(true);

    try {
      // Send the Google ID token to your backend
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/google/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id_token: credentialResponse.credential,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Google login failed');
      }

      const data = await response.json();

      // Store the JWT token
      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('user', JSON.stringify(data.user));

      // Call success callback
      if (onSuccess) {
        onSuccess(data.user);
      }

      // Redirect to dashboard
      router.push('/dashboard');

    } catch (error) {
      console.error('Google login error:', error);
      if (onError) {
        onError(error instanceof Error ? error.message : 'Google login failed');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleError = () => {
    console.error('Google login failed');
    if (onError) {
      onError('Google login was unsuccessful');
    }
  };

  return (
    <div className="w-full">
      {isLoading ? (
        <div className="flex justify-center items-center py-3">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
        </div>
      ) : (
        <GoogleLogin
          onSuccess={handleGoogleSuccess}
          onError={handleGoogleError}
          useOneTap
          size="large"
          width="100%"
        />
      )}
    </div>
  );
}

/**
 * Wrapper component that provides Google OAuth context
 * Use this in your login/signup pages
 */
export function GoogleOAuthWrapper({ children }: { children: React.ReactNode }) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  if (!clientId) {
    console.error('Google Client ID is not configured');
    return <div>Google Sign-In is not configured</div>;
  }

  return (
    <GoogleOAuthProvider clientId={clientId}>
      {children}
    </GoogleOAuthProvider>
  );
}
```

### 4. Update Login Page

**File: `frontend/src/pages/login.tsx`** (UPDATE)

```typescript
import { useState } from 'react';
import { GoogleOAuthWrapper, GoogleLoginButton } from '../components/GoogleLoginButton';

export default function LoginPage() {
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');

  const handleGoogleSuccess = (user: any) => {
    setSuccess(`Welcome, ${user.username}!`);
    setError('');
  };

  const handleGoogleError = (errorMessage: string) => {
    setError(errorMessage);
    setSuccess('');
  };

  return (
    <GoogleOAuthWrapper>
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div>
            <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
              Sign in to WordWise
            </h2>
          </div>

          {/* Error/Success Messages */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
              {success}
            </div>
          )}

          <div className="mt-8 space-y-6">
            {/* Google Sign-In Button */}
            <GoogleLoginButton
              onSuccess={handleGoogleSuccess}
              onError={handleGoogleError}
            />

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-gray-50 text-gray-500">Or continue with email</span>
              </div>
            </div>

            {/* Traditional email/password login form goes here */}
            <form className="mt-8 space-y-6" action="#" method="POST">
              {/* Your existing login form */}
            </form>
          </div>
        </div>
      </div>
    </GoogleOAuthWrapper>
  );
}
```

---

## Google OAuth Setup

### Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Name it "WordWise" or similar

### Step 2: Enable Google+ API

1. In the Google Cloud Console, go to "APIs & Services" > "Library"
2. Search for "Google+ API"
3. Click "Enable"

### Step 3: Create OAuth 2.0 Credentials

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth client ID"
3. Configure consent screen first if prompted:
   - User Type: External
   - App name: WordWise
   - User support email: your email
   - Developer contact: your email
4. Create OAuth client ID:
   - Application type: Web application
   - Name: WordWise Web Client
   - Authorized JavaScript origins:
     - `http://localhost:3000`
     - `http://localhost:3001`
   - Authorized redirect URIs:
     - `http://localhost:3000/auth/callback`
     - `http://localhost:3001/auth/callback`
5. Click "Create"
6. Copy the Client ID and Client Secret

### Step 4: Configure Environment Variables

**Backend** (`backend/.env`):
```
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
```

**Frontend** (`frontend/.env.local`):
```
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

---

## Testing

### Test Backend Endpoint

```bash
# Test Google login endpoint
curl -X POST http://localhost:8000/auth/google/login \
  -H "Content-Type: application/json" \
  -d '{"id_token": "YOUR_GOOGLE_ID_TOKEN_HERE"}'
```

### Test Frontend Integration

1. Start backend: `./start-backend.sh`
2. Start frontend: `./start-frontend.sh`
3. Navigate to http://localhost:3000/login
4. Click "Sign in with Google"
5. Complete Google OAuth flow
6. Verify:
   - User is created in database
   - JWT token is returned
   - User is redirected to dashboard
   - Token is stored in localStorage

### Verify Database

```bash
PGPASSWORD=wordwise_password psql -h localhost -U wordwise_user -d wordwise_db \
  -c "SELECT id, email, username, google_id, oauth_provider, profile_picture_url FROM users;"
```

---

## Security Considerations

1. **HTTPS in Production**: Always use HTTPS in production
2. **Token Validation**: Google ID tokens are validated server-side
3. **Email Verification**: Only verified Google emails are accepted
4. **JWT Security**: Use strong secret keys and appropriate expiration times
5. **CORS**: Configure allowed origins properly
6. **Rate Limiting**: Consider adding rate limiting to OAuth endpoints

---

## Troubleshooting

### "redirect_uri_mismatch" Error
- Ensure redirect URI in Google Console exactly matches your app
- Check for trailing slashes
- Verify protocol (http vs https)

### "invalid_client" Error
- Check Client ID and Secret are correct
- Ensure they match between frontend and backend

### Token Verification Fails
- Verify Google ID token is being sent correctly
- Check Client ID matches the one used to generate the token
- Ensure system time is synchronized (token validation is time-sensitive)

---

## Next Steps

1. Add user profile page showing Google profile picture
2. Implement account linking (merge email and Google accounts)
3. Add more OAuth providers (GitHub, Facebook, etc.)
4. Implement refresh tokens for longer sessions
5. Add OAuth audit logging

---

✅ Implementation Complete!
