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
    where_clause = {
        "userId": current_user.id,
        "word": request.word
    }

    if request.movie_id:
        where_clause["movieId"] = request.movie_id

    existing = await db.userword.find_first(where=where_clause)

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
    user_words = await db.userword.find_many(
        where={
            "userId": current_user.id,
            "word": request.word
        }
    )

    if not user_words:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Word not found in saved words"
        )

    for user_word in user_words:
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


@router.get("/other-movies")
async def get_other_movie_uses(
    word: str,
    exclude_movie_id: Optional[int] = None,
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db)
):
    where_clause = {
        "userId": current_user.id,
        "word": word
    }

    if exclude_movie_id:
        where_clause["NOT"] = {"movieId": exclude_movie_id}

    words = await db.userword.find_many(
        where=where_clause,
        include={"movie": True}
    )

    return [
        {
            "movie_id": word.movieId,
            "title": word.movie.title if word.movie else None
        }
        for word in words
        if word.movie
    ]


@router.post("/other-movies/batch")
async def get_other_movie_uses_batch(
    words: List[str],
    exclude_movie_id: Optional[int] = None,
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db)
):
    where_clause = {
        "userId": current_user.id,
        "word": {"in": words}
    }

    if exclude_movie_id:
        where_clause["NOT"] = {"movieId": exclude_movie_id}

    user_words = await db.userword.find_many(
        where=where_clause,
        include={"movie": True}
    )

    result = {}
    for word in user_words:
        if not word.movie:
            continue

        word_key = word.word
        if word_key not in result:
            result[word_key] = []

        result[word_key].append({
            "movie_id": word.movieId,
            "title": word.movie.title
        })

    return result


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

    all_user_words = await db.userword.find_many(
        where={"userId": current_user.id},
        include={"movie": True},
        order={"createdAt": "desc"}
    )

    word_counts = {}
    word_movies = {}
    for w in all_user_words:
        if w.word not in word_counts:
            word_counts[w.word] = 0
            word_movies[w.word] = []
        word_counts[w.word] += 1
        if w.movie:
            word_movies[w.word].append({
                "title": w.movie.title,
                "created_at": w.createdAt.isoformat()
            })

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
                "created_at": word.createdAt.isoformat(),
                "saved_in_count": word_counts.get(word.word, 1),
                "saved_in_movies": word_movies.get(word.word, [])
            }
            for word in words
        ]
    }
