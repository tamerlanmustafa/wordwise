from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import List, Optional
from prisma import Prisma
from ..database import get_db
from ..middleware.auth import get_current_active_user
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/user/interactions", tags=["interactions"])


class LogInteractionRequest(BaseModel):
    word: str
    movie_id: Optional[int] = None
    interaction_type: str  # ROW_CLICK, TRANSLATION_VIEW, DEFINITION_VIEW, WORD_SAVE, WORD_UNSAVE
    metadata: Optional[dict] = None


class LogInteractionBatchRequest(BaseModel):
    interactions: List[LogInteractionRequest]


VALID_TYPES = {"ROW_CLICK", "TRANSLATION_VIEW", "DEFINITION_VIEW", "WORD_SAVE", "WORD_UNSAVE"}


@router.post("")
async def log_interaction(
    request: LogInteractionRequest,
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db)
):
    if request.interaction_type not in VALID_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid interaction_type. Must be one of: {VALID_TYPES}"
        )

    await db.userwordinteraction.create(
        data={
            "userId": current_user.id,
            "word": request.word,
            "movieId": request.movie_id,
            "interactionType": request.interaction_type,
            "metadata": request.metadata,
        }
    )

    return {"ok": True}


@router.post("/batch")
async def log_interactions_batch(
    request: LogInteractionBatchRequest,
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db)
):
    """Log multiple interactions at once (e.g., buffered from mobile client)."""
    created = 0
    for interaction in request.interactions[:50]:  # Cap at 50 per batch
        if interaction.interaction_type not in VALID_TYPES:
            continue
        await db.userwordinteraction.create(
            data={
                "userId": current_user.id,
                "word": interaction.word,
                "movieId": interaction.movie_id,
                "interactionType": interaction.interaction_type,
                "metadata": interaction.metadata,
            }
        )
        created += 1

    return {"ok": True, "created": created}


@router.get("/struggles")
async def get_struggle_words(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db)
):
    """Identify words the user repeatedly looks up — signals persistent difficulty."""
    interactions = await db.userwordinteraction.find_many(
        where={
            "userId": current_user.id,
            "interactionType": {"in": ["ROW_CLICK", "TRANSLATION_VIEW", "DEFINITION_VIEW"]},
        },
        order={"createdAt": "desc"},
        take=5000,
    )

    # Count lookups per word
    word_counts: dict[str, dict] = {}
    for i in interactions:
        w = i.word
        if w not in word_counts:
            word_counts[w] = {"count": 0, "movies": set(), "last_seen": i.createdAt}
        word_counts[w]["count"] += 1
        if i.movieId:
            word_counts[w]["movies"].add(i.movieId)

    # Words looked up 3+ times are "struggles"
    struggles = []
    for word, data in word_counts.items():
        if data["count"] >= 3:
            struggles.append({
                "word": word,
                "lookup_count": data["count"],
                "across_movies": len(data["movies"]),
                "last_seen": data["last_seen"].isoformat(),
            })

    struggles.sort(key=lambda x: x["lookup_count"], reverse=True)

    return {
        "total_interactions": len(interactions),
        "struggle_words": struggles[:50],
        "unique_words_looked_up": len(word_counts),
    }
