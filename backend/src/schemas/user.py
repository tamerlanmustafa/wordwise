from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime
from prisma.enums import proficiencylevel


class UserCreate(BaseModel):
    email: EmailStr
    username: str
    password: str
    language_preference: Optional[str] = "en"
    proficiency_level: Optional[proficiencylevel] = proficiencylevel.A1


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: int
    email: str
    username: str
    language_preference: Optional[str] = None
    proficiency_level: Optional[proficiencylevel] = None
    is_active: Optional[bool] = None
    created_at: Optional[datetime] = None
    profile_picture_url: Optional[str] = None
    oauth_provider: Optional[str] = None

    class Config:
        from_attributes = True
        # Map Prisma camelCase to Pydantic snake_case
        populate_by_name = True

    # Add field aliases to map Prisma field names
    @classmethod
    def model_validate(cls, obj):
        """Custom validator to handle Prisma field mapping"""
        if hasattr(obj, 'profilePictureUrl'):
            data = {
                'id': obj.id,
                'email': obj.email,
                'username': obj.username,
                'language_preference': obj.languagePreference,
                'proficiency_level': obj.proficiencyLevel,
                'is_active': obj.isActive,
                'created_at': obj.createdAt,
                'profile_picture_url': obj.profilePictureUrl,
                'oauth_provider': obj.oauthProvider
            }
            return super().model_validate(data)
        return super().model_validate(obj)


class Token(BaseModel):
    access_token: str
    token_type: str


class AuthResponse(BaseModel):
    user: UserResponse
    token: str


