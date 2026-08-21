"""
Read-time lookup of admin-hidden words (misspellings, profanity, garbage
lemmas — see hide_*_lemmas.py and routes/admin.py for the write side).

`hidden_words` is not the small curation table its name suggests: it holds
~34k rows in prod and grows with every backfill. So the only safe way to ask
"which of these forms are hidden?" is to let Postgres do the intersection.
Loading the table to answer a few thousand membership tests costs >100ms and,
worse, builds ~34k Prisma model objects on the event loop — blocking every
other request in the process, not just the caller's.

This lives in services/ rather than in a route module because six call sites
across movies, quiz, and books need it (issue #121); it started as a private
helper in routes/movies.py and only three of those sites ever got it.
"""
from __future__ import annotations

from typing import Iterable, Optional, Protocol, Set

# Both sides of the comparison are lowercased, so this is backed by the
# functional index ix_hidden_words_word_lower rather than ix_hidden_words_word
# (a plain btree on `word` cannot serve a LOWER(word) predicate — without the
# functional index this scans all ~34k rows). See
# prisma/manual/2026_08_18_hidden_words_lower_index_issue_121.sql.
_SCOPED_LOOKUP_SQL = (
    "SELECT LOWER(word) AS word FROM hidden_words "
    "WHERE LOWER(word) = ANY($1::text[])"
)


def hidden_word_exclusion_sql(lemma_expr: str) -> str:
    """
    A WHERE-clause fragment reading "`lemma_expr` is not admin-hidden",
    matched case-insensitively.

    For callers that filter a *table* of candidates in SQL rather than a known
    list of forms (get_hidden_word_set is for the latter). The correlated
    NOT EXISTS is deliberate: `LOWER(x) NOT IN (SELECT LOWER(word) FROM
    hidden_words)` has to materialise every one of the ~34k rows to build its
    hash, so no index can help it — it is a full read of the table on every
    execution. As a per-row probe of ix_hidden_words_word_lower the planner
    instead applies it last, against the handful of rows that survived the
    other filters (issue #129: 34,095 rows read per sentence-worker cycle → a
    few hundred index lookups).

    `lemma_expr` is a column expression written by the caller, never user
    input — it is interpolated, not bound.
    """
    return (
        "NOT EXISTS (SELECT 1 FROM hidden_words hw "
        f"WHERE LOWER(hw.word) = LOWER({lemma_expr}))"
    )


class _SupportsQueryRaw(Protocol):
    async def query_raw(self, sql: str, *args): ...


async def get_hidden_word_set(
    db: _SupportsQueryRaw, forms: Iterable[Optional[str]]
) -> Set[str]:
    """
    The subset of `forms` that admins have hidden, lowercased.

    Scoped to the caller's candidate forms rather than loading the table:
    Postgres returns only the rows that actually matter (~150 for a large
    script) instead of all ~34k.

    Candidates are passed as a single text[] parameter, not one placeholder
    per form, so a long vocabulary can never approach the bind-parameter
    limit — a script reaches ~4,700 distinct forms.

    Both sides are lowercased here, so the returned set is lowercase and
    callers must compare lowercased forms. Callers that lowercase only their
    own side silently fail to hide a word stored with capitals.
    """
    candidates = sorted({f.strip().lower() for f in forms if f and f.strip()})
    if not candidates:
        return set()
    rows = await db.query_raw(_SCOPED_LOOKUP_SQL, candidates)
    return {r["word"] for r in rows}
