"""
Vocab-pipeline health & coverage metrics.

Single source of truth for the numbers behind GET /admin/health/vocab-coverage
AND the daily snapshot the sentence worker writes. The endpoint computes them
live; the worker persists one snapshot per day so the trend / regression metrics
(uncovered lemmas should FALL, noop_translations must not RISE) have a baseline
to diff against — a stateless endpoint has nothing to compare with.

All queries use COUNT / EXISTS against indexed columns; none materialise full
tables. The V2 sense tables (word_senses / translation_memory) were dropped
2026-07-21 and are intentionally NOT referenced anywhere here.

Splitting rule: `build_report` is pure (raw counts + previous values -> metric
dicts) so thresholds are unit-testable without a database; the `_gather_raw`
and snapshot helpers own all DB I/O. The metric shape and the ok/warn/fail
bands are shared with the other /admin/health/* reports — see health_metrics.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from prisma import Json, Prisma

from src.config import get_settings

from .health_metrics import (
    FAIL,
    OK,
    WARN,
    metric as _metric,
    overall_status as _overall_status,
    status_max as _status_max,
    status_min as _status_min,
)

logger = logging.getLogger(__name__)

# The reveal cache "climbs from ~0", so a low aligned-gloss share on a tiny
# sample is a rollout artifact, not a regression — don't hard-fail (and drag the
# whole dashboard red) until there's a real sample to judge.
_GLOSS_MIN_SAMPLE = 200


# ── status classifiers (snapshot-relative; the absolute bands live in
# health_metrics, these need a previous value to mean anything) ─────────────

def _status_no_increase(value: float, previous: Optional[float]) -> str:
    """Regression guard: FAIL if the value rose above the last snapshot, WARN
    if any exist at all, else OK. Before a prior snapshot exists a rise can't be
    detected, so a nonzero value is only a WARN."""
    if previous is not None and value > previous:
        return FAIL
    if value > 0:
        return WARN
    return OK


def _status_watch_rise(value: float, previous: Optional[float]) -> str:
    """Informational trend that should hold or fall (uncovered lemmas, dead-end
    movies): WARN if it rose vs the last snapshot, else OK. Never fails."""
    if previous is not None and value > previous:
        return WARN
    return OK


def _status_watch_fall(value: float, previous: Optional[float]) -> str:
    """Informational trend that should hold or climb (reveal-cache rows): WARN
    if it shrank vs the last snapshot, else OK. Never fails."""
    if previous is not None and value < previous:
        return WARN
    return OK


# ── metric assembly (pure) ──────────────────────────────────────────────────

def build_report(
    raw: dict[str, Any],
    previous_values: Optional[dict[str, Any]],
    cap_usd: float,
) -> list[dict]:
    """Classify raw counts into ok/warn/fail metrics. Pure — no DB access.

    `previous_values` maps metric key -> the value from the last snapshot (or
    None on a cold system); used by the trend / no-increase classifiers.
    """
    prev = previous_values or {}
    metrics: list[dict] = []

    # 1. Usage-weighted sentence coverage — % of movie↔lemma mappings whose
    # lemma has ≥1 sentence link (weighted by usage: a lemma in many movies
    # counts many times). Was 93.9% on 2026-07-20.
    total = raw.get("mlm_total", 0)
    covered = raw.get("mlm_covered", 0)
    cov = round(100.0 * covered / total, 2) if total else 0.0
    metrics.append(_metric(
        "usage_weighted_sentence_coverage",
        "Usage-weighted sentence coverage",
        cov, "%",
        _status_min(cov, warn=90.0, fail=80.0),
        "warn <90%, fail <80%",
        prev=prev.get("usage_weighted_sentence_coverage"),
        detail=f"{covered:,} / {total:,} movie–lemma mappings covered",
        warn_at=90.0, fail_at=80.0, direction="min", max_value=100.0,
    ))

    # 2. Uncovered visible lemmas — movie-mapped, not hidden, no sentence link.
    # Trend metric: should FALL as the sentence worker drains. Was 69,316.
    uncovered = raw.get("uncovered_visible_lemmas", 0)
    metrics.append(_metric(
        "uncovered_visible_lemmas",
        "Uncovered visible lemmas",
        uncovered, "lemmas",
        _status_watch_rise(uncovered, prev.get("uncovered_visible_lemmas")),
        "trend — should fall; warn if rising",
        prev=prev.get("uncovered_visible_lemmas"),
        detail="movie-mapped, not hidden, no sentence link",
        direction="max",
    ))

    # 3. A2 registry share — lemmas at A2 / total. Skew flag (issue #91). 81.8%.
    a2 = raw.get("a2", 0)
    lemmas_total = raw.get("lemmas_total", 0)
    a2_share = round(100.0 * a2 / lemmas_total, 2) if lemmas_total else 0.0
    metrics.append(_metric(
        "a2_registry_share",
        "A2 share of lemma registry",
        a2_share, "%",
        _status_max(a2_share, warn=50.0, fail=None),
        "warn >50% (registry skew, issue #91)",
        prev=prev.get("a2_registry_share"),
        detail=f"{a2:,} / {lemmas_total:,} lemmas classified A2",
        warn_at=50.0, direction="max", max_value=100.0,
    ))

    # 3b. UNKNOWN bucket — words the classifier could not place (#91). Not a
    # pass/fail signal: it exists so we can watch WHAT collects here before
    # deciding what to do with it, so it only ever reports "ok". A share that
    # keeps climbing means the classifier is giving up more often, which is
    # the thing worth noticing.
    unknown = raw.get("unknown", 0)
    unknown_share = round(100.0 * unknown / lemmas_total, 2) if lemmas_total else 0.0
    metrics.append(_metric(
        "unknown_registry_share",
        "UNKNOWN share of lemma registry",
        unknown_share, "%",
        "ok",
        "observation only — awaiting a decision on this bucket (issue #91)",
        prev=prev.get("unknown_registry_share"),
        detail=f"{unknown:,} / {lemmas_total:,} lemmas unclassifiable",
        direction="max", max_value=100.0,
    ))

    # 4. Translation cache growth — rows created in the last 7d. >0 = MT caching
    # is alive; 0 means the shared cache stalled. Was 301.
    tc_7d = raw.get("translation_cache_7d", 0)
    metrics.append(_metric(
        "translation_cache_growth",
        "Translation cache growth (7d)",
        tc_7d, "rows",
        _status_min(tc_7d, warn=1.0, fail=None),
        "warn if 0 (caching stalled)",
        prev=prev.get("translation_cache_growth"),
        detail="translation_cache rows created in the last 7 days",
        warn_at=1.0, direction="min",
    ))

    # 5. Reveal cache rows — word_sentence_examples. Should climb from ~0 as
    # reveals happen. Informational; a shrink vs last snapshot is suspicious.
    wse_rows = raw.get("wse_rows", 0)
    metrics.append(_metric(
        "word_sentence_examples_rows",
        "Reveal cache rows",
        wse_rows, "rows",
        _status_watch_fall(wse_rows, prev.get("word_sentence_examples_rows")),
        "informational — should climb; warn if it shrinks",
        prev=prev.get("word_sentence_examples_rows"),
        detail="word_sentence_examples cached reveal rows",
        direction="min",
    ))

    # 5b. Aligned-gloss share of the reveal cache. n/a until rows exist; once
    # they do, a low share means gloss alignment is failing or cost-capped.
    wse_with_gloss = raw.get("wse_with_gloss", 0)
    gloss_pct = round(100.0 * wse_with_gloss / wse_rows, 2) if wse_rows else None
    if gloss_pct is None:
        gloss_status = OK
        gloss_detail = "n/a — no reveals cached yet"
    elif wse_rows < _GLOSS_MIN_SAMPLE:
        # Still ramping — flag a low share as WARN but never FAIL on a tiny
        # sample (old pre-feature rows, or a fresh rollout, legitimately lack it).
        gloss_status = WARN if gloss_pct < 50.0 else OK
        gloss_detail = (
            f"{wse_with_gloss:,} / {wse_rows:,} rows have an aligned word gloss "
            f"(ramping — <{_GLOSS_MIN_SAMPLE} rows)"
        )
    else:
        gloss_status = _status_min(gloss_pct, warn=50.0, fail=20.0)
        gloss_detail = f"{wse_with_gloss:,} / {wse_rows:,} rows have an aligned word gloss"
    metrics.append(_metric(
        "word_sentence_gloss_share",
        "Reveal cache aligned-gloss share",
        gloss_pct, "%",
        gloss_status,
        f"warn <50%, fail <20% (once ≥{_GLOSS_MIN_SAMPLE} rows)",
        prev=prev.get("word_sentence_gloss_share"),
        detail=gloss_detail,
        warn_at=50.0, fail_at=20.0, direction="min", max_value=100.0,
    ))

    # 6. No-op translations — MT returned the source unchanged for a non-EN
    # target (bad passthrough). Must NOT increase. Was 54 TR, now cleaned to 0.
    noop = raw.get("noop_translations", 0)
    metrics.append(_metric(
        "noop_translations",
        "No-op translations",
        noop, "rows",
        _status_no_increase(noop, prev.get("noop_translations")),
        "should be 0; warn if any, fail on increase",
        prev=prev.get("noop_translations"),
        detail="translation_cache rows where source == translated, target != EN",
        warn_at=0.0, direction="max",
    ))

    # 7. Orphan sentences — sentence_bank rows with no lemma link. Was 825→0.
    orphans = raw.get("orphan_sentences", 0)
    metrics.append(_metric(
        "orphan_sentences",
        "Orphan sentences",
        orphans, "rows",
        _status_no_increase(orphans, prev.get("orphan_sentences")),
        "should be 0; warn if any, fail on increase",
        prev=prev.get("orphan_sentences"),
        detail="sentence_bank rows with no sentence_lemma_link",
        warn_at=0.0, direction="max",
    ))

    # 8. Dead-end movies — no script OR no lemma mapping. Trend, was ~170.
    dead_end = raw.get("dead_end_movies", 0)
    metrics.append(_metric(
        "dead_end_movies",
        "Dead-end movies",
        dead_end, "movies",
        _status_watch_rise(dead_end, prev.get("dead_end_movies")),
        "informational — warn if rising",
        prev=prev.get("dead_end_movies"),
        detail="movies with no script or no lemma mapping",
        direction="max",
    ))

    # 9. LLM spend in the last 24h vs the cost cap. Reveals now spend on gloss
    # alignment too, so this can climb even when the sentence worker is idle.
    cost = raw.get("llm_cost_24h", 0.0)
    warn_at = round(0.8 * cap_usd, 2)
    metrics.append(_metric(
        "llm_cost_last_24h",
        "LLM spend (last 24h)",
        round(cost, 4), "$",
        _status_max(cost, warn=warn_at, fail=cap_usd),
        f"warn >${warn_at:g}, fail >${cap_usd:g} (cap)",
        prev=prev.get("llm_cost_last_24h"),
        detail="SUM(estimated_cost_usd) from llm_usage_ledger, last 24h",
        warn_at=warn_at, fail_at=cap_usd, direction="max", max_value=cap_usd,
    ))

    return metrics


# ── DB I/O ──────────────────────────────────────────────────────────────────

async def _gather_raw(db: Prisma) -> dict[str, Any]:
    """Run the efficient COUNT/EXISTS queries. Sequential is fine — this is an
    admin-only / once-daily path, not a hot request."""
    raw: dict[str, Any] = {}

    rows = await db.query_raw(
        """
        SELECT
          (SELECT count(*) FROM movie_lemma_mappings) AS total,
          (SELECT count(*) FROM movie_lemma_mappings mlm
             WHERE EXISTS (SELECT 1 FROM sentence_lemma_links sll
                           WHERE sll.lemma_id = mlm.lemma_id)) AS covered
        """
    )
    raw["mlm_total"] = int(rows[0]["total"])
    raw["mlm_covered"] = int(rows[0]["covered"])

    # Mirrors the sentence worker's "visible" filter (LOWER match against
    # hidden_words) so this tracks the same population the worker drains.
    rows = await db.query_raw(
        """
        SELECT count(*) AS n FROM lemmas l
        WHERE EXISTS (SELECT 1 FROM movie_lemma_mappings mlm WHERE mlm.lemma_id = l.id)
          AND NOT EXISTS (SELECT 1 FROM sentence_lemma_links sll WHERE sll.lemma_id = l.id)
          AND LOWER(l.lemma) NOT IN (SELECT LOWER(word) FROM hidden_words)
        """
    )
    raw["uncovered_visible_lemmas"] = int(rows[0]["n"])

    rows = await db.query_raw(
        "SELECT count(*) FILTER (WHERE cefr_level = 'A2') AS a2, "
        "count(*) FILTER (WHERE cefr_level = 'UNKNOWN') AS unknown, "
        "count(*) AS total FROM lemmas"
    )
    raw["a2"] = int(rows[0]["a2"])
    raw["unknown"] = int(rows[0]["unknown"])
    raw["lemmas_total"] = int(rows[0]["total"])

    rows = await db.query_raw(
        "SELECT count(*) AS n FROM translation_cache WHERE created_at > now() - interval '7 days'"
    )
    raw["translation_cache_7d"] = int(rows[0]["n"])

    rows = await db.query_raw(
        "SELECT count(*) AS rows, count(*) FILTER (WHERE word_translation IS NOT NULL) AS with_gloss "
        "FROM word_sentence_examples"
    )
    raw["wse_rows"] = int(rows[0]["rows"])
    raw["wse_with_gloss"] = int(rows[0]["with_gloss"])

    rows = await db.query_raw(
        "SELECT count(*) AS n FROM translation_cache "
        "WHERE lower(source_text) = lower(translated) AND target_lang <> 'EN'"
    )
    raw["noop_translations"] = int(rows[0]["n"])

    rows = await db.query_raw(
        "SELECT count(*) AS n FROM sentence_bank sb "
        "WHERE NOT EXISTS (SELECT 1 FROM sentence_lemma_links sll WHERE sll.sentence_id = sb.id)"
    )
    raw["orphan_sentences"] = int(rows[0]["n"])

    rows = await db.query_raw(
        """
        SELECT count(*) FILTER (
          WHERE NOT EXISTS (SELECT 1 FROM movie_scripts ms WHERE ms.movie_id = m.id)
             OR NOT EXISTS (SELECT 1 FROM movie_lemma_mappings mlm WHERE mlm.movie_id = m.id)
        ) AS n
        FROM movies m
        """
    )
    raw["dead_end_movies"] = int(rows[0]["n"])

    rows = await db.query_raw(
        "SELECT COALESCE(SUM(estimated_cost_usd), 0)::float AS cost "
        "FROM llm_usage_ledger WHERE ts > now() - interval '24 hours'"
    )
    raw["llm_cost_24h"] = float(rows[0]["cost"])

    return raw


async def _latest_snapshot(db: Prisma) -> Optional[dict]:
    snap = await db.vocabcoveragesnapshot.find_first(order={"capturedAt": "desc"})
    if snap is None:
        return None
    data = snap.metrics
    values: dict[str, Any] = {}
    metric_list = data.get("metrics") if isinstance(data, dict) else None
    if isinstance(metric_list, list):
        for m in metric_list:
            if isinstance(m, dict) and "key" in m:
                values[m["key"]] = m.get("value")
    return {"captured_at": snap.capturedAt, "values": values}


async def compute_vocab_coverage(db: Prisma) -> dict:
    """Live report: gather counts, diff against the last snapshot, classify."""
    raw = await _gather_raw(db)
    prev = await _latest_snapshot(db)
    cap = get_settings().llm_cost_cap_usd
    metrics = build_report(raw, prev["values"] if prev else None, cap)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "overall_status": _overall_status(metrics),
        "previous_snapshot_at": prev["captured_at"].isoformat() if prev else None,
        "llm_cost_cap_usd": cap,
        "metrics": metrics,
    }


async def write_snapshot(db: Prisma) -> dict:
    """Compute the report and persist it as a snapshot row. Returns the report."""
    report = await compute_vocab_coverage(db)
    await db.vocabcoveragesnapshot.create(data={"metrics": Json(report)})
    return report


async def maybe_write_daily_snapshot(db: Prisma, min_interval_hours: float = 24.0) -> bool:
    """Write a snapshot only if the newest one is older than min_interval_hours
    (or none exists). Called from the sentence worker loop — cheap enough to run
    every cycle since it short-circuits on a single indexed lookup."""
    latest = await db.vocabcoveragesnapshot.find_first(order={"capturedAt": "desc"})
    if latest is not None:
        age = datetime.now(timezone.utc) - latest.capturedAt
        if age.total_seconds() < min_interval_hours * 3600:
            return False
    await write_snapshot(db)
    logger.info("[vocab-coverage] wrote daily coverage snapshot")
    return True
