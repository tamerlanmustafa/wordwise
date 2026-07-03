from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional
from datetime import datetime
from prisma.enums import proficiencylevel
from ..utils.subscription import entitlements_payload


class UserCreate(BaseModel):
    email: EmailStr
    username: str
    password: str
    language_preference: Optional[str] = "en"  # Translation target language
    native_language: Optional[str] = "en"  # User's native language (ISO 639-1 code)
    learning_language: Optional[str] = "en"  # Language user is learning (ISO 639-1 code)
    proficiency_level: Optional[proficiencylevel] = proficiencylevel.A1

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        # Min 8 matches the signup form's client-side rule (SignUpPage.tsx).
        # Max 72 *bytes* because bcrypt silently truncates beyond that —
        # without the cap, characters past byte 72 wouldn't participate in
        # the hash at all.
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters long")
        if len(v.encode("utf-8")) > 72:
            raise ValueError("Password must be at most 72 bytes long")
        return v


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class Entitlements(BaseModel):
    """Mobile/web clients read this off /auth/me to decide what to gate.
    Authoritative source: src/utils/subscription.py."""
    tier: str
    is_premium: bool
    is_admin: bool
    ads_eligible: bool
    subscription_expires_at: Optional[str] = None


class UserResponse(BaseModel):
    id: int
    email: str
    username: str
    language_preference: Optional[str] = None
    native_language: Optional[str] = None
    learning_language: Optional[str] = None
    proficiency_level: Optional[proficiencylevel] = None
    default_tab: Optional[str] = "movies"
    is_active: Optional[bool] = None
    is_admin: Optional[bool] = None
    created_at: Optional[datetime] = None
    profile_picture_url: Optional[str] = None
    oauth_provider: Optional[str] = None
    entitlements: Optional[Entitlements] = None

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
                'native_language': getattr(obj, 'nativeLanguage', None),
                'learning_language': getattr(obj, 'learningLanguage', None),
                'proficiency_level': obj.proficiencyLevel,
                'default_tab': getattr(obj, 'defaultTab', 'movies'),
                'is_active': obj.isActive,
                'is_admin': getattr(obj, 'isAdmin', None),
                'created_at': obj.createdAt,
                'profile_picture_url': obj.profilePictureUrl,
                'oauth_provider': obj.oauthProvider,
                'entitlements': entitlements_payload(obj),
            }
            return super().model_validate(data)
        return super().model_validate(obj)


class UserUpdate(BaseModel):
    """Schema for updating user profile"""
    username: Optional[str] = None
    language_preference: Optional[str] = None
    native_language: Optional[str] = None
    learning_language: Optional[str] = None
    proficiency_level: Optional[proficiencylevel] = None
    default_tab: Optional[str] = None  # "movies" or "books"


class Token(BaseModel):
    access_token: str
    token_type: str


class AuthResponse(BaseModel):
    user: UserResponse
    token: str
    refresh_token: str


class RefreshRequest(BaseModel):
    # Optional so the legacy web client (which posts an empty body and the
    # access token in the Authorization header) still validates. Mobile
    # sends the long-lived refresh token here.
    refresh_token: Optional[str] = None


class RefreshResponse(BaseModel):
    token: str
    refresh_token: str
    user: UserResponse


# Supported languages with their names
SUPPORTED_LANGUAGES = {
    "en": "English",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "it": "Italian",
    "pt": "Portuguese",
    "ru": "Russian",
    "zh": "Chinese",
    "ja": "Japanese",
    "ko": "Korean",
    "ar": "Arabic",
    "hi": "Hindi",
    "tr": "Turkish",
    "pl": "Polish",
    "nl": "Dutch",
    "sv": "Swedish",
    "da": "Danish",
    "no": "Norwegian",
    "fi": "Finnish",
    "cs": "Czech",
    "el": "Greek",
    "he": "Hebrew",
    "th": "Thai",
    "vi": "Vietnamese",
    "id": "Indonesian",
    "ms": "Malay",
    "uk": "Ukrainian",
    "ro": "Romanian",
    "hu": "Hungarian",
    "bg": "Bulgarian",
}


