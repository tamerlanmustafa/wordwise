from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from ..database import get_db
from ..models.user import User
from ..models.user_word_list import UserWordList, ListType
from ..schemas.user_word_list import UserWordListCreate, UserWordListResponse
from ..middleware.auth import get_current_active_user

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me/words", response_model=List[UserWordListResponse])
async def get_user_words(
    list_type: Optional[ListType] = None,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """Get current user's word lists"""
    query = db.query(UserWordList).filter(UserWordList.user_id == current_user.id)
    
    if list_type:
        query = query.filter(UserWordList.list_type == list_type)
    
    word_lists = query.all()
    return word_lists


@router.post("/words", response_model=UserWordListResponse, status_code=status.HTTP_201_CREATED)
async def add_word_to_list(
    word_data: UserWordListCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """Add a word to user's list"""
    # Check if word already exists in user's list
    existing = db.query(UserWordList).filter(
        UserWordList.user_id == current_user.id,
        UserWordList.word_id == word_data.word_id,
        UserWordList.list_type == word_data.list_type
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Word already in this list"
        )
    
    new_word_list = UserWordList(
        user_id=current_user.id,
        word_id=word_data.word_id,
        list_type=word_data.list_type
    )
    
    db.add(new_word_list)
    db.commit()
    db.refresh(new_word_list)
    
    return new_word_list


@router.delete("/words/{word_list_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_word_from_list(
    word_list_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """Remove a word from user's list"""
    word_list = db.query(UserWordList).filter(
        UserWordList.id == word_list_id,
        UserWordList.user_id == current_user.id
    ).first()
    
    if not word_list:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Word not found in your lists"
        )
    
    db.delete(word_list)
    db.commit()
    
    return None


