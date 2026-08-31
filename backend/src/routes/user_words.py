from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import List, Optional
from prisma import Prisma
from prisma.errors import UniqueViolationError
from ..database import get_db
from ..middleware.auth import get_current_active_user
from ..services.session_kinds import PRACTICE_SOURCE, user_owned_where_fragment

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
    saved_in_count: Optional[int] = None
    saved_in_movies: Optional[List[dict]] = None


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
        # A row a Practice session added for its own padding is not a save —
        # the saved-word surfaces filter it out. Treating it as one would
        # invert this toggle: the user taps the heart on a word they have never
        # saved and the tap deletes the row instead of saving it. Promote it,
        # keeping the SRS progress it has already accumulated.
        if getattr(existing, "source", None) == PRACTICE_SOURCE:
            await db.userword.update(
                where={"id": existing.id},
                data={"source": None},
            )
            return {"saved": True, "word": request.word}
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


@router.post("/mark-learned")
async def mark_word_learned(
    request: SaveWordRequest,
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db)
):
    # Upsert a global (movieId=null) learned marker. Hides the word from all
    # movie vocabulary lists. Leaves any per-movie saved rows untouched —
    # starring and "never show again" are orthogonal.
    #
    # This is find-then-create rather than a Prisma upsert because the
    # uniqueness backstop is a partial index (`user_words_global_word_unique`,
    # movie_id IS NULL) that Prisma can't name in a `where`. Two concurrent
    # calls can therefore both miss the find; the loser hits the index and is
    # caught below, which is the whole point of the index — see issue #93.
    existing = await db.userword.find_first(
        where={
            "userId": current_user.id,
            "word": request.word,
            "movieId": None,
        }
    )

    if existing:
        if not existing.isLearned:
            await db.userword.update(
                where={"id": existing.id},
                data={"isLearned": True},
            )
    else:
        try:
            await db.userword.create(
                data={
                    "userId": current_user.id,
                    "word": request.word,
                    "isLearned": True,
                }
            )
        except UniqueViolationError:
            # A concurrent /mark-learned won the race. Its row is already the
            # marker we wanted, so flag it learned and report success.
            await db.userword.update_many(
                where={
                    "userId": current_user.id,
                    "word": request.word,
                    "movieId": None,
                },
                data={"isLearned": True},
            )

    return {"learned": True, "word": request.word}


@router.post("/unlearn")
async def unlearn_word(
    request: SaveWordRequest,
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db)
):
    # Remove the global learned marker. Per-movie rows are untouched.
    #
    # delete_many, not find_first + delete: pre-#93 data can still hold
    # duplicate global rows, and deleting only one would leave a stale marker
    # that keeps hiding the word from every list.
    await db.userword.delete_many(
        where={
            "userId": current_user.id,
            "word": request.word,
            "movieId": None,
            "isLearned": True,
        }
    )

    return {"learned": False, "word": request.word}


@router.get("/learned")
async def get_learned_words(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db)
):
    # Only the global learned markers — these are what the client uses to
    # hide rows across every movie. Per-movie rows with isLearned=true are
    # possible in legacy data but aren't treated as "hide" markers.
    words = await db.userword.find_many(
        where={
            "userId": current_user.id,
            "isLearned": True,
            "movieId": None,
        },
        order={"createdAt": "desc"},
    )

    return [
        {
            "id": w.id,
            "word": w.word,
            "created_at": w.createdAt.isoformat(),
        }
        for w in words
    ]


@router.get("/", response_model=List[UserWordResponse])
async def get_user_words(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db)
):
    # Excludes the rows a Practice session padded itself with. They live in
    # user_words like everything else and carry real SRS state, but the user
    # never saved them, so listing them here would silently fill the saved-words
    # screen with vocabulary they did not choose. See UserWord.source.
    words = await db.userword.find_many(
        where={"userId": current_user.id, **user_owned_where_fragment()},
        include={"movie": True},
        order={"createdAt": "desc"}
    )

    word_map = {}
    for word in words:
        word_key = word.word
        if word_key not in word_map:
            word_map[word_key] = {
                "id": word.id,
                "word": word.word,
                "movie_id": word.movieId,
                "movie_ids": [],
                "is_learned": word.isLearned,
                "created_at": word.createdAt,
                "saved_in_movies": [],
                "saved_in_count": 0
            }

        word_map[word_key]["saved_in_count"] += 1
        if word.movieId:
            word_map[word_key]["movie_ids"].append(word.movieId)
        if word.movie:
            word_map[word_key]["saved_in_movies"].append({
                "title": word.movie.title,
                "created_at": word.createdAt.isoformat(),
                "movie_id": word.movieId
            })

        if word.createdAt < word_map[word_key]["created_at"]:
            word_map[word_key]["created_at"] = word.createdAt

    return [
        UserWordResponse(
            id=data["id"],
            word=data["word"],
            movie_id=data["movie_id"],
            is_learned=data["is_learned"],
            created_at=data["created_at"].isoformat(),
            saved_in_count=data["saved_in_count"],
            saved_in_movies=data["saved_in_movies"]
        )
        for data in word_map.values()
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
        # Same exclusion as GET / — a Practice session's padding is not a save.
        # "learned" is left alone on purpose: marking a word learned is an
        # explicit act, so a word the quiz introduced and the user then
        # graduated genuinely belongs in that list.
        where_clause.update(user_owned_where_fragment())
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

    unique_words = {}
    for word in words:
        if word.word not in unique_words:
            unique_words[word.word] = {
                "id": word.id,
                "word": word.word,
                "movie_id": word.movieId,
                "movie_title": word.movie.title if word.movie else None,
                "is_learned": word.isLearned,
                "created_at": word.createdAt.isoformat(),
                "saved_in_count": word_counts.get(word.word, 1),
                "saved_in_movies": word_movies.get(word.word, [])
            }

    return {
        "list_name": list_name,
        "total": len(unique_words),
        "words": list(unique_words.values())
    }
