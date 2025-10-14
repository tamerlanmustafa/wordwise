from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Enum
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
import enum
from ..database import Base


class ListType(str, enum.Enum):
    LEARN_LATER = "learn_later"
    FAVORITES = "favorites"
    MASTERED = "mastered"


class UserWordList(Base):
    __tablename__ = "user_word_lists"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    word_id = Column(Integer, ForeignKey("words.id"), nullable=False)
    list_type = Column(Enum(ListType), nullable=False)
    added_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    user = relationship("User", back_populates="word_lists")
    word = relationship("Word", back_populates="user_lists")
    
    __table_args__ = (
        {'comment': 'Junction table for user word lists'}
    )


