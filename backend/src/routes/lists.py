"""
Lists tab — the one place a user finds everything they have kept.

Thin route layer: every rule (ownership, kind immutability, the pinned-list
guards, limits, idempotency, and which table a list's members actually live
in) is in `services/lists.py`. Handlers here only translate `ListError` into
the wire envelope and shape the response.

`user_id` always comes from the token, never from the body or query.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from prisma import Prisma

from ..database import get_db
from ..middleware.auth import get_current_active_user
from ..schemas.lists import (
    AddItemsRequest,
    CreateListRequest,
    ListDetailResponse,
    ListPreview,
    ListsResponse,
    ListSummaryOut,
    RenameListRequest,
    ReorderListsRequest,
)
from ..services import lists as svc
from .srs import start_session

router = APIRouter(prefix="/lists", tags=["lists"])


def _fail(err: svc.ListError) -> HTTPException:
    """One envelope for every domain error, so the client can switch on
    `detail.code` rather than parsing prose."""
    return HTTPException(
        status_code=err.status,
        detail={"code": err.code, "message": err.message},
    )


def _out(summary: svc.ListSummary) -> ListSummaryOut:
    return ListSummaryOut(
        id=summary.id,
        name=summary.name,
        kind=summary.kind,
        system_key=summary.system_key,
        count=summary.count,
        due_count=summary.due_count,
        total_words=summary.total_words,
        preview=ListPreview(
            posters=summary.preview_posters,
            words=summary.preview_words,
        ),
        updated_at=summary.updated_at,
    )


@router.get("", response_model=ListsResponse)
async def get_lists(
    kind: Optional[str] = Query(None, description="films | words. Omit for both."),
    db: Prisma = Depends(get_db),
    user=Depends(get_current_active_user),
):
    """The index. The two pinned lists are created on demand, so this is
    never empty — a brand-new user sees `Saved from Home` and `Favourites`
    with a count of zero rather than a blank tab."""
    try:
        summaries = await svc.get_lists(db, user.id, kind)
    except svc.ListError as err:
        raise _fail(err) from err
    return ListsResponse(lists=[_out(s) for s in summaries])


@router.put("/order", status_code=204)
async def reorder_lists(
    body: ReorderListsRequest,
    db: Prisma = Depends(get_db),
    user=Depends(get_current_active_user),
):
    """Declared before `/{list_id}` so the literal path wins the match —
    otherwise "order" would be parsed as an int list id and 422."""
    await svc.reorder_lists(db, user.id, body.ids)
    return Response(status_code=204)


@router.get("/{list_id}", response_model=ListDetailResponse)
async def get_list(
    list_id: int,
    limit: int = Query(svc.DEFAULT_PAGE_SIZE, ge=1, le=svc.MAX_PAGE_SIZE),
    cursor: Optional[str] = Query(None),
    sort: Optional[str] = Query(None, description="films: added|title|rating. "
                                                 "words: added|due|alpha."),
    db: Prisma = Depends(get_db),
    user=Depends(get_current_active_user),
):
    try:
        detail = await svc.get_list(
            db, user.id, list_id, limit=limit, cursor=cursor, sort=sort,
        )
    except svc.ListError as err:
        raise _fail(err) from err
    return ListDetailResponse(
        list=_out(detail.summary),
        items=detail.items,
        next_cursor=detail.next_cursor,
    )


@router.post("", response_model=ListSummaryOut, status_code=201)
async def create_list(
    body: CreateListRequest,
    db: Prisma = Depends(get_db),
    user=Depends(get_current_active_user),
):
    try:
        return _out(await svc.create_list(db, user.id, body.name, body.kind))
    except svc.ListError as err:
        raise _fail(err) from err


@router.patch("/{list_id}", response_model=ListSummaryOut)
async def rename_list(
    list_id: int,
    body: RenameListRequest,
    db: Prisma = Depends(get_db),
    user=Depends(get_current_active_user),
):
    try:
        return _out(await svc.rename_list(db, user.id, list_id, body.name))
    except svc.ListError as err:
        raise _fail(err) from err


@router.delete("/{list_id}", status_code=204)
async def delete_list(
    list_id: int,
    db: Prisma = Depends(get_db),
    user=Depends(get_current_active_user),
):
    """Cascades to the membership rows. Never touches `user_words` SRS state
    or the reel — deleting a list is not unlearning its words."""
    try:
        await svc.delete_list(db, user.id, list_id)
    except svc.ListError as err:
        raise _fail(err) from err
    return Response(status_code=204)


@router.post("/{list_id}/items", response_model=ListSummaryOut)
async def add_items(
    list_id: int,
    body: AddItemsRequest,
    db: Prisma = Depends(get_db),
    user=Depends(get_current_active_user),
):
    """Batch add, idempotent per item. Returns the updated summary so the
    client can refresh the row's count and preview without a refetch."""
    films = [f.model_dump() for f in body.films] if body.films else None
    words = [w.model_dump() for w in body.words] if body.words else None
    try:
        summary = await svc.add_items(db, user.id, list_id, films=films, words=words)
    except svc.ListError as err:
        raise _fail(err) from err

    await _log_membership(db, user.id, summary, "LIST_ADD", films, words)
    return _out(summary)


@router.delete("/{list_id}/items/{key}", status_code=204)
async def remove_item(
    list_id: int,
    key: str,
    db: Prisma = Depends(get_db),
    user=Depends(get_current_active_user),
):
    """`key` is the TMDB id for films, the URL-encoded lowercased word for
    words. Idempotent — removing a non-member is still a 204."""
    try:
        summary = await svc.remove_item(db, user.id, list_id, key)
    except svc.ListError as err:
        raise _fail(err) from err

    removed = [{"tmdb_id": key}] if summary.kind == "films" else [{"word": key}]
    await _log_membership(
        db, user.id, summary, "LIST_REMOVE",
        removed if summary.kind == "films" else None,
        removed if summary.kind == "words" else None,
    )
    return Response(status_code=204)


@router.post("/{list_id}/practice")
async def practice_list(
    list_id: int,
    db: Prisma = Depends(get_db),
    user=Depends(get_current_active_user),
):
    """The one gold action.

    Delegates straight to `/srs/session/start` rather than duplicating the
    session machinery, so the free-tier daily cap, the paywall 402, card
    hydration, and `srsLastSessionKind` all behave exactly as they do from
    the Practice tab. The response is the standard session-start payload the
    review screen already consumes.
    """
    try:
        row = await svc.get_list_row(db, user.id, list_id)
    except svc.ListError as err:
        raise _fail(err) from err

    kind = "list_films" if str(row.kind) == "films" else "list_words"
    result = await start_session(
        kind=kind,
        movie_id=None,
        list_id=list_id,
        current_user=user,
        db=db,
    )
    # An empty pool is a 409 rather than an empty session, so the client can
    # keep the user on the list with a real message instead of pushing them
    # into a review screen with nothing to review.
    if not getattr(result, "cards", None):
        raise _fail(svc.ListError(
            "nothing_to_practice", 409,
            "There's nothing to practise in this list yet",
        ))
    return result


async def _log_membership(
    db: Prisma,
    user_id: int,
    summary: svc.ListSummary,
    action: str,
    films: Optional[list[dict]],
    words: Optional[list[dict]],
) -> None:
    """Analytics (§10). Fire-and-forget: a failed log must never fail the
    write the user actually asked for."""
    entries = films or words or []
    for entry in entries:
        try:
            await db.userwordinteraction.create(data={
                "userId": user_id,
                "word": str(entry.get("word") or entry.get("tmdb_id") or ""),
                "interactionType": action,
                "metadata": {
                    "list_id": summary.id,
                    "kind": summary.kind,
                    "system_key": summary.system_key,
                },
            })
        except Exception:
            continue
