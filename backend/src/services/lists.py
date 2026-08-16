"""
Lists tab — user-owned lists of films OR words, never both.

Two lists are pinned per user (`system_key`) and cannot be renamed or deleted.
They are **adapters, not storage**: their `user_lists` row exists so the index
can render them, but their members live in the tables that already own them —

    system_key='reel'        -> user_reel_movies
                                (Home's + button, PosterFlight, /reel/*)
    system_key='favourites'  -> user_words WHERE movie_id IS NULL
                                            AND is_learned = false
                                (the Explore heart, i.e. POST /user-words/save)

so `user_list_films` / `user_list_words` hold members of USER-CREATED lists
only. The alternative — migrating the reel and the saved-word set into the new
tables and leaving the old endpoints as shims — is tidier long-term but
touches the two flows that are already shipped and instrumented. Adapters
mean there is no backfill to get wrong.

The consequence to respect everywhere: **`list.id` is not enough to know where
the rows are.** Every read and write goes through this module; routes never
query membership directly.

Query budget: `get_lists` is bounded at 8 queries regardless of how many lists
the user has — 2 to ensure the pinned rows, 1 to fetch, 3 film aggregates, 2
word aggregates (see `_film_stats` / `_word_stats`). The index must not be
N+1; `tests/test_lists_adapters.py::TestIndexQueryBudget` holds that line.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from prisma import Prisma

# ── Rules ──────────────────────────────────────────────────────────────────

ListKind = Literal["films", "words"]

SYSTEM_LISTS: dict[str, dict[str, str]] = {
    "reel":       {"kind": "films", "default_name": "Saved from Home"},
    "favourites": {"kind": "words", "default_name": "Favourites"},
}

# §1.2. Enforced here, not in the routes, so every caller gets them.
MAX_LISTS_PER_KIND = 50
MAX_FILMS_PER_LIST = 500
MAX_WORDS_PER_LIST = 2000
MAX_NAME_LENGTH = 60

# Sorts each kind accepts. `due` is meaningless for films — the route turns
# the resulting error into a 422 rather than silently falling back, so a
# client bug surfaces instead of quietly returning the wrong order.
SORTS_BY_KIND: dict[str, set[str]] = {
    "films": {"added", "title", "rating"},
    "words": {"added", "due", "alpha"},
}

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 100


class ListError(Exception):
    """Domain error carrying the wire code + HTTP status the route should
    emit. Keeps the rules in this module and the routes thin."""

    def __init__(self, code: str, status: int, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.status = status
        self.message = message


def normalize_name(raw: str | None) -> str:
    """Trim, collapse any newlines to spaces, and squeeze runs of whitespace.

    The list header is a single line, so a pasted multi-line name is folded
    rather than rejected. Length is validated against the *folded* result.
    """
    if raw is None:
        raise ListError("invalid_name", 422, "Name is required")
    folded = " ".join(str(raw).split())
    if not folded:
        raise ListError("invalid_name", 422, "Name is required")
    if len(folded) > MAX_NAME_LENGTH:
        raise ListError(
            "invalid_name", 422,
            f"Name must be {MAX_NAME_LENGTH} characters or fewer",
        )
    return folded


def validate_kind(kind: str | None) -> ListKind:
    if kind not in ("films", "words"):
        raise ListError("invalid_kind", 422, "kind must be 'films' or 'words'")
    return kind  # type: ignore[return-value]


def validate_sort(kind: str, sort: str | None) -> str:
    """Default per kind, and reject a sort the kind can't honour."""
    if sort is None or sort == "":
        return "added"
    allowed = SORTS_BY_KIND.get(kind, set())
    if sort not in allowed:
        raise ListError(
            "invalid_sort", 422,
            f"sort '{sort}' is not valid for a {kind} list",
        )
    return sort


def max_items_for(kind: str) -> int:
    return MAX_FILMS_PER_LIST if kind == "films" else MAX_WORDS_PER_LIST


def is_system(row: Any) -> bool:
    return getattr(row, "systemKey", None) is not None


def display_name(row: Any) -> str:
    """The DB stores English defaults for the pinned lists; the client renders
    them from `lists.system.*` so they localise. We still return the stored
    name so non-i18n consumers (admin, exports) read sensibly."""
    return row.name


# ── Page cursors ───────────────────────────────────────────────────────────
# Offset-encoded. The sorts are stable (every ORDER BY ends in a unique
# tiebreak) and lists are small enough that keyset pagination would be
# complexity without benefit.

def decode_cursor(cursor: str | None) -> int:
    if not cursor:
        return 0
    try:
        value = int(cursor)
    except (TypeError, ValueError):
        raise ListError("invalid_cursor", 422, "Malformed cursor")
    if value < 0:
        raise ListError("invalid_cursor", 422, "Malformed cursor")
    return value


def encode_cursor(offset: int) -> str:
    return str(offset)


def clamp_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_PAGE_SIZE
    return max(1, min(int(limit), MAX_PAGE_SIZE))


# ── Shapes ─────────────────────────────────────────────────────────────────

@dataclass
class ListSummary:
    id: int
    name: str
    kind: str
    system_key: Optional[str]
    count: int
    due_count: Optional[int]
    total_words: Optional[int]
    preview_posters: Optional[list[str]]
    preview_words: Optional[list[str]]
    updated_at: datetime


@dataclass
class ListDetail:
    summary: ListSummary
    items: list[dict] = field(default_factory=list)
    next_cursor: Optional[str] = None


# ── Internal helpers ───────────────────────────────────────────────────────

def _placeholders(start: int, count: int) -> str:
    """`$3, $4, $5` — the repo's existing raw-SQL idiom (see
    routes/srs.py::_pad_with_fresh_reel_lemmas). Prisma-python's query_raw
    does not reliably bind Python lists to Postgres arrays, so parameter
    lists are expanded by hand."""
    return ", ".join(f"${start + i}" for i in range(count))


def _now(now: Optional[datetime]) -> datetime:
    return now if now is not None else datetime.now(timezone.utc)


async def _owned_list(db: Prisma, user_id: int, list_id: int):
    """Fetch a list, or raise. A list belonging to another user is 404, never
    403 — a 403 would confirm the id exists."""
    row = await db.userlist.find_first(
        where={"id": list_id, "userId": user_id},
    )
    if row is None:
        raise ListError("list_not_found", 404, "List not found")
    return row


async def get_list_row(db: Prisma, user_id: int, list_id: int):
    """Public ownership-checked fetch of the raw row. Used by the session
    composers, which need `systemKey` to pick the right membership backend."""
    return await _owned_list(db, user_id, list_id)


async def _touch(db: Prisma, list_id: int, now: Optional[datetime] = None) -> None:
    """Bump `updated_at` so the index can order by recency after a write."""
    await db.userlist.update(
        where={"id": list_id},
        data={"updatedAt": _now(now)},
    )


def _sort_clause(kind: str, sort: str) -> str:
    """ORDER BY fragment for the table-backed detail queries. Every branch
    ends in a unique column so offset paging is stable."""
    if kind == "films":
        if sort == "title":
            return "ORDER BY LOWER(f.title) ASC, f.tmdb_id ASC"
        # `rating` lives on movies, LEFT JOINed as m.rating in the caller.
        if sort == "rating":
            return "ORDER BY m.tmdb_vote_average DESC NULLS LAST, f.tmdb_id ASC"
        return "ORDER BY f.added_at DESC, f.tmdb_id ASC"
    if sort == "alpha":
        return "ORDER BY LOWER(w.word) ASC"
    if sort == "due":
        return "ORDER BY due_at ASC NULLS LAST, w.added_at DESC, w.word ASC"
    return "ORDER BY w.added_at DESC, w.word ASC"


# ── System lists ───────────────────────────────────────────────────────────

async def ensure_system_lists(db: Prisma, user_id: int) -> None:
    """Idempotent, race-safe creation of the two pinned lists. Called at the
    top of every list read/write so a user never sees an empty tab.

    ON CONFLICT DO NOTHING against `ux_user_lists_user_system` (a partial
    unique index Prisma cannot express) is what makes two concurrent
    first-opens produce one row rather than two.
    """
    for position, (key, spec) in enumerate(SYSTEM_LISTS.items()):
        await db.execute_raw(
            """
            INSERT INTO user_lists (user_id, name, kind, system_key, position)
            VALUES ($1, $2, $3::listkind, $4, $5)
            ON CONFLICT (user_id, system_key) WHERE system_key IS NOT NULL
            DO NOTHING
            """,
            user_id, spec["default_name"], spec["kind"], key, position,
        )


# ── Index aggregates ───────────────────────────────────────────────────────
# Both take the whole set of lists and return per-list stats in a bounded
# number of queries. Adding a list must never add a query.

async def _film_stats(
    db: Prisma,
    user_id: int,
    film_lists: list[Any],
) -> dict[int, dict]:
    """count + first 3 posters + total_words for every films list.

    3 queries: custom-list members, reel members, vocabulary size across both.
    """
    out: dict[int, dict] = {
        int(r.id): {"count": 0, "posters": [], "total_words": 0} for r in film_lists
    }
    if not film_lists:
        return out

    custom_ids = [int(r.id) for r in film_lists if r.systemKey is None]
    reel_row = next((r for r in film_lists if r.systemKey == "reel"), None)
    reel_id = int(reel_row.id) if reel_row is not None else None

    # (1) Custom lists — count and the first 3 posters in one pass. COUNT(*)
    # OVER the partition rides along on the rows we already need.
    if custom_ids:
        rows = await db.query_raw(
            f"""
            SELECT list_id, poster_path, cnt
            FROM (
                SELECT
                    list_id,
                    poster_path,
                    ROW_NUMBER() OVER (
                        PARTITION BY list_id ORDER BY position ASC, added_at DESC
                    ) AS rn,
                    COUNT(*) OVER (PARTITION BY list_id) AS cnt
                FROM user_list_films
                WHERE list_id IN ({_placeholders(1, len(custom_ids))})
            ) t
            WHERE rn <= 3
            ORDER BY list_id, rn
            """,
            *custom_ids,
        )
        for row in rows:
            entry = out[int(row["list_id"])]
            entry["count"] = int(row["cnt"])
            if row["poster_path"]:
                entry["posters"].append(row["poster_path"])

    # (2) The reel adapter — same shape, different table.
    if reel_id is not None:
        rows = await db.query_raw(
            """
            SELECT poster_path, cnt
            FROM (
                SELECT
                    poster_path,
                    ROW_NUMBER() OVER (ORDER BY added_at DESC, tmdb_id ASC) AS rn,
                    COUNT(*) OVER () AS cnt
                FROM user_reel_movies
                WHERE user_id = $1
            ) t
            WHERE rn <= 3
            ORDER BY rn
            """,
            user_id,
        )
        entry = out[reel_id]
        for row in rows:
            entry["count"] = int(row["cnt"])
            if row["poster_path"]:
                entry["posters"].append(row["poster_path"])

    # (3) Vocabulary size for every films list at once. UNION ALL folds the
    # two membership sources into one scan so this stays a single query.
    union_parts: list[str] = []
    params: list[Any] = []
    if custom_ids:
        union_parts.append(
            f"SELECT list_id, tmdb_id FROM user_list_films "
            f"WHERE list_id IN ({_placeholders(1, len(custom_ids))})"
        )
        params.extend(custom_ids)
    if reel_id is not None:
        n = len(params)
        union_parts.append(
            f"SELECT ${n + 1}::bigint AS list_id, tmdb_id "
            f"FROM user_reel_movies WHERE user_id = ${n + 2}"
        )
        params.extend([reel_id, user_id])

    if union_parts:
        rows = await db.query_raw(
            f"""
            WITH list_films AS ({" UNION ALL ".join(union_parts)})
            SELECT lf.list_id, COUNT(DISTINCT mlm.lemma_id) AS total
            FROM list_films lf
            JOIN movies m ON m.tmdb_id = lf.tmdb_id
            JOIN movie_lemma_mappings mlm ON mlm.movie_id = m.id
            GROUP BY lf.list_id
            """,
            *params,
        )
        for row in rows:
            out[int(row["list_id"])]["total_words"] = int(row["total"])

    return out


async def _word_stats(
    db: Prisma,
    user_id: int,
    word_lists: list[Any],
    now: Optional[datetime] = None,
) -> dict[int, dict]:
    """count + first 3 words + due_count for every words list.

    2 queries: custom-list members (with their SRS due join), favourites.
    """
    out: dict[int, dict] = {
        int(r.id): {"count": 0, "words": [], "due_count": 0} for r in word_lists
    }
    if not word_lists:
        return out

    when = _now(now)
    custom_ids = [int(r.id) for r in word_lists if r.systemKey is None]
    fav_row = next((r for r in word_lists if r.systemKey == "favourites"), None)
    fav_id = int(fav_row.id) if fav_row is not None else None

    # (1) Custom lists. `due` is EXISTS over the user's rows for that word
    # regardless of movie: a word can have a global row plus one per movie,
    # and if any of them is due the word is due.
    if custom_ids:
        n = len(custom_ids)
        rows = await db.query_raw(
            f"""
            SELECT list_id, word, cnt, due_cnt
            FROM (
                SELECT
                    ulw.list_id,
                    ulw.word,
                    ROW_NUMBER() OVER (
                        PARTITION BY ulw.list_id
                        ORDER BY ulw.position ASC, ulw.added_at DESC
                    ) AS rn,
                    COUNT(*) OVER (PARTITION BY ulw.list_id) AS cnt,
                    COUNT(*) FILTER (WHERE EXISTS (
                        SELECT 1 FROM user_words uw
                        WHERE uw.user_id = ${n + 1}
                          AND LOWER(uw.word) = LOWER(ulw.word)
                          AND uw.is_learned = false
                          AND uw.srs_due_at <= ${n + 2}::timestamptz
                    )) OVER (PARTITION BY ulw.list_id) AS due_cnt
                FROM user_list_words ulw
                WHERE ulw.list_id IN ({_placeholders(1, n)})
            ) t
            WHERE rn <= 3
            ORDER BY list_id, rn
            """,
            *custom_ids, user_id, when,
        )
        for row in rows:
            entry = out[int(row["list_id"])]
            entry["count"] = int(row["cnt"])
            entry["due_count"] = int(row["due_cnt"])
            entry["words"].append(row["word"])

    # (2) The favourites adapter. `is_learned = false` is what separates the
    # Explore heart's saves from /mark-learned's "never show again" markers,
    # which share the same (user, word, movie_id IS NULL) shape.
    if fav_id is not None:
        rows = await db.query_raw(
            """
            SELECT word, cnt, due_cnt
            FROM (
                SELECT
                    word,
                    ROW_NUMBER() OVER (ORDER BY created_at DESC, word ASC) AS rn,
                    COUNT(*) OVER () AS cnt,
                    COUNT(*) FILTER (WHERE srs_due_at <= $2::timestamptz) OVER () AS due_cnt
                FROM user_words
                WHERE user_id = $1
                  AND movie_id IS NULL
                  AND is_learned = false
            ) t
            WHERE rn <= 3
            ORDER BY rn
            """,
            user_id, when,
        )
        entry = out[fav_id]
        for row in rows:
            entry["count"] = int(row["cnt"])
            entry["due_count"] = int(row["due_cnt"])
            entry["words"].append(row["word"])

    return out


def _summary_from(row: Any, stats: dict) -> ListSummary:
    films = row.kind == "films" if isinstance(row.kind, str) else str(row.kind) == "films"
    return ListSummary(
        id=int(row.id),
        name=display_name(row),
        kind="films" if films else "words",
        system_key=row.systemKey,
        count=stats["count"],
        due_count=None if films else stats["due_count"],
        total_words=stats["total_words"] if films else None,
        preview_posters=stats["posters"] if films else None,
        preview_words=None if films else stats["words"],
        updated_at=row.updatedAt,
    )


# ── Public API ─────────────────────────────────────────────────────────────

async def get_lists(
    db: Prisma,
    user_id: int,
    kind: Optional[str] = None,
    now: Optional[datetime] = None,
) -> list[ListSummary]:
    """The index. System lists first, then `position`, then `created_at`.

    Bounded at 8 queries total (2 ensure, 1 fetch, 3 film aggregates, 2 word
    aggregates) no matter how many lists the user has.
    """
    if kind is not None:
        validate_kind(kind)
    await ensure_system_lists(db, user_id)

    where: dict[str, Any] = {"userId": user_id}
    if kind is not None:
        where["kind"] = kind
    rows = await db.userlist.find_many(where=where)

    # System-first, then position, then created_at. Sorted in Python because
    # "system first" is `system_key IS NOT NULL DESC`, which Prisma's order
    # syntax can't express.
    rows.sort(key=lambda r: (r.systemKey is None, r.position, r.createdAt))

    film_rows = [r for r in rows if str(r.kind) == "films"]
    word_rows = [r for r in rows if str(r.kind) == "words"]
    film_stats = await _film_stats(db, user_id, film_rows)
    word_stats = await _word_stats(db, user_id, word_rows, now=now)

    merged = {**film_stats, **word_stats}
    return [_summary_from(r, merged[int(r.id)]) for r in rows]


async def get_list(
    db: Prisma,
    user_id: int,
    list_id: int,
    *,
    limit: Optional[int] = None,
    cursor: Optional[str] = None,
    sort: Optional[str] = None,
    now: Optional[datetime] = None,
) -> ListDetail:
    """One list plus a page of its items."""
    await ensure_system_lists(db, user_id)
    row = await _owned_list(db, user_id, list_id)
    kind = str(row.kind)
    sort = validate_sort(kind, sort)
    take = clamp_limit(limit)
    offset = decode_cursor(cursor)

    if kind == "films":
        stats = (await _film_stats(db, user_id, [row]))[int(row.id)]
        items = await _film_items(
            db, user_id, row, sort=sort, take=take, offset=offset,
        )
    else:
        stats = (await _word_stats(db, user_id, [row], now=now))[int(row.id)]
        items = await _word_items(
            db, user_id, row, sort=sort, take=take, offset=offset, now=now,
        )

    next_cursor = encode_cursor(offset + take) if len(items) == take else None
    return ListDetail(
        summary=_summary_from(row, stats),
        items=items,
        next_cursor=next_cursor,
    )


async def _film_items(
    db: Prisma, user_id: int, row: Any, *, sort: str, take: int, offset: int,
) -> list[dict]:
    """Film rows decorated with the catalogue fields the detail screen shows.

    The LEFT JOIN onto `movies` is what supplies rating / CEFR / word count;
    a user-added TMDB id with no catalogue row yet renders with nulls rather
    than disappearing.
    """
    if row.systemKey == "reel":
        source = "SELECT tmdb_id, title, poster_path, year, added_at " \
                 "FROM user_reel_movies WHERE user_id = $1"
        params: list[Any] = [user_id]
    else:
        source = "SELECT tmdb_id, title, poster_path, year, added_at, position " \
                 "FROM user_list_films WHERE list_id = $1"
        params = [int(row.id)]

    # The reel has no `position` column ordering we want to expose, so its
    # 'added' sort is added_at DESC; both share the title/rating branches.
    order = _sort_clause("films", sort)
    if row.systemKey == "reel" and sort == "added":
        order = "ORDER BY f.added_at DESC, f.tmdb_id ASC"

    rows = await db.query_raw(
        f"""
        WITH f AS ({source})
        SELECT
            f.tmdb_id, f.title, f.poster_path, f.year, f.added_at,
            m.tmdb_vote_average AS rating,
            m.difficulty_level::text AS difficulty_level,
            (
                SELECT COUNT(DISTINCT mlm.lemma_id)
                FROM movie_lemma_mappings mlm
                WHERE mlm.movie_id = m.id
            ) AS word_count
        FROM f
        LEFT JOIN movies m ON m.tmdb_id = f.tmdb_id
        {order}
        LIMIT ${len(params) + 1} OFFSET ${len(params) + 2}
        """,
        *params, take, offset,
    )
    return [
        {
            "tmdb_id": int(r["tmdb_id"]),
            "title": r["title"],
            "poster_path": r["poster_path"],
            "year": r["year"],
            "rating": r["rating"],
            "cefr": DIFFICULTY_TO_CEFR.get((r["difficulty_level"] or "").upper()),
            "word_count": int(r["word_count"]) if r["word_count"] is not None else None,
            "added_at": r["added_at"],
        }
        for r in rows
    ]


async def _word_items(
    db: Prisma, user_id: int, row: Any, *,
    sort: str, take: int, offset: int, now: Optional[datetime] = None,
) -> list[dict]:
    """Word rows joined to their SRS state and lemma metadata.

    A word with no `user_words` row is legitimate — added from Explore before
    it was ever studied — and renders as `new`.
    """
    when = _now(now)
    if row.systemKey == "favourites":
        source = (
            "SELECT word, NULL::int AS lemma_id, created_at AS added_at "
            "FROM user_words "
            "WHERE user_id = $1 AND movie_id IS NULL AND is_learned = false"
        )
        params: list[Any] = [user_id]
        uid_param = "$1"
    else:
        source = (
            "SELECT word, lemma_id, added_at, position "
            "FROM user_list_words WHERE list_id = $1"
        )
        params = [int(row.id)]
        uid_param = "$2"
        params.append(user_id)

    order = _sort_clause("words", sort)
    if row.systemKey == "favourites" and sort == "added":
        order = "ORDER BY w.added_at DESC, w.word ASC"

    rows = await db.query_raw(
        f"""
        WITH w AS ({source}),
        srs AS (
            SELECT LOWER(word) AS lw,
                   MIN(srs_due_at) AS due_at,
                   BOOL_OR(is_learned) AS learned,
                   MAX(srs_box) AS box
            FROM user_words
            WHERE user_id = {uid_param}
            GROUP BY LOWER(word)
        )
        SELECT
            w.word, w.added_at,
            COALESCE(w.lemma_id, l.id) AS lemma_id,
            l.pos,
            l.cefr_level::text AS cefr_level,
            srs.due_at, srs.learned, srs.box
        FROM w
        LEFT JOIN srs ON srs.lw = LOWER(w.word)
        LEFT JOIN lemmas l ON LOWER(l.lemma) = LOWER(w.word)
        {order}
        LIMIT ${len(params) + 1} OFFSET ${len(params) + 2}
        """,
        *params, take, offset,
    )
    return [
        {
            "word": r["word"],
            "lemma_id": r["lemma_id"],
            "pos": r["pos"],
            "cefr": lemma_cefr(r["cefr_level"]),
            "srs_state": _srs_state(r, when),
            "next_review_at": r["due_at"],
            "added_at": r["added_at"],
        }
        for r in rows
    ]


def _srs_state(row: dict, now: datetime) -> str:
    """`new` when the word has no SRS row at all, which is the normal state
    for a word added from Explore and not yet studied."""
    if row.get("learned"):
        return "learned"
    due = row.get("due_at")
    if due is None:
        return "new"
    if isinstance(due, datetime):
        due_at = due if due.tzinfo else due.replace(tzinfo=timezone.utc)
        if due_at <= now:
            return "due"
    box = row.get("box") or 1
    return "learning" if int(box) > 1 else "new"


# Reused from routes/reel.py's mapping — the DB enum predates the CEFR
# convention, so it stores ELEMENTARY/INTERMEDIATE/… rather than A2/B1.
DIFFICULTY_TO_CEFR: dict[str, str] = {
    "BEGINNER":           "A1",
    "ELEMENTARY":         "A2",
    "INTERMEDIATE":       "B1",
    "UPPER_INTERMEDIATE": "B2",
    "ADVANCED":           "C1",
    "PROFICIENT":         "C2",
}

# `lemmas.cefr_level` is the `proficiencylevel` enum, which stores A1..C2
# directly — no mapping needed, unlike `movies.difficulty_level` above. #91
# added an UNKNOWN label to it: a holding pen for words the classifier could
# not place, which must never render as a CEFR pill.
CEFR_CODES: set[str] = {"A1", "A2", "B1", "B2", "C1", "C2"}


def lemma_cefr(raw: str | None) -> Optional[str]:
    """Pass A1..C2 through; drop UNKNOWN and anything unexpected."""
    code = (raw or "").upper()
    return code if code in CEFR_CODES else None


async def create_list(
    db: Prisma, user_id: int, name: str, kind: str,
) -> ListSummary:
    await ensure_system_lists(db, user_id)
    clean = normalize_name(name)
    kind = validate_kind(kind)

    existing = await db.userlist.count(where={"userId": user_id, "kind": kind})
    if existing >= MAX_LISTS_PER_KIND:
        raise ListError(
            "list_limit_reached", 422,
            f"You can have at most {MAX_LISTS_PER_KIND} {kind} lists",
        )

    # Case-insensitive duplicate check. The unique index on lower(name) is the
    # real guard — this pre-check exists to return the friendly code rather
    # than a raw constraint error, and the except below closes the race.
    clash = await db.query_raw(
        "SELECT 1 FROM user_lists WHERE user_id = $1 AND lower(name) = lower($2) LIMIT 1",
        user_id, clean,
    )
    if clash:
        raise ListError("duplicate_name", 409, "You already have a list with that name")

    last = await db.userlist.find_first(
        where={"userId": user_id}, order={"position": "desc"},
    )
    try:
        row = await db.userlist.create(
            data={
                "userId": user_id,
                "name": clean,
                "kind": kind,
                "position": (last.position + 1) if last else 0,
            }
        )
    except Exception as exc:  # noqa: BLE001 — narrowed by the message check
        if "ux_user_lists_user_name" in str(exc):
            raise ListError(
                "duplicate_name", 409, "You already have a list with that name",
            ) from exc
        raise

    empty = {"count": 0, "posters": [], "words": [], "due_count": 0, "total_words": 0}
    return _summary_from(row, empty)


async def rename_list(
    db: Prisma, user_id: int, list_id: int, name: str,
) -> ListSummary:
    row = await _owned_list(db, user_id, list_id)
    if is_system(row):
        raise ListError("system_list", 409, "This list cannot be renamed")
    clean = normalize_name(name)

    clash = await db.query_raw(
        """
        SELECT 1 FROM user_lists
        WHERE user_id = $1 AND lower(name) = lower($2) AND id <> $3
        LIMIT 1
        """,
        user_id, clean, list_id,
    )
    if clash:
        raise ListError("duplicate_name", 409, "You already have a list with that name")

    updated = await db.userlist.update(
        where={"id": list_id}, data={"name": clean},
    )
    stats = await _stats_for_one(db, user_id, updated)
    return _summary_from(updated, stats)


async def delete_list(db: Prisma, user_id: int, list_id: int) -> None:
    """Drops the list and (by cascade) its membership rows. Never touches
    `user_words` SRS state or the reel."""
    row = await _owned_list(db, user_id, list_id)
    if is_system(row):
        raise ListError("system_list", 409, "This list cannot be deleted")
    await db.userlist.delete(where={"id": list_id})


async def _stats_for_one(db: Prisma, user_id: int, row: Any) -> dict:
    if str(row.kind) == "films":
        return (await _film_stats(db, user_id, [row]))[int(row.id)]
    return (await _word_stats(db, user_id, [row]))[int(row.id)]


async def add_items(
    db: Prisma,
    user_id: int,
    list_id: int,
    *,
    films: Optional[list[dict]] = None,
    words: Optional[list[dict]] = None,
) -> ListSummary:
    """Batch add. Idempotent per item — re-adding an existing member is a
    no-op, not a duplicate and not an error, because the client retries on
    a dropped response."""
    row = await _owned_list(db, user_id, list_id)
    kind = str(row.kind)

    if kind == "films" and words:
        raise ListError("list_kind_mismatch", 409, "This list holds films, not words")
    if kind == "words" and films:
        raise ListError("list_kind_mismatch", 409, "This list holds words, not films")

    payload = films if kind == "films" else words
    if not payload:
        return _summary_from(row, await _stats_for_one(db, user_id, row))

    current = (await _stats_for_one(db, user_id, row))["count"]
    if current + len(payload) > max_items_for(kind):
        raise ListError(
            "list_limit_reached", 422,
            f"A {kind} list holds at most {max_items_for(kind)} items",
        )

    if kind == "films":
        await _add_films(db, user_id, row, payload)
    else:
        await _add_words(db, user_id, row, payload)

    if not is_system(row):
        await _touch(db, list_id)
    fresh = await _owned_list(db, user_id, list_id)
    return _summary_from(fresh, await _stats_for_one(db, user_id, fresh))


async def _add_films(db: Prisma, user_id: int, row: Any, films: list[dict]) -> None:
    if row.systemKey == "reel":
        # Adapter: the reel owns its own positions, and `ux_user_reel_movies_
        # user_position` makes them unique, so append past the current max.
        last = await db.userreelmovie.find_first(
            where={"userId": user_id}, order={"position": "desc"},
        )
        next_pos = (last.position + 1) if last else 0
        for film in films:
            await db.execute_raw(
                """
                INSERT INTO user_reel_movies
                    (user_id, tmdb_id, position, title, poster_path, year)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (user_id, tmdb_id) DO NOTHING
                """,
                user_id, film["tmdb_id"], next_pos,
                film["title"], film.get("poster_path"), film.get("year"),
            )
            next_pos += 1
        return

    last = await db.userlistfilm.find_first(
        where={"listId": int(row.id)}, order={"position": "desc"},
    )
    next_pos = (last.position + 1) if last else 0
    for film in films:
        await db.execute_raw(
            """
            INSERT INTO user_list_films
                (list_id, tmdb_id, position, title, poster_path, year)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (list_id, tmdb_id) DO NOTHING
            """,
            int(row.id), film["tmdb_id"], next_pos,
            film["title"], film.get("poster_path"), film.get("year"),
        )
        next_pos += 1


async def _add_words(db: Prisma, user_id: int, row: Any, words: list[dict]) -> None:
    if row.systemKey == "favourites":
        # Adapter: a favourite IS a global user_words row — the same row
        # POST /user-words/save creates.
        #
        # Find-then-create rather than ON CONFLICT, exactly as
        # routes/user_words.py::mark_word_learned does and for the same
        # reason: the only uniqueness backstop on global rows is
        # `user_words_global_word_unique`, a PARTIAL index (movie_id IS NULL)
        # that Prisma cannot express — so it lives in manual SQL, and an
        # environment that has not replayed those files does not have it.
        # Naming it as an ON CONFLICT target therefore fails outright on such
        # a database ("no unique or exclusion constraint matching"). This form
        # works with or without the index, and where the index does exist it
        # still catches the race the find-then-create leaves open.
        for word in words:
            lowered = str(word["word"]).lower()
            existing = await db.userword.find_first(
                where={"userId": user_id, "word": lowered, "movieId": None},
            )
            if existing is not None:
                continue
            try:
                await db.userword.create(data={
                    "userId": user_id,
                    "word": lowered,
                    "isLearned": False,
                })
            except Exception:
                # Lost the race to a concurrent add — the row now exists,
                # which is exactly the idempotent outcome we wanted (§2.4).
                continue
        return

    last = await db.userlistword.find_first(
        where={"listId": int(row.id)}, order={"position": "desc"},
    )
    next_pos = (last.position + 1) if last else 0
    for word in words:
        await db.execute_raw(
            """
            INSERT INTO user_list_words (list_id, word, lemma_id, position)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (list_id, word) DO NOTHING
            """,
            int(row.id), str(word["word"]).lower(), word.get("lemma_id"), next_pos,
        )
        next_pos += 1


async def remove_item(
    db: Prisma, user_id: int, list_id: int, key: int | str,
) -> ListSummary:
    """Idempotent — removing a non-member succeeds. Removal does not renumber
    the remaining positions (ordering tolerates gaps); the reel is the one
    exception, because its unique position index requires contiguity."""
    row = await _owned_list(db, user_id, list_id)
    kind = str(row.kind)

    if kind == "films":
        try:
            tmdb_id = int(key)
        except (TypeError, ValueError):
            raise ListError("invalid_key", 422, "Film key must be a TMDB id")
        if row.systemKey == "reel":
            await db.userreelmovie.delete_many(
                where={"userId": user_id, "tmdbId": tmdb_id},
            )
            await _repack_reel(db, user_id)
        else:
            await db.userlistfilm.delete_many(
                where={"listId": int(row.id), "tmdbId": tmdb_id},
            )
    else:
        word = str(key).lower()
        if row.systemKey == "favourites":
            # Unhearting: drop the global row, exactly as the save toggle does.
            await db.userword.delete_many(
                where={"userId": user_id, "word": word, "movieId": None},
            )
        else:
            await db.userlistword.delete_many(
                where={"listId": int(row.id), "word": word},
            )

    if not is_system(row):
        await _touch(db, list_id)
    fresh = await _owned_list(db, user_id, list_id)
    return _summary_from(fresh, await _stats_for_one(db, user_id, fresh))


async def _repack_reel(db: Prisma, user_id: int) -> None:
    """Keep reel positions contiguous from 0 — mirrors DELETE /reel/{tmdb_id}.
    Required because `ux_user_reel_movies_user_position` is unique."""
    remaining = await db.userreelmovie.find_many(
        where={"userId": user_id}, order={"position": "asc"},
    )
    for new_pos, row in enumerate(remaining):
        if row.position != new_pos:
            await db.userreelmovie.update(
                where={"userId_tmdbId": {"userId": user_id, "tmdbId": row.tmdbId}},
                data={"position": new_pos},
            )


async def reorder_lists(db: Prisma, user_id: int, ordered_ids: list[int]) -> None:
    """Rewrites `user_lists.position` only. Reordering items *inside* a list
    is out of scope (§13). Ids the user doesn't own are ignored rather than
    erroring, so a stale client can't wedge the whole reorder."""
    owned = await db.userlist.find_many(where={"userId": user_id})
    owned_ids = {int(r.id) for r in owned}
    position = 0
    for list_id in ordered_ids:
        if int(list_id) not in owned_ids:
            continue
        await db.userlist.update(
            where={"id": int(list_id)}, data={"position": position},
        )
        position += 1


# ── Practice handoff ───────────────────────────────────────────────────────

async def list_movie_ids(db: Prisma, user_id: int, row: Any) -> list[int]:
    """Internal `movies.id` for every film in a films list, in list order.

    Used by the `list_films` session kind to scope the fresh-lemma pull. TMDB
    ids with no catalogue row are dropped — there is no vocabulary for them.
    """
    if row.systemKey == "reel":
        films = await db.userreelmovie.find_many(
            where={"userId": user_id}, order={"position": "asc"},
        )
        tmdb_ids = [f.tmdbId for f in films]
    else:
        films = await db.userlistfilm.find_many(
            where={"listId": int(row.id)}, order={"position": "asc"},
        )
        tmdb_ids = [f.tmdbId for f in films]
    if not tmdb_ids:
        return []
    movies = await db.movie.find_many(where={"tmdbId": {"in": tmdb_ids}})
    by_tmdb = {m.tmdbId: m.id for m in movies}
    return [by_tmdb[t] for t in tmdb_ids if t in by_tmdb]


async def list_words(db: Prisma, user_id: int, row: Any) -> list[str]:
    """Every word in a words list, in list order. Favourites reads through
    the adapter."""
    if row.systemKey == "favourites":
        rows = await db.userword.find_many(
            where={"userId": user_id, "movieId": None, "isLearned": False},
            order={"createdAt": "desc"},
        )
        return [r.word.lower() for r in rows]
    rows = await db.userlistword.find_many(
        where={"listId": int(row.id)}, order={"position": "asc"},
    )
    return [r.word.lower() for r in rows]
