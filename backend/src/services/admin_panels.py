"""
Per-page data for the admin dashboard.

The admin screen used to be one page backed by one endpoint, `/admin/stats`,
which answered every question on it. Opening admin therefore paid for every
question at once, including the two expensive ones — measured on prod
2026-09-05 from the access log, `GET /admin/stats` p95 **5,487 ms** and
`GET /admin/health/vocab-coverage` p95 **4,934 ms**, against <200 ms for every
other route the app calls. Both showed up as warnings on the dashboard's own
latency report, which is a fair description of a screen you wait five seconds
for.

This module splits that one answer into the panels the screen is now made of —
films, words, users, workers — so a question is only asked when someone
navigates to the page that shows it. That is the structural half of the fix.
The other half is that no panel here is allowed to be slow:

* **`lemmas` is the registry, `word_classifications` is not.** The old
  words-by-level query was `COUNT(DISTINCT lemma) ... FROM word_classifications
  GROUP BY cefr_level` — millions of per-script rows, one per (script, word) —
  to answer a question the commit that added it phrased as "how much of the
  registry sits in each band". The registry is `lemmas`: one row per lemma,
  the table `apply_registry_levels` corrects and the table every other report
  already counts from (`a2_registry_share` in vocab_coverage reads it). Same
  question, two orders of magnitude fewer rows, and the two admin screens can
  no longer disagree about the same number.

* **One round trip per panel.** Several `count(*) FILTER (...)` aggregates over
  one scan, rather than a sequential `count()` per figure. `/admin/stats` made
  six round trips in series.

* **Nothing here counts a multi-million-row table.** Not for speed alone: a
  parallel plan on Railway asks for a shared-memory segment that the container
  cannot always give it, which is how the daily coverage snapshot died silently
  for five days (#154). The panels that legitimately need those counts —
  coverage, sentence backlog — read them from the daily snapshot instead of
  recomputing them per page view.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from prisma import Prisma

from .movie_cefr import CEFR_LEVELS, cefr_from_score

logger = logging.getLogger(__name__)

# The registry's own bands. Six CEFR levels plus the holding pen for words the
# classifier could not place (#91) — kept here, unlike on learner surfaces,
# because "how much have we failed to grade" is the point of this screen.
REGISTRY_LEVELS = [*CEFR_LEVELS, "UNKNOWN"]


async def _rows(db: Prisma, sql: str, *args) -> list[dict]:
    """query_raw that degrades to empty instead of failing a whole panel.

    The worker tables (`movie_jobs`, `api_events`, `rate_state`) are created by
    the worker's own bootstrap, not by Prisma, so on an environment where the
    worker subsystem has never run they simply do not exist. That is a missing
    panel row, not a broken admin screen.
    """
    try:
        return await db.query_raw(sql, *args)
    except Exception as e:  # noqa: BLE001 - any DB error degrades the same way
        logger.debug(f"[admin-panels] query failed, degrading: {e}")
        return []


def _first(rows: list[dict]) -> dict:
    return rows[0] if rows else {}


def _int(value: Any, default: int = 0) -> int:
    return int(value) if value is not None else default


# ── films ───────────────────────────────────────────────────────────────────

async def films_panel(db: Prisma) -> dict:
    """The catalogue: how many films exist, how many are usable, and how the
    graded ones spread across the six bands.

    "Processed" means the film has a preprocessed script row. A film with a
    TMDB record and no script is in the catalogue but cannot be read, so the
    two numbers are deliberately separate — the gap is the ingestion backlog.

    The band is banded off `difficulty_score` in Python rather than read from a
    stored enum (#103), which is what stops this screen and the learner-facing
    shelves drifting apart.
    """
    counts = _first(await _rows(
        db,
        """
        SELECT
          (SELECT count(*)::int FROM movies) AS total,
          (SELECT count(*)::int FROM movie_scripts WHERE is_preprocessed = true) AS processed,
          (SELECT count(*)::int FROM movies WHERE difficulty_score IS NOT NULL) AS scored
        """,
    ))

    score_rows = await _rows(
        db,
        "SELECT difficulty_score AS score, count(*)::int AS n "
        "FROM movies WHERE difficulty_score IS NOT NULL GROUP BY difficulty_score",
    )
    by_level = {lvl: 0 for lvl in CEFR_LEVELS}
    for r in score_rows:
        level = cefr_from_score(r["score"])
        if level is not None:
            by_level[level] += r["n"]

    total = _int(counts.get("total"))
    processed = _int(counts.get("processed"))
    return {
        "movies_total": total,
        "movies_processed": processed,
        "movies_scored": _int(counts.get("scored")),
        # What is left to ingest, stated rather than left as a subtraction the
        # reader has to do while looking at two tiles.
        "movies_unprocessed": max(total - processed, 0),
        "movies_by_level": by_level,
    }


# ── words ───────────────────────────────────────────────────────────────────

async def words_panel(db: Prisma) -> dict:
    """The vocabulary registry: how many words we know, how they are graded,
    and how far the definition worker has got through them.

    One scan of `lemmas` answers all of it. The level split reads the enum with
    `count(*) FILTER (WHERE cefr_level = '...')` rather than `GROUP BY
    cefr_level::text`, because casting this particular enum to text is what
    turned a fast plan into a slow one in #118 — a trap worth not stepping in
    twice for a value that is a fixed, six-item list anyway.
    """
    level_filters = ", ".join(
        f"count(*) FILTER (WHERE cefr_level = '{lvl}')::int AS lvl_{lvl.lower()}"
        for lvl in REGISTRY_LEVELS
    )
    row = _first(await _rows(
        db,
        f"""
        SELECT
          count(*)::int AS total,
          {level_filters},
          count(*) FILTER (WHERE definition IS NOT NULL AND definition <> '')::int AS defined,
          count(*) FILTER (WHERE definition_skip_version IS NOT NULL)::int AS definition_skipped,
          count(*) FILTER (WHERE sentence_skip_version IS NOT NULL)::int AS sentence_skipped,
          count(*) FILTER (WHERE is_multi_word)::int AS multi_word,
          count(*) FILTER (WHERE frequency_rank IS NOT NULL)::int AS ranked
        FROM lemmas
        """,
    ))

    hidden = _first(await _rows(db, "SELECT count(*)::int AS n FROM hidden_words"))

    total = _int(row.get("total"))
    defined = _int(row.get("defined"))
    return {
        "lemmas_total": total,
        "words_by_level": {lvl: _int(row.get(f"lvl_{lvl.lower()}")) for lvl in REGISTRY_LEVELS},
        "definitions_written": defined,
        "definitions_missing": max(total - defined, 0),
        "definitions_skipped": _int(row.get("definition_skipped")),
        "sentences_skipped": _int(row.get("sentence_skipped")),
        "multi_word": _int(row.get("multi_word")),
        "frequency_ranked": _int(row.get("ranked")),
        "hidden_words": _int(hidden.get("n")),
    }


# ── users ───────────────────────────────────────────────────────────────────

async def users_panel(db: Prisma) -> dict:
    """Who has an account, what they are paying, and whether they came back.

    Signups and activity are counted over rolling windows rather than reported
    as an all-time total, because an all-time total on a pre-launch product is
    the same number every day and says nothing about whether anything changed.
    """
    row = _first(await _rows(
        db,
        """
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE is_admin)::int AS admins,
          count(*) FILTER (WHERE is_active)::int AS active_accounts,
          count(*) FILTER (WHERE subscription_tier = 'premium')::int AS premium,
          count(*) FILTER (WHERE subscription_tier = 'trial')::int AS trial,
          count(*) FILTER (WHERE subscription_tier = 'comped')::int AS comped,
          count(*) FILTER (WHERE subscription_tier = 'free' OR subscription_tier IS NULL)::int AS free,
          count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS signups_7d,
          count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS signups_30d,
          count(*) FILTER (WHERE srs_last_session_date > (now() - interval '7 days')::date)::int AS studied_7d,
          count(*) FILTER (WHERE srs_last_session_date > (now() - interval '30 days')::date)::int AS studied_30d,
          count(*) FILTER (WHERE onboarding_completed_at IS NOT NULL)::int AS onboarded
        FROM users
        """,
    ))

    saved = _first(await _rows(
        db,
        "SELECT count(*)::int AS words, count(DISTINCT user_id)::int AS savers FROM user_words",
    ))

    return {
        "users_total": _int(row.get("total")),
        "admins": _int(row.get("admins")),
        "active_accounts": _int(row.get("active_accounts")),
        "premium": _int(row.get("premium")),
        "trial": _int(row.get("trial")),
        "comped": _int(row.get("comped")),
        "free": _int(row.get("free")),
        "signups_7d": _int(row.get("signups_7d")),
        "signups_30d": _int(row.get("signups_30d")),
        "studied_7d": _int(row.get("studied_7d")),
        "studied_30d": _int(row.get("studied_30d")),
        "onboarded": _int(row.get("onboarded")),
        "saved_words": _int(saved.get("words")),
        "users_with_saved_words": _int(saved.get("savers")),
    }


# ── workers ─────────────────────────────────────────────────────────────────

# The four background processes, in the order the pipeline runs them. `id` is
# the key the mobile app looks its copy up by; everything user-facing (what the
# worker is, why it matters, what "healthy" looks like) lives in the app so it
# can be edited without a deploy of the API.
WORKER_IDS = ["job", "sentence", "definition", "translation"]

# How recently a worker must have done something to count as awake. Long enough
# to survive an idle queue and a slow cycle, short enough that a wedged process
# shows up the same day.
_ACTIVE_WINDOW_HOURS = 24


async def workers_panel(db: Prisma) -> dict:
    """What each background worker has been doing, and whether it is awake.

    Deliberately built from *recent activity* rather than lifetime totals. A
    lifetime count cannot distinguish a worker that finished its backlog from
    one that died three weeks ago holding a full queue — which is exactly the
    confusion that let the sentence worker sit wedged for five days (#154) and
    the movie seed report "0 new jobs" on every restart for months.

    Every figure here is either an indexed range scan over a pruned table
    (`api_events`, `llm_usage_ledger`) or a count over a few thousand rows
    (`movie_jobs`, `lemmas`). Nothing scans `sentence_bank` or
    `word_classifications` — see the module docstring.
    """
    queue = {r["status"]: _int(r["n"]) for r in await _rows(
        db, "SELECT status, count(*)::int AS n FROM movie_jobs GROUP BY status"
    )}

    job_times = _first(await _rows(
        db,
        """
        SELECT
          max(finished_at) FILTER (WHERE status = 'done')   AS last_done_at,
          max(created_at)                                    AS last_queued_at,
          min(run_after)  FILTER (WHERE status = 'pending') AS next_run_at,
          count(*) FILTER (WHERE status = 'done'
                             AND finished_at > now() - interval '24 hours')::int AS done_24h
        FROM movie_jobs
        """,
    ))

    # Spend and call volume per worker, keyed by the `context` each one writes
    # to the ledger. This is the number that answers "is a worker looping and
    # burning money", which no queue count can.
    spend = {
        r["context"]: {
            "calls": _int(r.get("calls")),
            "cost_usd": round(float(r.get("cost") or 0.0), 4),
            "last_at": r.get("last_at"),
        }
        for r in await _rows(
            db,
            """
            SELECT context,
                   count(*)::int AS calls,
                   COALESCE(SUM(estimated_cost_usd), 0)::float AS cost,
                   max(ts) AS last_at
              FROM llm_usage_ledger
             WHERE ts > now() - interval '24 hours'
             GROUP BY context
            """,
        )
    }
    # The last call of all time per context, so a worker that has been idle for
    # a week still reports *when* it went quiet rather than just "no activity".
    last_seen = {
        r["context"]: r.get("last_at")
        for r in await _rows(
            db, "SELECT context, max(ts) AS last_at FROM llm_usage_ledger GROUP BY context"
        )
    }

    lemma_row = _first(await _rows(
        db,
        """
        SELECT
          count(*) FILTER (WHERE definition IS NULL OR definition = '')::int AS undefined,
          count(*) FILTER (WHERE (definition IS NULL OR definition = '')
                             AND definition_skip_version IS NULL)::int AS definition_backlog,
          count(*) FILTER (WHERE sentence_skip_version IS NOT NULL)::int AS sentence_skipped
        FROM lemmas
        """,
    ))

    # The script fetcher's own upstream health, straight off the AIMD
    # controller's event table. It is pruned by the controller, so this is a
    # small, indexed range scan.
    api = _first(await _rows(
        db,
        """
        SELECT count(*)::int AS n,
               count(*) FILTER (WHERE NOT success)::int AS failures,
               COALESCE(percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms), 0)::int AS p95_ms
          FROM api_events
         WHERE occurred_at > now() - interval '1 hour'
        """,
    ))
    rate = _first(await _rows(db, "SELECT target_qps, max_qps FROM rate_state LIMIT 1"))

    return {
        "queue": {
            "done": queue.get("done", 0),
            "pending": queue.get("pending", 0),
            "running": queue.get("running", 0),
            "failed": queue.get("failed", 0),
            "dead": queue.get("dead", 0),
            "done_24h": _int(job_times.get("done_24h")),
            "last_done_at": _iso(job_times.get("last_done_at")),
            "last_queued_at": _iso(job_times.get("last_queued_at")),
            "next_run_at": _iso(job_times.get("next_run_at")),
        },
        "fetcher": {
            "events_1h": _int(api.get("n")),
            "failures_1h": _int(api.get("failures")),
            "p95_ms": _int(api.get("p95_ms")),
            "target_qps": float(rate["target_qps"]) if rate.get("target_qps") is not None else None,
            "max_qps": float(rate["max_qps"]) if rate.get("max_qps") is not None else None,
        },
        "llm_24h": {
            k: {**v, "last_at": _iso(v["last_at"])} for k, v in spend.items()
        },
        "llm_last_seen": {k: _iso(v) for k, v in last_seen.items()},
        "backlog": {
            "definitions_missing": _int(lemma_row.get("undefined")),
            "definitions_retryable": _int(lemma_row.get("definition_backlog")),
            "sentences_skipped": _int(lemma_row.get("sentence_skipped")),
        },
        "active_window_hours": _ACTIVE_WINDOW_HOURS,
    }


def _iso(value: Any) -> Optional[str]:
    """Timestamps come back as datetimes from Prisma and as strings from the
    test doubles; both must serialise the same way."""
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)
