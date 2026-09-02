from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional
from datetime import datetime
from prisma.enums import proficiencylevel
from ..utils.subscription import entitlements_payload
from ..utils.ui_languages import normalize_ui_language

# The levels a *learner* can be. `proficiencylevel` is shared with the word
# registry, where it gained an `UNKNOWN` member in #91 as the holding bucket
# for words the classifier could not place. The schema's own comment says
# UNKNOWN is "never written to users.proficiency_level" — but the request
# models type this field as the raw enum, so both `POST /auth/register` and
# `PATCH /auth/me` accepted it and would happily store it.
#
# It degrades rather than crashes (`_band_levels_around` falls back to B1),
# which is exactly why it would have gone unnoticed: the user's Practice deck
# and Explore feed would quietly compose for B1 forever while Settings showed
# them a level that is not a level. Reject at the edge instead.
LEARNER_LEVELS: frozenset[proficiencylevel] = frozenset({
    proficiencylevel.A1,
    proficiencylevel.A2,
    proficiencylevel.B1,
    proficiencylevel.B2,
    proficiencylevel.C1,
    proficiencylevel.C2,
})


def _reject_non_learner_level(
    v: Optional[proficiencylevel],
) -> Optional[proficiencylevel]:
    if v is not None and v not in LEARNER_LEVELS:
        raise ValueError(
            f"{v.value} is not a proficiency level a user can be set to. "
            f"Expected one of {sorted(lvl.value for lvl in LEARNER_LEVELS)}."
        )
    return v


class UserCreate(BaseModel):
    email: EmailStr
    username: str
    password: str
    # The **app UI language** — the language of buttons and labels, and the one
    # transactional email we send this account. Not a translation target: words
    # are translated into `native_language`. Captured at signup because the
    # welcome email goes out before the user can ever open Settings.
    language_preference: Optional[str] = None
    native_language: Optional[str] = "en"  # User's native language (ISO 639-1 code)
    learning_language: Optional[str] = "en"  # Language user is learning (ISO 639-1 code)
    proficiency_level: Optional[proficiencylevel] = proficiencylevel.A1

    @field_validator("language_preference")
    @classmethod
    def normalize_language_preference(cls, v: Optional[str]) -> Optional[str]:
        # Drop rather than reject. Signup must never 400 over a preference
        # field — a client one release ahead of the server would otherwise be
        # unable to create accounts at all. `PATCH /auth/me` rejects instead,
        # which is where a client finds out it sent something we don't ship.
        return normalize_ui_language(v)

    _check_level = field_validator("proficiency_level")(_reject_non_learner_level)

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
    # App UI language, as in UserCreate. An empty string means "clear it" —
    # Settings' "follow my translation language" reset needs a way to say
    # *unset*, and `None` already means "this PATCH doesn't touch the field".
    language_preference: Optional[str] = None
    native_language: Optional[str] = None
    learning_language: Optional[str] = None
    proficiency_level: Optional[proficiencylevel] = None
    default_tab: Optional[str] = None  # "movies" or "books"

    # Unlike signup, which drops a bad `language_preference` rather than fail
    # account creation, PATCH rejects: this is where a client finds out it sent
    # something we don't ship, and the caller is a settings form that can show
    # the reason.
    _check_level = field_validator("proficiency_level")(_reject_non_learner_level)


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


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


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


