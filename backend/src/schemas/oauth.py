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


class UserInfo(BaseModel):
    """User information in OAuth responses"""
    id: int
    email: str
    username: str
    oauth_provider: str
    profile_picture_url: str | None = None

    class Config:
        from_attributes = True


class GoogleLoginResponse(BaseModel):
    """Response for successful Google OAuth login"""
    access_token: str
    token_type: str = "bearer"
    user: UserInfo

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
    user: UserInfo
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