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