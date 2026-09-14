"""Un-saving a word without throwing away what the user learned.

## The bug this exists to prevent

A saved word is a `user_words` row — and the SAME row carries the word's
spaced-repetition state: `srs_box`, `srs_due_at`, `srs_last_reviewed_at`. Two
facts with two different lifetimes share one row:

  • "I chose to keep this word" — flips freely, one heart tap at a time.
  • "how well I know it"         — accumulates over weeks of reviews.

Un-hearting used to `DELETE` the row, which undid the first by destroying the
second. Measured against the local database: a word at box 2, last reviewed
on 8 September, went to box 1 with no review history after one un-heart and one
re-heart — a mis-tap and its correction. Nothing warned, and the word also
left the Practice deck it had been in.

Both hearts did it: the Favourites list (`services/lists.py::remove_item`) and
the word feed's save toggle (`routes/user_words.py::save_word`). One helper, so
the two cannot drift apart again.

## What happens instead

A row with progress is **demoted, not deleted**: its `source` becomes
`'practice'`. That is the exact inverse of the promotion both save paths
already perform (`source 'practice' → NULL` when a user hearts a word Practice
introduced), which is what makes it safe without a schema change:

  • every "is this saved" reader already excludes `source = 'practice'`
    (`user_owned_where_fragment`, `FAVOURITES_SOURCE_SQL`), so the word leaves
    Favourites and the heart reads empty, exactly as before;
  • hearting it again takes the existing promote path and the progress is
    simply still there;
  • Practice's recall slice reads every due row regardless of source, so a word
    the user was learning stays in review. Un-hearting takes a word out of a
    collection; it was never a request to forget it.

A row with no progress is deleted as before — there is nothing on it to lose,
and keeping it would only accumulate dead rows.

Learned markers (`is_learned = true`, "never show me this again") are a
different concept and are not touched here.
"""

from __future__ import annotations

from typing import Any, Iterable

from prisma import Prisma

from .session_kinds import PRACTICE_SOURCE


def has_progress(row: Any) -> bool:
    """Whether a row carries learning worth keeping.

    `srs_last_reviewed_at` is the real signal — it is only ever written by a
    review. `srs_box > 1` is belt-and-braces for a row whose box was moved
    without a timestamp, which should not happen but costs nothing to honour.
    """
    if getattr(row, "srsLastReviewedAt", None) is not None:
        return True
    return int(getattr(row, "srsBox", 1) or 1) > 1


async def release_saved_rows(db: Prisma, rows: Iterable[Any]) -> None:
    """Stop treating these rows as saved, keeping any learning on them.

    Takes rows rather than querying for them, so each caller keeps its own
    idea of which rows a "heart" refers to (the global row, or one film's) and
    this function owns only the decision about what un-saving means.
    """
    for row in rows:
        if getattr(row, "isLearned", False):
            # Not a save. Callers should not pass these; refuse rather than
            # guess, because deleting a learned marker silently un-hides a word
            # the user asked never to see again.
            continue
        if has_progress(row):
            if getattr(row, "source", None) != PRACTICE_SOURCE:
                await db.userword.update(
                    where={"id": row.id},
                    data={"source": PRACTICE_SOURCE},
                )
            # Already a Practice row with progress: nothing to do, and above
            # all nothing to delete.
            continue
        await db.userword.delete(where={"id": row.id})
