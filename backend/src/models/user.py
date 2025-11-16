from sqlalchemy import Column, Integer, String, Enum, DateTime, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from ..database import Base


class ProficiencyLevel(str, enum.Enum):
    A1 = "A1"
    A2 = "A2"
    B1 = "B1"
    B2 = "B2"
    C1 = "C1"
    C2 = "C2"


class OAuthProvider(str, enum.Enum):
    """OAuth provider types"""
    EMAIL = "email"  # Traditional email/password
    GOOGLE = "google"  # Google OAuth
    FACEBOOK = "facebook"  # Facebook OAuth


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    username = Column(String, unique=True, index=True, nullable=False)

    # Password - nullable for OAuth users
    password_hash = Column(String, nullable=True)

    # OAuth fields
    oauth_provider = Column(
        Enum(OAuthProvider, values_callable=lambda x: [e.value for e in x]),
        default=OAuthProvider.EMAIL,
        nullable=False
    )
    google_id = Column(String, unique=True, nullable=True, index=True)
    profile_picture_url = Column(String, nullable=True)

    # User preferences
    language_preference = Column(String, default="en")
    proficiency_level = Column(
        Enum(ProficiencyLevel, values_callable=lambda x: [e.value for e in x]),
        default=ProficiencyLevel.A1
    )

    # Status fields
    is_active = Column(Boolean, default=True)
    is_admin = Column(Boolean, default=False)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    word_lists = relationship("UserWordList", back_populates="user", cascade="all, delete-orphan")


