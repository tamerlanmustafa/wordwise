"""
Translation-cache coverage and quality report (issue #124).

Answers the two questions warming raises that nothing else can:

  1. **Is it working?** How much of each language's hot set is actually
     cached. Coverage is the metric that decides whether a user's first card
     is instant or waits on a live provider round trip, and it moves only when
     the warmer runs — so a flat number here means the worker is wedged.

  2. **What is it made of?** Which provider produced those rows. Warming uses
     DeepL until its monthly characters run out and Google after that, and the
     two differ in quality on the languages DeepL supports. A language sitting
     at a high Google share is one whose cards read worse than they should and
     is the candidate to re-warm once DeepL's allowance resets.

Shares the metric shape and status bands with the other /admin/health/*
reports — see health_metrics.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from .health_metrics import metric as _metric
from .health_metrics import overall_status as _overall_status
from .health_metrics import status_max as _status_max
from .health_metrics import status_min as _status_min
from .translation_warming import CEFR_LEVELS, DEFAULT_POOL_LIMIT, build_tier_sql

logger = logging.getLogger(__name__)

# Google Cloud Translation's recurring monthly free allowance. Mirrored from
# the warm worker; both read the same number for the same reason.
GOOGLE_FREE_CHARS_PER_MONTH = 500_000


def _hot_set_size_sql(pool_limit: int) -> str:
    """Rows in the hot set — the denominator every coverage % divides by.

    Deliberately rebuilt from `build_tier_sql` rather than hardcoded: if the
    pool definition drifts, the report must move with it, or it will cheerfully
    certify 100% coverage of a set the feed no longer draws from.
    """
    return f"""
        SELECT count(*) AS n FROM (
            {build_tier_sql("pool_lemmas", pool_limit)}
        ) q
        UNION ALL
        SELECT count(*) AS n FROM (
            {build_tier_sql("pool_sentences", pool_limit)}
        ) q2
    """


CACHE_BY_LANG_SQL = """
    SELECT target_lang,
           count(*)                                              AS total,
           count(*) FILTER (WHERE provider = 'deepl')            AS deepl,
           count(*) FILTER (WHERE provider = 'google')           AS google,
           count(*) FILTER (WHERE provider IS NULL)              AS untracked,
           max(created_at)                                       AS last_written
    FROM translation_cache
    GROUP BY target_lang
    ORDER BY total DESC
"""

GOOGLE_MONTH_SPEND_SQL = """
    SELECT COALESCE(SUM(LENGTH(source_text)), 0) AS chars
    FROM translation_cache
    WHERE provider = 'google'
      AND created_at >= date_trunc('month', now())
"""


async def _hot_set_size(db, pool_limit: int) -> int:
    rows = await db.query_raw(_hot_set_size_sql(pool_limit))
    return sum(int(r["n"]) for r in rows)


def build_report(
    hot_set_size: int,
    per_lang: list[dict],
    langs_expected: list[str],
    deepl_usage: Optional[dict],
    google_spent: int,
) -> list[dict]:
    """Classify raw counts into ok/warn/fail metrics. Pure — no DB access."""
    metrics: list[dict] = []
    by_lang = {r["target_lang"].upper(): r for r in per_lang}

    # 1. Per-language hot-set coverage. The headline: below ~90% a meaningful
    # share of cards still reach for a live provider call.
    for lang in langs_expected:
        row = by_lang.get(lang)
        cached = int(row["total"]) if row else 0
        # Cached rows can exceed the hot set (tail words warmed earlier, or
        # words users looked up), so cap the ratio — this measures coverage of
        # the hot set, not cache size.
        pct = round(100.0 * min(cached, hot_set_size) / hot_set_size, 2) if hot_set_size else 0.0
        google = int(row["google"]) if row else 0
        detail = None
        if cached:
            detail = f"{cached:,} rows cached; {google:,} from Google"
        metrics.append(_metric(
            f"hot_set_coverage_{lang.lower()}",
            f"Hot-set coverage — {lang}",
            pct, "%",
            _status_min(pct, warn=90.0, fail=50.0),
            "warn <90%, fail <50%",
            detail=detail,
            warn_at=90.0, fail_at=50.0, direction="min", max_value=100.0,
        ))

    # 2. Google share across all languages. Not a failure — it is the price of
    # warming faster than DeepL's allowance permits — but it is the quality
    # debt, and it should be visible rather than inferred.
    total_rows = sum(int(r["total"]) for r in per_lang)
    total_google = sum(int(r["google"]) for r in per_lang)
    share = round(100.0 * total_google / total_rows, 2) if total_rows else 0.0
    metrics.append(_metric(
        "google_provider_share",
        "Rows translated by Google",
        share, "%",
        _status_max(share, warn=40.0, fail=70.0),
        "warn >40%, fail >70%",
        detail="Google output is weaker on DeepL-supported languages; "
               "these rows are the candidates to re-warm when DeepL resets.",
        warn_at=40.0, fail_at=70.0, direction="max", max_value=100.0,
    ))

    # 3. Rows with no recorded provider. Pre-#124 rows, permanently unknowable.
    # Flat count, expected to stay flat — growth means a write path is not
    # tagging its provider.
    untracked = sum(int(r["untracked"]) for r in per_lang)
    metrics.append(_metric(
        "untracked_provider_rows",
        "Rows with unknown provider",
        untracked, "rows",
        "ok",
        "informational; should not grow",
        detail="Written before provenance tracking. Growth here means a write "
               "path is missing its provider tag.",
    ))

    # 4. Remaining DeepL characters this period — the thing that actually
    # paces warming, and the thing whose exhaustion breaks live translation
    # if the Google fallback is not configured.
    if deepl_usage:
        limit = deepl_usage.get("character_limit") or 0
        used = deepl_usage.get("character_count") or 0
        left = max(0, limit - used)
        pct_left = round(100.0 * left / limit, 2) if limit else 0.0
        metrics.append(_metric(
            "deepl_characters_remaining",
            "DeepL characters remaining",
            left, "chars",
            _status_min(pct_left, warn=15.0, fail=5.0),
            "warn <15% of allowance, fail <5%",
            detail=f"{used:,} of {limit:,} used this billing period",
            warn_at=15.0, fail_at=5.0, direction="min", max_value=float(limit or 0),
        ))

    # 5. Google's free allowance, estimated from the cache (no cheap usage API).
    g_left = max(0, GOOGLE_FREE_CHARS_PER_MONTH - google_spent)
    g_pct = round(100.0 * g_left / GOOGLE_FREE_CHARS_PER_MONTH, 2)
    metrics.append(_metric(
        "google_free_characters_remaining",
        "Google free characters remaining",
        g_left, "chars",
        _status_min(g_pct, warn=15.0, fail=0.0),
        "warn <15% of free allowance",
        detail="Estimated from cache rows written this month — Google has no "
               "cheap usage endpoint, so this under-counts work that failed.",
        warn_at=15.0, fail_at=0.0, direction="min",
        max_value=float(GOOGLE_FREE_CHARS_PER_MONTH),
    ))

    return metrics


async def compute_translation_coverage(
    db,
    langs: list[str],
    *,
    pool_limit: int = DEFAULT_POOL_LIMIT,
    deepl_client=None,
) -> dict[str, Any]:
    """Live report: measure the hot set, the cache, and both providers' quota."""
    hot_set_size = await _hot_set_size(db, pool_limit)
    per_lang = [dict(r) for r in await db.query_raw(CACHE_BY_LANG_SQL)]
    google_rows = await db.query_raw(GOOGLE_MONTH_SPEND_SQL)
    google_spent = int(google_rows[0]["chars"]) if google_rows else 0

    # Quota is a nice-to-have on a health page — never let an unreachable
    # provider turn the whole report into a 500.
    deepl_usage = None
    if deepl_client is not None:
        try:
            deepl_usage = await deepl_client.get_usage()
        except Exception as exc:
            logger.warning("[translation-coverage] DeepL usage unavailable: %s", exc)

    metrics = build_report(hot_set_size, per_lang, langs, deepl_usage, google_spent)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "overall_status": _overall_status(metrics),
        "hot_set_size": hot_set_size,
        "pool_limit": pool_limit,
        "cefr_levels": list(CEFR_LEVELS),
        "metrics": metrics,
    }
