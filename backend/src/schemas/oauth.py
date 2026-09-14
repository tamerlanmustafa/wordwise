"""
OAuth authentication schemas for request/response validation.
"""

from pydantic import BaseModel, Field, field_validator
from typing import Optional

from ..utils.ui_languages import normalize_ui_language
from .user import UserResponse


def _narrow_app_language(v: Optional[str]) -> Optional[str]:
    """Drop an app language we don't ship instead of rejecting it.

    Same rule as `UserCreate`: signing in must never fail over a preference
    field. The unknown value simply doesn't get stored, and the account falls
    back to English mail until Settings sets one.
    """
    return normalize_ui_language(v)


class GoogleLoginRequest(BaseModel):
    """Request body for Google OAuth login"""
    id_token: str = Field(..., description="Google ID token from client")
    native_language: Optional[str] = Field(None, description="User's native language code")
    learning_language: Optional[str] = Field(None, description="Language user is learning")
    app_language: Optional[str] = Field(
        None,
        description="App UI language, stored on users.language_preference. "
                    "An OAuth signup gets its welcome email in this language.",
    )

    _normalize_app_language = field_validator("app_language")(_narrow_app_language)

    class Config:
        json_schema_extra = {
            "example": {
                "id_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6IjI3...",
                "native_language": "es",
                "learning_language": "en",
                "app_language": "es"
            }
        }


# A user is described by `UserResponse` and nothing else. This module used to
# declare its own narrower `UserInfo` for the OAuth responses, which carried no
# `entitlements`, no `onboarding_completed` and no `language_preference` — so a
# Google or Apple sign-in produced a user the app could not tell was premium or
# already onboarded. Two schemas for one entity is how those fields go missing
# on one path and nobody notices; there is now one.


class GoogleLoginResponse(BaseModel):
    """Response for successful Google OAuth login"""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserResponse

    class Config:
        json_schema_extra = {
            "example": {
                "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                "token_type": "bearer",
                "user": {
                    "id": 1,
                    "email": "user@example.com",
                    "username": "user_example",
                    "oauth_provider": "google",
                    "profile_picture_url": "https://example.com/photo.jpg"
                }
            }
        }


class GoogleSignupRequest(BaseModel):
    """Request body for Google OAuth signup"""
    id_token: str = Field(..., description="Google ID token from client")

    class Config:
        json_schema_extra = {
            "example": {
                "id_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6IjI3..."
            }
        }


class GoogleSignupResponse(BaseModel):
    """Response for successful Google OAuth signup"""
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
    is_new_user: bool = True

    class Config:
        json_schema_extra = {
            "example": {
                "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                "token_type": "bearer",
                "user": {
                    "id": 1,
                    "email": "user@example.com",
                    "username": "user_example",
                    "oauth_provider": "google",
                    "profile_picture_url": "https://example.com/photo.jpg"
                },
                "is_new_user": True
            }
        }

class AppleLoginRequest(BaseModel):
    """Request body for Sign in with Apple.

    `full_name` exists because Apple sends the user's name to the *client*
    exactly once (first authorization) and never puts it in the token — the
    client forwards it so we can store a sensible username.
    """
    identity_token: str = Field(..., description="Apple identity token (JWT) from AuthenticationServices")
    full_name: Optional[str] = Field(None, description="User's name — only present on first Apple authorization")
    native_language: Optional[str] = Field(None, description="User's native language code")
    learning_language: Optional[str] = Field(None, description="Language user is learning")
    app_language: Optional[str] = Field(
        None, description="App UI language, stored on users.language_preference."
    )

    _normalize_app_language = field_validator("app_language")(_narrow_app_language)

    class Config:
        json_schema_extra = {
            "example": {
                "identity_token": "eyJraWQiOiJXNldjT0tCIiwiYWxnIjoiUlMyNTYifQ...",
                "full_name": "Jane Appleseed",
                "native_language": "es",
                "learning_language": "en",
                "app_language": "es"
            }
        }
