from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import Optional
from prisma import Prisma, Json
from ..database import get_db
from ..middleware.auth import get_current_active_user

router = APIRouter(prefix="/user/interactions", tags=["interactions"])


class LogInteractionRequest(BaseModel):
    word: str
    movie_id: Optional[int] = None
    interaction_type: str  # ROW_CLICK, TRANSLATION_VIEW, DEFINITION_VIEW, WORD_SAVE, WORD_UNSAVE
    metadata: Optional[dict] = None


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

    data = {
        "user": {"connect": {"id": current_user.id}},
        "word": request.word,
        "interactionType": request.interaction_type,
    }
    if request.movie_id is not None:
        data["movie"] = {"connect": {"id": request.movie_id}}
    if request.metadata is not None:
        data["metadata"] = Json(request.metadata)

    await db.userwordinteraction.create(data=data)

    return {"ok": True}
