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
    language_preference: Optional[str]
    proficiency_level: Optional[proficiencylevel]
    is_active: Optional[bool]
    created_at: Optional[datetime]
    profile_picture_url: Optional[str] = None

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str


class AuthResponse(BaseModel):
    user: UserResponse
    token: str


