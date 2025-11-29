from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import List, Optional
from prisma import Prisma
from ..database import get_db
from ..middleware.auth import get_current_active_user

router = APIRouter(prefix="/user/words", tags=["user_words"])


class SaveWordRequest(BaseModel):
    word: str
    movie_id: Optional[int] = None


class LearnWordRequest(BaseModel):
    word: str
    is_learned: bool


class UserWordResponse(BaseModel):
    id: int
    word: str
    movie_id: Optional[int]
    is_learned: bool
    created_at: str


@router.post("/save")
async def save_word(
    request: SaveWordRequest,
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db)
):
    existing = await db.userword.find_first(
        where={
            "userId": current_user.id,
            "word": request.word
        }
    )

    if existing:
        await db.userword.delete(where={"id": existing.id})
        return {"saved": False, "word": request.word}

    data = {
        "userId": current_user.id,
        "word": request.word,
        "isLearned": False
    }

    if request.movie_id:
        movie_exists = await db.movie.find_unique(where={"id": request.movie_id})
        if movie_exists:
            data["movieId"] = request.movie_id

    await db.userword.create(data=data)

    return {"saved": True, "word": request.word}


@router.post("/learn")
async def learn_word(
    request: LearnWordRequest,
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db)
):
    user_word = await db.userword.find_first(
        where={
            "userId": current_user.id,
            "word": request.word
        }
    )

    if not user_word:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Word not found in saved words"
        )

    await db.userword.update(
        where={"id": user_word.id},
        data={"isLearned": request.is_learned}
    )

    return {"learned": request.is_learned, "word": request.word}


@router.get("/", response_model=List[UserWordResponse])
async def get_user_words(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db)
):
    words = await db.userword.find_many(
        where={"userId": current_user.id},
        order={"createdAt": "desc"}
    )

    return [
        UserWordResponse(
            id=word.id,
            word=word.word,
            movie_id=word.movieId,
            is_learned=word.isLearned,
            created_at=word.createdAt.isoformat()
        )
        for word in words
    ]


@router.get("/list/{list_name}")
async def get_user_words_list(
    list_name: str,
    sort: Optional[str] = "date_desc",
    level: Optional[str] = None,
    movie_id: Optional[int] = None,
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db)
):
    where_clause = {"userId": current_user.id}

    if list_name == "saved":
        pass
    elif list_name == "learned":
        where_clause["isLearned"] = True

    if movie_id:
        where_clause["movieId"] = movie_id

    order = {"createdAt": "desc"} if sort == "date_desc" else {"createdAt": "asc"}

    words = await db.userword.find_many(
        where=where_clause,
        order=order,
        include={"movie": True}
    )

    return {
        "list_name": list_name,
        "total": len(words),
        "words": [
            {
                "id": word.id,
                "word": word.word,
                "movie_id": word.movieId,
                "movie_title": word.movie.title if word.movie else None,
                "is_learned": word.isLearned,
                "created_at": word.createdAt.isoformat()
            }
            for word in words
        ]
    }
