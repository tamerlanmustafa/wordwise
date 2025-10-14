from sqlalchemy import Column, Integer, String, Text, DateTime, Enum
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
import enum
from ..database import Base


class DifficultyLevel(str, enum.Enum):
    BEGINNER = "A1"
    ELEMENTARY = "A2"
    INTERMEDIATE = "B1"
    UPPER_INTERMEDIATE = "B2"
    ADVANCED = "C1"
    PROFICIENT = "C2"


class Movie(Base):
    __tablename__ = "movies"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False, index=True)
    year = Column(Integer, nullable=False)
    genre = Column(String)
    difficulty_level = Column(Enum(DifficultyLevel), default=DifficultyLevel.INTERMEDIATE)
    script_text = Column(Text)
    word_count = Column(Integer, default=0)
    description = Column(Text)
    poster_url = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationships
    words = relationship("Word", back_populates="movie", cascade="all, delete-orphan")


