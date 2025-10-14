from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from ..models.user_word_list import ListType


class UserWordListCreate(BaseModel):
    word_id: int
    list_type: ListType


class UserWordListResponse(BaseModel):
    id: int
    user_id: int
    word_id: int
    list_type: ListType
    added_at: datetime
    
    class Config:
        from_attributes = True


