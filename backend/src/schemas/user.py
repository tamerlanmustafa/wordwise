from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime
from prisma.enums import proficiencylevel


class UserCreate(BaseModel):
    email: EmailStr
    username: str
    password: str
    language_preference: Optional[str] = "en"  # Translation target language
    native_language: Optional[str] = "en"  # User's native language (ISO 639-1 code)
    learning_language: Optional[str] = "en"  # Language user is learning (ISO 639-1 code)
    proficiency_level: Optional[proficiencylevel] = proficiencylevel.A1


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: int
    email: str
    username: str
    language_preference: Optional[str] = None
    native_language: Optional[str] = None
    learning_language: Optional[str] = None
    proficiency_level: Optional[proficiencylevel] = None
    is_active: Optional[bool] = None
    is_admin: Optional[bool] = None
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
                'native_language': getattr(obj, 'nativeLanguage', None),
                'learning_language': getattr(obj, 'learningLanguage', None),
                'proficiency_level': obj.proficiencyLevel,
                'is_active': obj.isActive,
                'is_admin': getattr(obj, 'isAdmin', None),
                'created_at': obj.createdAt,
                'profile_picture_url': obj.profilePictureUrl,
                'oauth_provider': obj.oauthProvider
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


class Token(BaseModel):
    access_token: str
    token_type: str


class AuthResponse(BaseModel):
    user: UserResponse
    token: str


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


