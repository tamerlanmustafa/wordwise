"""
Wire schemas for the Lists tab (routes/lists.py).

Snake_case on the wire, matching the rest of the API; the mobile client maps
to camelCase in its API layer, not in components.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

ListKind = Literal["films", "words"]
SrsState = Literal["new", "learning", "due", "learned"]


class ListPreview(BaseModel):
    """At most 3 items, in list order. Exactly one side is populated —
    `posters` for a films list, `words` for a words list — so the index row
    can render its fan or its first-three line without a second request."""
    posters: Optional[List[str]] = None
    words: Optional[List[str]] = None


class ListSummaryOut(BaseModel):
    id: int
    name: str
    kind: ListKind
    # 'reel' | 'favourites' | null. Non-null means pinned: the client renders
    # the name from `lists.system.*` so it localises, and hides rename/delete.
    system_key: Optional[str] = None
    count: int
    # Words lists only — how many members are due for review right now.
    due_count: Optional[int] = None
    # Films lists only — size of the combined vocabulary of its films.
    total_words: Optional[int] = None
    preview: ListPreview
    updated_at: datetime


class ListsResponse(BaseModel):
    lists: List[ListSummaryOut]


class ListFilmItemOut(BaseModel):
    tmdb_id: int
    title: str
    poster_path: Optional[str] = None
    year: Optional[int] = None
    rating: Optional[float] = None
    cefr: Optional[str] = None
    word_count: Optional[int] = None
    added_at: datetime


class ListWordItemOut(BaseModel):
    word: str
    lemma_id: Optional[int] = None
    pos: Optional[str] = None
    cefr: Optional[str] = None
    srs_state: SrsState
    next_review_at: Optional[datetime] = None
    added_at: datetime


class ListDetailResponse(BaseModel):
    """The summary plus one page of items. `items` is heterogeneous by kind —
    film shape or word shape, never mixed, because a list holds one or the
    other."""
    list: ListSummaryOut
    items: List[dict]
    next_cursor: Optional[str] = None


class CreateListRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)
    kind: ListKind


class RenameListRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)


class AddFilmItem(BaseModel):
    tmdb_id: int
    title: str
    poster_path: Optional[str] = None
    year: Optional[int] = None


class AddWordItem(BaseModel):
    word: str = Field(..., min_length=1)
    lemma_id: Optional[int] = None


class AddItemsRequest(BaseModel):
    """Batch, so an Add-to-list multi-select is one round trip. Exactly one
    side is sent; the other must match the list's kind or the service raises
    `list_kind_mismatch`."""
    films: Optional[List[AddFilmItem]] = None
    words: Optional[List[AddWordItem]] = None


class ReorderListsRequest(BaseModel):
    ids: List[int]
