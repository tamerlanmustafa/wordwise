from fastapi import APIRouter, Depends, HTTPException, status
from prisma import Prisma
from prisma.enums import listtype
from typing import List, Optional
from ..database import get_db
from ..schemas.user_word_list import UserWordListCreate, UserWordListResponse
from ..middleware.auth import get_current_active_user

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me/words", response_model=List[UserWordListResponse])
async def get_user_words(
    list_type: Optional[listtype] = None,
    current_user = Depends(get_current_active_user),
    db: Prisma = Depends(get_db)
):
    """Get current user's word lists"""
    where_clause = {"userId": current_user.id}

    if list_type:
        where_clause["listType"] = list_type

    word_lists = await db.userwordlist.find_many(where=where_clause)
    return word_lists


@router.post("/words", response_model=UserWordListResponse, status_code=status.HTTP_201_CREATED)
async def add_word_to_list(
    word_data: UserWordListCreate,
    current_user = Depends(get_current_active_user),
    db: Prisma = Depends(get_db)
):
    """Add a word to user's list"""
    # Check if word already exists in user's list
    existing = await db.userwordlist.find_first(
        where={
            "userId": current_user.id,
            "wordId": word_data.word_id,
            "listType": word_data.list_type
        }
    )

    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Word already in this list"
        )

    new_word_list = await db.userwordlist.create(
        data={
            "userId": current_user.id,
            "wordId": word_data.word_id,
            "listType": word_data.list_type
        }
    )

    return new_word_list


@router.delete("/words/{word_list_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_word_from_list(
    word_list_id: int,
    current_user = Depends(get_current_active_user),
    db: Prisma = Depends(get_db)
):
    """Remove a word from user's list"""
    word_list = await db.userwordlist.find_first(
        where={
            "id": word_list_id,
            "userId": current_user.id
        }
    )

    if not word_list:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Word not found in your lists"
        )

    await db.userwordlist.delete(where={"id": word_list_id})

    return None


