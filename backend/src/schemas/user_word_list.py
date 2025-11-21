from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from prisma.enums import listtype


class UserWordListCreate(BaseModel):
    word_id: int
    list_type: listtype


class UserWordListResponse(BaseModel):
    id: int
    userId: int
    wordId: int
    listType: listtype
    added_at: Optional[datetime]

    class Config:
        from_attributes = True


