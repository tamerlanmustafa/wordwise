"""
Per-(user, movie) progress: status badge, comprehensibility %, mastery counts.

The pure helpers (`classify_status`, `compute_comprehensibility_percent`)
make threshold tuning unit-testable. `recompute_for_user_movie` is the
single async entry point — call it after any flow that changes a user's
SRS state on a word that belongs to a movie.

Status thresholds:
  • Unstudied: lemmas_in_box_2_plus / total_lemmas  < STUDIED_THRESHOLD
  • Studied:   ≥ STUDIED_THRESHOLD  in box 2+
  • Mastered:  ≥ MASTERED_THRESHOLD in box 5 (graduated)

Comprehensibility is frequency-weighted via MovieLemmaMapping.frequency_in_movie
— a single high-frequency word counts more than ten rare ones — and aggregates
across movies (a word the user mastered in any movie counts as known when
computing a different movie's percent). Both choices are deliberate; see
docs/SRS_HABIT_ENGINE_PLAN.md.
"""
from __future__ import annotations

from typing import Literal, Optional

from prisma import Prisma

# Tunable thresholds. % expressed as 0..1 fractions.
STUDIED_THRESHOLD: float = 0.30
MASTERED_THRESHOLD: float = 0.80

# The SRS box at which a word is considered "graduated" — used in the
# `lemmas_mastered` count and the Mastered threshold check.
MASTERED_BOX: int = 5

# The SRS box at which a word is considered "in the user's vocabulary"
# for the purpose of comprehensibility (frequency-weighted) and the
# Studied threshold. Must be > 1 so a single failed review doesn't
# count as known.
IN_VOCAB_BOX: int = 2

MovieStudyStatus = Literal["unstudied", "studied", "mastered"]


def classify_status(
    lemmas_in_box_2_plus: int,
    lemmas_mastered: int,
    total_lemmas: int,
    *,
    studied_threshold: float = STUDIED_THRESHOLD,
    mastered_threshold: float = MASTERED_THRESHOLD,
) -> MovieStudyStatus:
    """Pure status classifier from raw counts.

    A movie with zero known lemmas is `unstudied`; a movie with no lemma
    data at all is also `unstudied` (defensive — we never raise).
    """
    if total_lemmas <= 0:
        return "unstudied"
    mastered_frac = lemmas_mastered / total_lemmas
    if mastered_frac >= mastered_threshold:
        return "mastered"
    in_vocab_frac = lemmas_in_box_2_plus / total_lemmas
    if in_vocab_frac >= studied_threshold:
        return "studied"
    return "unstudied"


def compute_comprehensibility_percent(
    freq_known: float,
    total_freq: float,
) -> float:
    """Frequency-weighted % of the movie the user can follow.

    Returns 0..100 (matches the storage shape and what the client renders).
    `total_freq <= 0` → 0; rare for any real movie but possible when
    MovieLemmaMapping data is incomplete.
    """
    if total_freq <= 0:
        return 0.0
    pct = (freq_known / total_freq) * 100.0
    # Clamp defensively. Counts > total can happen if a movie's lemma list
    # contains duplicates that we're double-counting upstream.
    return max(0.0, min(100.0, pct))


# ── DB-touching ─────────────────────────────────────────────────────────────

async def recompute_for_user_movie(
    db: Prisma,
    *,
    user_id: int,
    movie_id: int,
) -> Optional[dict]:
    """Recompute and upsert the progress row for one (user, movie).

    Returns a dict snapshot of the new row, or None when the movie has no
    lemma mappings (we don't create empty progress rows). Single round-trip
    aggregate query — safe to call from completion hooks without batching.
    """
    rows = await db.query_raw(
        """
        WITH movie_lemmas AS (
          SELECT mlm.lemma_id, l.lemma, mlm.frequency_in_movie
          FROM movie_lemma_mappings mlm
          JOIN lemmas l ON l.id = mlm.lemma_id
          WHERE mlm.movie_id = $1
        ),
        user_word_max_box AS (
          -- A user knows a word once they've reached srsBox >= 2 on ANY
          -- of their UserWord rows for that lemma (regardless of which
          -- movie attributed it). Take the max box per lemma.
          SELECT LOWER(uw.word) AS word, MAX(uw.srs_box) AS max_box
          FROM user_words uw
          WHERE uw.user_id = $2
          GROUP BY LOWER(uw.word)
        )
        SELECT
          COUNT(ml.lemma_id)                                                AS total_lemmas,
          COALESCE(SUM(ml.frequency_in_movie), 0)                           AS total_freq,
          COUNT(uw.word)                                                    AS lemmas_touched,
          COUNT(*) FILTER (WHERE uw.max_box >= $3)                          AS lemmas_in_box_2_plus,
          COUNT(*) FILTER (WHERE uw.max_box >= $4)                          AS lemmas_mastered,
          COALESCE(
            SUM(ml.frequency_in_movie) FILTER (WHERE uw.max_box >= $3),
            0
          )                                                                 AS freq_known
        FROM movie_lemmas ml
        LEFT JOIN user_word_max_box uw ON LOWER(ml.lemma) = uw.word
        """,
        movie_id, user_id, IN_VOCAB_BOX, MASTERED_BOX,
    )
    if not rows:
        return None
    r = rows[0]
    total_lemmas = int(r["total_lemmas"] or 0)
    if total_lemmas == 0:
        # Movie has no lemma data — skip the upsert. Avoids 0/0 noise on
        # the reel and keeps the table clean.
        return None

    total_freq = float(r["total_freq"] or 0)
    freq_known = float(r["freq_known"] or 0)
    lemmas_touched = int(r["lemmas_touched"] or 0)
    lemmas_in_box_2_plus = int(r["lemmas_in_box_2_plus"] or 0)
    lemmas_mastered = int(r["lemmas_mastered"] or 0)

    comprehensibility = compute_comprehensibility_percent(freq_known, total_freq)
    status = classify_status(lemmas_in_box_2_plus, lemmas_mastered, total_lemmas)

    await db.usermovieprogress.upsert(
        where={"userId_movieId": {"userId": user_id, "movieId": movie_id}},
        data={
            "create": {
                "userId": user_id,
                "movieId": movie_id,
                "lemmasTouched": lemmas_touched,
                "lemmasInBox2Plus": lemmas_in_box_2_plus,
                "lemmasMastered": lemmas_mastered,
                "comprehensibilityPercent": comprehensibility,
                "status": status,
            },
            "update": {
                "lemmasTouched": lemmas_touched,
                "lemmasInBox2Plus": lemmas_in_box_2_plus,
                "lemmasMastered": lemmas_mastered,
                "comprehensibilityPercent": comprehensibility,
                "status": status,
            },
        },
    )

    return {
        "user_id": user_id,
        "movie_id": movie_id,
        "lemmas_touched": lemmas_touched,
        "lemmas_in_box_2_plus": lemmas_in_box_2_plus,
        "lemmas_mastered": lemmas_mastered,
        "comprehensibility_percent": comprehensibility,
        "status": status,
    }
