from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime
from ..models.user import ProficiencyLevel


class UserCreate(BaseModel):
    email: EmailStr
    username: str
    password: str
    language_preference: Optional[str] = "en"
    proficiency_level: Optional[ProficiencyLevel] = ProficiencyLevel.A1


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: int
    email: str
    username: str
    language_preference: str
    proficiency_level: ProficiencyLevel
    is_active: bool
    created_at: datetime
    
    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str


