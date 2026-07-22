"""
Unit tests for the vocab-pipeline health endpoint (GET /admin/health/vocab-coverage).

Two layers:
- build_report is pure (raw counts + previous snapshot values -> metric dicts),
  so every threshold band (ok/warn/fail) is asserted directly with no DB.
- A fake Prisma db exercises compute_vocab_coverage end-to-end (gather → diff
  against a canned snapshot → classify) with no real Postgres.
- Route-level guard assertion mirrors tests/test_auth_guards.py: the endpoint
  must actually declare get_admin_user + a rate-limit dependency.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from src.middleware.auth import get_admin_user
from src.services import vocab_coverage as vc


# ── helpers ──────────────────────────────────────────────────────────────────

def _by_key(metrics: list[dict]) -> dict[str, dict]:
    return {m["key"]: m for m in metrics}


def _report(raw_overrides: dict, previous=None, cap_usd: float = 50.0) -> dict[str, dict]:
    """build_report over a fully-healthy baseline with `raw_overrides` applied."""
    raw = {
        "mlm_total": 1000,
        "mlm_covered": 950,          # 95% coverage → ok
        "uncovered_visible_lemmas": 100,
        "a2": 400,
        "lemmas_total": 1000,         # 40% A2 → ok
        "translation_cache_7d": 50,   # >0 → ok
        "wse_rows": 100,
        "wse_with_gloss": 90,         # 90% gloss → ok
        "noop_translations": 0,
        "orphan_sentences": 0,
        "dead_end_movies": 170,
        "llm_cost_24h": 0.0,
    }
    raw.update(raw_overrides)
    return _by_key(vc.build_report(raw, previous, cap_usd))


# ── pure classifier helpers ──────────────────────────────────────────────────

def test_status_min_bands():
    assert vc._status_min(95, 90, 80) == vc.OK
    assert vc._status_min(90, 90, 80) == vc.OK        # warn is strict <
    assert vc._status_min(85, 90, 80) == vc.WARN
    assert vc._status_min(80, 90, 80) == vc.WARN      # fail is strict <
    assert vc._status_min(79, 90, 80) == vc.FAIL


def test_status_max_bands():
    assert vc._status_max(40, 50, None) == vc.OK
    assert vc._status_max(60, 50, None) == vc.WARN
    assert vc._status_max(60, 40, 50) == vc.FAIL


def test_status_no_increase():
    assert vc._status_no_increase(0, None) == vc.OK       # clean, cold
    assert vc._status_no_increase(3, None) == vc.WARN     # exists, no baseline
    assert vc._status_no_increase(5, 3) == vc.FAIL        # rose
    assert vc._status_no_increase(2, 3) == vc.WARN        # exists but fell
    assert vc._status_no_increase(0, 3) == vc.OK          # cleared to 0


def test_status_watch_rise_and_fall():
    assert vc._status_watch_rise(100, 200) == vc.OK       # fell → good
    assert vc._status_watch_rise(300, 200) == vc.WARN     # rose → watch
    assert vc._status_watch_rise(300, None) == vc.OK      # cold
    assert vc._status_watch_fall(100, 50) == vc.OK        # climbed → good
    assert vc._status_watch_fall(30, 50) == vc.WARN       # shrank → watch
    assert vc._status_watch_fall(30, None) == vc.OK       # cold


# ── build_report thresholds per metric ───────────────────────────────────────

def test_coverage_ok_warn_fail():
    assert _report({"mlm_covered": 950})["usage_weighted_sentence_coverage"]["status"] == vc.OK
    assert _report({"mlm_covered": 850})["usage_weighted_sentence_coverage"]["status"] == vc.WARN
    assert _report({"mlm_covered": 750})["usage_weighted_sentence_coverage"]["status"] == vc.FAIL


def test_coverage_zero_total_is_safe():
    m = _report({"mlm_total": 0, "mlm_covered": 0})["usage_weighted_sentence_coverage"]
    assert m["value"] == 0.0
    assert m["status"] == vc.FAIL


def test_a2_share_warns_over_half():
    assert _report({"a2": 400})["a2_registry_share"]["status"] == vc.OK
    m = _report({"a2": 818})["a2_registry_share"]   # 81.8% like prod
    assert m["status"] == vc.WARN
    assert m["value"] == pytest.approx(81.8)


def test_translation_cache_growth_stall():
    assert _report({"translation_cache_7d": 50})["translation_cache_growth"]["status"] == vc.OK
    assert _report({"translation_cache_7d": 0})["translation_cache_growth"]["status"] == vc.WARN


def test_reveal_cache_gloss_share_bands():
    # No rows yet → n/a, never alarms.
    m0 = _report({"wse_rows": 0, "wse_with_gloss": 0})["word_sentence_gloss_share"]
    assert m0["value"] is None and m0["status"] == vc.OK
    # Small sample (< _GLOSS_MIN_SAMPLE): a low share only WARNs, never FAILs —
    # this is the prod rollout case (25 rows, 0 gloss) that shouldn't go red.
    ramp = _report({"wse_rows": 25, "wse_with_gloss": 0})["word_sentence_gloss_share"]
    assert ramp["status"] == vc.WARN
    assert _report({"wse_rows": 100, "wse_with_gloss": 90})["word_sentence_gloss_share"]["status"] == vc.OK
    # Real sample (≥ _GLOSS_MIN_SAMPLE): full ok/warn/fail bands apply.
    big = vc._GLOSS_MIN_SAMPLE + 100
    assert _report({"wse_rows": big, "wse_with_gloss": int(big * 0.9)})["word_sentence_gloss_share"]["status"] == vc.OK
    assert _report({"wse_rows": big, "wse_with_gloss": int(big * 0.4)})["word_sentence_gloss_share"]["status"] == vc.WARN
    assert _report({"wse_rows": big, "wse_with_gloss": int(big * 0.1)})["word_sentence_gloss_share"]["status"] == vc.FAIL


def test_reveal_cache_rows_shrink_warns():
    prev = {"word_sentence_examples_rows": 500}
    assert _report({"wse_rows": 600}, prev)["word_sentence_examples_rows"]["status"] == vc.OK
    assert _report({"wse_rows": 400}, prev)["word_sentence_examples_rows"]["status"] == vc.WARN


def test_noop_translations_regression_guard():
    assert _report({"noop_translations": 0})["noop_translations"]["status"] == vc.OK
    assert _report({"noop_translations": 3})["noop_translations"]["status"] == vc.WARN
    prev = {"noop_translations": 3}
    assert _report({"noop_translations": 5}, prev)["noop_translations"]["status"] == vc.FAIL
    assert _report({"noop_translations": 0}, prev)["noop_translations"]["status"] == vc.OK


def test_orphan_sentences_regression_guard():
    assert _report({"orphan_sentences": 0})["orphan_sentences"]["status"] == vc.OK
    assert _report({"orphan_sentences": 10}, {"orphan_sentences": 2})["orphan_sentences"]["status"] == vc.FAIL


def test_uncovered_lemmas_trend():
    prev = {"uncovered_visible_lemmas": 70000}
    assert _report({"uncovered_visible_lemmas": 65000}, prev)["uncovered_visible_lemmas"]["status"] == vc.OK
    assert _report({"uncovered_visible_lemmas": 75000}, prev)["uncovered_visible_lemmas"]["status"] == vc.WARN


def test_llm_cost_vs_cap():
    assert _report({"llm_cost_24h": 0.0}, cap_usd=50.0)["llm_cost_last_24h"]["status"] == vc.OK
    assert _report({"llm_cost_24h": 45.0}, cap_usd=50.0)["llm_cost_last_24h"]["status"] == vc.WARN
    assert _report({"llm_cost_24h": 60.0}, cap_usd=50.0)["llm_cost_last_24h"]["status"] == vc.FAIL


def test_delta_is_reported_against_previous():
    m = _report({"noop_translations": 5}, {"noop_translations": 3})["noop_translations"]
    assert m["previous"] == 3
    assert m["delta"] == 2


def test_every_metric_has_value_threshold_status():
    metrics = vc.build_report(
        {"mlm_total": 1, "mlm_covered": 1, "lemmas_total": 1, "a2": 0},
        None, 50.0,
    )
    assert metrics, "build_report returned no metrics"
    for m in metrics:
        assert set(m) >= {"key", "label", "value", "unit", "status", "threshold"}
        assert m["status"] in (vc.OK, vc.WARN, vc.FAIL)


# ── overall status rollup ────────────────────────────────────────────────────

def test_overall_status_is_worst():
    healthy = _report({})   # all bands satisfied (A2 at 40% ≤ 50)
    assert vc._overall_status(list(healthy.values())) == vc.OK
    # A single warn (A2 skew like prod) lifts the rollup to warn.
    warned = _report({"a2": 818})
    assert vc._overall_status(list(warned.values())) == vc.WARN
    # A hard failure dominates everything below it.
    failing = _report({"mlm_covered": 750, "a2": 818})  # coverage fail + a2 warn
    assert vc._overall_status(list(failing.values())) == vc.FAIL


# ── fake-db end-to-end path ──────────────────────────────────────────────────

class _FakeSnapshotTable:
    def __init__(self, snapshot):
        self._snapshot = snapshot
        self.created: list = []

    async def find_first(self, order=None):
        return self._snapshot

    async def create(self, data=None):
        self.created.append(data)
        return SimpleNamespace(id=len(self.created))


class _FakeDb:
    """Routes vocab_coverage's raw queries to canned counts by a distinctive
    substring of each SQL statement — no Postgres, no Prisma engine."""

    def __init__(self, raw: dict, snapshot=None):
        self._raw = raw
        self.vocabcoveragesnapshot = _FakeSnapshotTable(snapshot)

    async def query_raw(self, sql: str, *args):
        s = " ".join(sql.split())
        if "AS covered" in s:
            return [{"total": self._raw["mlm_total"], "covered": self._raw["mlm_covered"]}]
        if "hidden_words" in s:
            return [{"n": self._raw["uncovered_visible_lemmas"]}]
        if "cefr_level = 'A2'" in s:
            return [{"a2": self._raw["a2"], "total": self._raw["lemmas_total"]}]
        if "translation_cache WHERE created_at" in s:
            return [{"n": self._raw["translation_cache_7d"]}]
        if "with_gloss" in s:
            return [{"rows": self._raw["wse_rows"], "with_gloss": self._raw["wse_with_gloss"]}]
        if "lower(source_text) = lower(translated)" in s:
            return [{"n": self._raw["noop_translations"]}]
        if "FROM sentence_bank sb" in s:
            return [{"n": self._raw["orphan_sentences"]}]
        if "FROM movies m" in s:
            return [{"n": self._raw["dead_end_movies"]}]
        if "llm_usage_ledger" in s:
            return [{"cost": self._raw["llm_cost_24h"]}]
        raise AssertionError(f"unrouted query: {s[:80]}")


_BASELINE_RAW = {
    "mlm_total": 1000,
    "mlm_covered": 950,
    "uncovered_visible_lemmas": 65000,
    "a2": 818,
    "lemmas_total": 1000,
    "translation_cache_7d": 50,
    "wse_rows": 100,
    "wse_with_gloss": 90,
    "noop_translations": 0,
    "orphan_sentences": 0,
    "dead_end_movies": 170,
    "llm_cost_24h": 0.0,
}


async def test_compute_vocab_coverage_cold(monkeypatch):
    monkeypatch.setattr(vc, "get_settings", lambda: SimpleNamespace(llm_cost_cap_usd=50.0))
    db = _FakeDb(_BASELINE_RAW)
    report = await vc.compute_vocab_coverage(db)
    assert report["previous_snapshot_at"] is None
    assert report["llm_cost_cap_usd"] == 50.0
    by_key = _by_key(report["metrics"])
    assert by_key["usage_weighted_sentence_coverage"]["status"] == vc.OK
    assert by_key["a2_registry_share"]["status"] == vc.WARN
    assert report["overall_status"] == vc.WARN


async def test_compute_vocab_coverage_detects_noop_increase(monkeypatch):
    monkeypatch.setattr(vc, "get_settings", lambda: SimpleNamespace(llm_cost_cap_usd=50.0))
    snapshot = SimpleNamespace(
        capturedAt=datetime.now(timezone.utc) - timedelta(hours=25),
        metrics={"metrics": [{"key": "noop_translations", "value": 2}]},
    )
    raw = dict(_BASELINE_RAW, noop_translations=9)
    db = _FakeDb(raw, snapshot=snapshot)
    report = await vc.compute_vocab_coverage(db)
    by_key = _by_key(report["metrics"])
    assert by_key["noop_translations"]["status"] == vc.FAIL
    assert by_key["noop_translations"]["delta"] == 7
    assert report["overall_status"] == vc.FAIL
    assert report["previous_snapshot_at"] is not None


async def test_maybe_write_daily_snapshot_respects_interval(monkeypatch):
    monkeypatch.setattr(vc, "get_settings", lambda: SimpleNamespace(llm_cost_cap_usd=50.0))

    recent = SimpleNamespace(
        capturedAt=datetime.now(timezone.utc) - timedelta(hours=1),
        metrics={"metrics": []},
    )
    db = _FakeDb(_BASELINE_RAW, snapshot=recent)
    assert await vc.maybe_write_daily_snapshot(db) is False
    assert db.vocabcoveragesnapshot.created == []

    stale = SimpleNamespace(
        capturedAt=datetime.now(timezone.utc) - timedelta(hours=30),
        metrics={"metrics": []},
    )
    db2 = _FakeDb(_BASELINE_RAW, snapshot=stale)
    assert await vc.maybe_write_daily_snapshot(db2) is True
    assert len(db2.vocabcoveragesnapshot.created) == 1


# ── route-level guard (mirrors tests/test_auth_guards.py) ─────────────────────

def _dependency_calls(router, path: str, method: str) -> set:
    for route in router.routes:
        if getattr(route, "path", None) == path and method in getattr(route, "methods", set()):
            calls: set = set()

            def walk(dependant):
                for sub in dependant.dependencies:
                    if sub.call is not None:
                        calls.add(sub.call)
                    walk(sub)

            walk(route.dependant)
            return calls
    raise AssertionError(f"route {method} {path} not found on router")


def _has_rate_limit(calls: set) -> bool:
    return any(getattr(c, "__qualname__", "").startswith("rate_limit.") for c in calls)


def test_vocab_health_requires_admin_and_throttle():
    from src.routes.admin import router

    calls = _dependency_calls(router, "/admin/health/vocab-coverage", "GET")
    assert get_admin_user in calls
    assert _has_rate_limit(calls)
