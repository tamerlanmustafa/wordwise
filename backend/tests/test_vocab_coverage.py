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
        "unknown": 150,               # #91 bucket — observation only, never fails
        "lemmas_total": 1000,         # 40% A2 → ok
        "translation_cache_7d": 50,   # >0 → ok
        "wse_rows": 100,
        "wse_with_gloss": 90,         # 90% gloss → ok
        "noop_translations": 0,
        "orphan_sentences": 0,
        "dead_end_movies": 170,
        "llm_cost_24h": 0.0,
        # Every level deeper than the warn band → ok. Six of them: the mix
        # addresses the full A1–C2 range, so the report measures all six.
        "feed_pool_by_level": {
            "A1": 1700, "A2": 6000, "B1": 2000, "B2": 5000, "C1": 8000, "C2": 2700,
        },
        "snapshot_age_hours": 24.0,   # written yesterday → ok
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


def test_unknown_share_is_observation_only():
    """
    The #91 bucket is there to be watched, not policed: we have not decided
    what these words deserve yet, so no size of it may warn or fail.
    """
    small = _report({"unknown": 10})["unknown_registry_share"]
    huge = _report({"unknown": 900})["unknown_registry_share"]

    assert small["status"] == vc.OK
    assert huge["status"] == vc.OK
    assert huge["value"] == pytest.approx(90.0)
    assert (huge["warn_at"], huge["fail_at"]) == (None, None)


def test_feed_pool_depth_bands():
    """#116: the pool is only as good as its thinnest level, because the mix
    panel lets a user weight any single level to 100%."""
    deep = {"A2": 6000, "B1": 2000, "B2": 5000, "C1": 8000}
    assert _report({"feed_pool_by_level": deep})["feed_pool_min_level"]["status"] == vc.OK
    # One shallow level drags the metric even while the others are healthy.
    thin = dict(deep, C1=800)
    m = _report({"feed_pool_by_level": thin})["feed_pool_min_level"]
    assert m["status"] == vc.WARN
    assert m["value"] == 800
    assert _report({"feed_pool_by_level": dict(deep, C1=250)})["feed_pool_min_level"]["status"] == vc.FAIL


def test_feed_pool_detail_names_the_shallowest_level():
    m = _report({"feed_pool_by_level": {"A2": 6000, "B1": 800}})["feed_pool_min_level"]
    assert "B1 800 (shallowest)" in m["detail"]
    assert "A2 6,000" in m["detail"]


def test_feed_pool_with_no_levels_fails_loudly():
    # An empty pool means Explore has nothing to deal. Reporting ok would hide
    # exactly the outage this metric is for.
    m = _report({"feed_pool_by_level": {}})["feed_pool_min_level"]
    assert m["value"] == 0
    assert m["status"] == vc.FAIL


def test_feed_pool_is_a_stat_tile_not_a_meter():
    # Unbounded count: there is no natural 100% for "lemmas in stock".
    assert _report({})["feed_pool_min_level"]["max_value"] is None


def test_snapshot_age_bands():
    """#154: the daily writer died on 2026-08-18 and the only signal was a WARN
    log. These bands are what turns that into a red card — one missed day warns,
    three days fails."""
    assert _report({"snapshot_age_hours": 24.0})["vocab_snapshot_age"]["status"] == vc.OK
    # Exactly on a bound is still the better side — _status_max is strict >.
    assert _report({"snapshot_age_hours": 36.0})["vocab_snapshot_age"]["status"] == vc.OK
    assert _report({"snapshot_age_hours": 40.0})["vocab_snapshot_age"]["status"] == vc.WARN
    assert _report({"snapshot_age_hours": 72.0})["vocab_snapshot_age"]["status"] == vc.WARN
    # The real prod hole on the day this was fixed: 5 days 8h.
    m = _report({"snapshot_age_hours": 128.45})["vocab_snapshot_age"]
    assert m["status"] == vc.FAIL
    assert m["value"] == pytest.approx(128.45)
    assert (m["warn_at"], m["fail_at"], m["direction"]) == (36.0, 72.0, "max")


def test_snapshot_age_with_no_snapshot_warns_but_cannot_fail():
    """A never-written snapshot and a fresh database are indistinguishable from
    here, so an empty table must not paint the dashboard red on day one."""
    m = _report({"snapshot_age_hours": None})["vocab_snapshot_age"]
    assert m["value"] is None
    assert m["status"] == vc.WARN
    assert "has ever been written" in m["detail"]


def test_stale_snapshot_alone_fails_the_whole_report():
    """The point of the metric: with every vocabulary number healthy, a dead
    writer still turns the card red instead of reading ok."""
    healthy = _report({})
    assert vc._overall_status(list(healthy.values())) == vc.OK
    stale = _report({"snapshot_age_hours": 128.0})
    assert vc._overall_status(list(stale.values())) == vc.FAIL


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
        assert set(m) >= {
            "key", "label", "value", "unit", "status", "threshold",
            "warn_at", "fail_at", "direction", "max_value",
        }
        assert m["status"] in (vc.OK, vc.WARN, vc.FAIL)
        assert m["direction"] in ("min", "max")


def test_structured_bands_match_human_thresholds():
    """The admin UI draws meters off warn_at/fail_at/max_value, so they must agree
    with the bands the classifiers actually apply."""
    by_key = _report({}, cap_usd=50.0)

    cov = by_key["usage_weighted_sentence_coverage"]
    assert (cov["warn_at"], cov["fail_at"], cov["direction"], cov["max_value"]) == (90.0, 80.0, "min", 100.0)

    a2 = by_key["a2_registry_share"]
    assert (a2["warn_at"], a2["fail_at"], a2["direction"], a2["max_value"]) == (50.0, None, "max", 100.0)

    gloss = by_key["word_sentence_gloss_share"]
    assert (gloss["warn_at"], gloss["fail_at"], gloss["direction"], gloss["max_value"]) == (50.0, 20.0, "min", 100.0)

    # Cost scales against the configured cap, not a fixed 100.
    cost = by_key["llm_cost_last_24h"]
    assert (cost["warn_at"], cost["fail_at"], cost["max_value"]) == (40.0, 50.0, 50.0)


def test_meter_vs_tile_split_is_stable():
    """max_value present = meter (bounded scale); absent = stat tile (unbounded
    count). The UI keys its whole layout off this, so pin the split."""
    by_key = _report({})
    meters = {k for k, m in by_key.items() if m["max_value"] is not None}
    assert meters == {
        "usage_weighted_sentence_coverage",
        "a2_registry_share",
        "unknown_registry_share",
        "word_sentence_gloss_share",
        "llm_cost_last_24h",
    }


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


class _FakeTx:
    """Stands in for Prisma's interactive-transaction context manager, recording
    the timeout it was opened with so the test can pin it."""

    def __init__(self, db, timeout):
        self._db = db
        self._db.tx_timeouts.append(timeout)

    async def __aenter__(self):
        self._db.tx_depth += 1
        return self._db

    async def __aexit__(self, *exc):
        self._db.tx_depth -= 1
        return False


class _FakeDb:
    """Routes vocab_coverage's raw queries to canned counts by a distinctive
    substring of each SQL statement — no Postgres, no Prisma engine."""

    def __init__(self, raw: dict, snapshot=None):
        self._raw = raw
        self.vocabcoveragesnapshot = _FakeSnapshotTable(snapshot)
        self.executed: list[str] = []
        self.tx_timeouts: list = []
        self.tx_depth = 0
        # Ordered log of ("set"|"query", inside_a_transaction) — the ordering
        # matters as much as the setting, see test_gather_disables_parallelism.
        self.events: list[tuple[str, bool]] = []

    def tx(self, *, timeout=None, **_kwargs):
        return _FakeTx(self, timeout)

    async def execute_raw(self, sql: str, *args):
        assert self.tx_depth > 0, "SET LOCAL outside a transaction is a no-op"
        self.executed.append(" ".join(sql.split()))
        self.events.append(("set", True))
        return 0

    async def query_raw(self, sql: str, *args):
        self.events.append(("query", self.tx_depth > 0))
        s = " ".join(sql.split())
        if "AS covered" in s:
            return [{"total": self._raw["mlm_total"], "covered": self._raw["mlm_covered"]}]
        # Ahead of the hidden_words branch: the feed-pool query filters
        # hidden_words too, and would otherwise be answered by it.
        if "AS level" in s:
            return [
                {"level": lvl, "n": n}
                for lvl, n in self._raw["feed_pool_by_level"].items()
            ]
        if "hidden_words" in s:
            return [{"n": self._raw["uncovered_visible_lemmas"]}]
        if "cefr_level = 'A2'" in s:
            return [{
                "a2": self._raw["a2"],
                "unknown": self._raw["unknown"],
                "total": self._raw["lemmas_total"],
            }]
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
    "unknown": 150,
    "lemmas_total": 1000,
    "translation_cache_7d": 50,
    "wse_rows": 100,
    "wse_with_gloss": 90,
    "noop_translations": 0,
    "orphan_sentences": 0,
    "dead_end_movies": 170,
    "llm_cost_24h": 0.0,
    # Measured on prod 2026-08-30, after the mix widened to all six levels.
    "feed_pool_by_level": {
        "A1": 1756, "A2": 6548, "B1": 2331, "B2": 5104, "C1": 8590, "C2": 2706,
    },
}


async def test_gather_disables_parallelism_for_every_count(monkeypatch):
    """#154: the orphan-sentences count asks Postgres for an 8 MB shared memory
    segment it cannot get on Railway, so the whole gather runs serially.

    Three things are pinned here, and prod proved each one matters:
    - the setting is SET LOCAL, so it reverts at COMMIT rather than sticking to
      a pooled connection and de-parallelising request-path queries later;
    - it is issued *before* the first count, because Prisma caches the prepared
      statement per connection and Postgres fixes the plan at that first
      preparation — set it afterwards and the parallel plan is already pinned;
    - *every* count runs inside that transaction, not just the one that happens
      to fail today, for the same reason: one execution outside it poisons the
      connection's cached plan for the life of the process.
    """
    monkeypatch.setattr(vc, "get_settings", lambda: SimpleNamespace(llm_cost_cap_usd=50.0))
    db = _FakeDb(_BASELINE_RAW)
    await vc.compute_vocab_coverage(db)

    assert db.executed == ["SET LOCAL max_parallel_workers_per_gather = 0"]
    assert db.tx_timeouts == [vc._GATHER_TX_TIMEOUT]

    assert db.events[0] == ("set", True), "parallelism must be off before the first count"
    assert len(db.events) > 1, "no counts ran inside the transaction"
    assert all(inside for _kind, inside in db.events), "a count escaped the transaction"


async def test_gather_timeout_outlasts_the_measured_gather():
    """Prisma's default transaction budget is 5s and the gather measures ~3.2s
    of server time on prod. Pin the override so a future edit back to the
    default doesn't quietly reinstate the outage as a timeout instead."""
    assert vc._GATHER_TX_TIMEOUT > timedelta(seconds=30)


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


async def test_snapshot_age_is_measured_from_the_stored_row(monkeypatch):
    """End-to-end: the age comes off the newest row's captured_at, not a
    hand-fed number. Driven by moving that timestamp, not by waiting."""
    monkeypatch.setattr(vc, "get_settings", lambda: SimpleNamespace(llm_cost_cap_usd=50.0))

    def _report_with_snapshot_age(hours: float) -> dict:
        snapshot = SimpleNamespace(
            capturedAt=datetime.now(timezone.utc) - timedelta(hours=hours),
            metrics={"metrics": []},
        )
        return _FakeDb(_BASELINE_RAW, snapshot=snapshot)

    fresh = _by_key((await vc.compute_vocab_coverage(_report_with_snapshot_age(20)))["metrics"])
    assert fresh["vocab_snapshot_age"]["status"] == vc.OK
    assert fresh["vocab_snapshot_age"]["value"] == pytest.approx(20.0, abs=0.01)

    missed = _by_key((await vc.compute_vocab_coverage(_report_with_snapshot_age(48)))["metrics"])
    assert missed["vocab_snapshot_age"]["status"] == vc.WARN

    # The prod condition on the day this shipped.
    dead = await vc.compute_vocab_coverage(_report_with_snapshot_age(128))
    assert _by_key(dead["metrics"])["vocab_snapshot_age"]["status"] == vc.FAIL
    assert dead["overall_status"] == vc.FAIL


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


# ── serving the report from the daily snapshot ───────────────────────────────

class TestReadServesTheSnapshot:
    """`compute_vocab_coverage` is ~3.2s of deliberately serial counts across
    multi-million-row tables, and measured 4,934 ms p95 as an endpoint on prod
    (2026-09-05) — the second-slowest route the app has. The sentence worker
    already computes the identical report once a day and stores it whole, so
    the screen reads that and recomputes only when asked.
    """

    def _stored(self, hours_old: float, *, metrics=None):
        return SimpleNamespace(
            capturedAt=datetime.now(timezone.utc) - timedelta(hours=hours_old),
            metrics={
                "generated_at": "2026-09-04T00:00:00+00:00",
                "overall_status": vc.OK,
                "llm_cost_cap_usd": 60.0,
                "metrics": metrics if metrics is not None else [
                    {"key": "vocab_snapshot_age", "label": "Coverage snapshot age",
                     "value": 24.0, "unit": "hours", "status": vc.OK},
                    {"key": "orphan_sentences", "value": 0, "status": vc.OK},
                ],
            },
        )

    async def test_the_stored_report_is_served_without_running_a_single_count(self):
        db = _FakeDb(_BASELINE_RAW, snapshot=self._stored(2))

        report = await vc.read_vocab_coverage(db)

        assert report["from_snapshot"] is True
        # The gather is the whole cost. Not one query, not one SET LOCAL.
        assert db.events == []

    async def test_fresh_forces_the_real_gather(self, monkeypatch):
        monkeypatch.setattr(vc, "get_settings", lambda: SimpleNamespace(llm_cost_cap_usd=50.0))
        db = _FakeDb(_BASELINE_RAW, snapshot=self._stored(2))

        report = await vc.read_vocab_coverage(db, fresh=True)

        assert report["from_snapshot"] is False
        assert db.events, "fresh=True must actually recompute"

    async def test_a_database_with_no_snapshot_yet_computes_live(self, monkeypatch):
        monkeypatch.setattr(vc, "get_settings", lambda: SimpleNamespace(llm_cost_cap_usd=50.0))
        db = _FakeDb(_BASELINE_RAW, snapshot=None)

        report = await vc.read_vocab_coverage(db)

        assert report["from_snapshot"] is False
        assert db.events, "a cold system has nothing to serve and must gather"

    async def test_the_age_metric_is_recomputed_against_now_not_served_as_stored(self):
        """The one metric that must never come out of the cache.

        `vocab_snapshot_age` exists to notice that the snapshot writer has died
        — it went unnoticed for five days once (#154). Serving it from inside
        the dead writer's last snapshot would report the ~24h that was true
        when it was written, for ever. A cache that reports its own freshness
        from inside the cache is not a freshness check.
        """
        db = _FakeDb(_BASELINE_RAW, snapshot=self._stored(100))

        report = await vc.read_vocab_coverage(db)
        age = _by_key(report["metrics"])["vocab_snapshot_age"]

        assert age["value"] == pytest.approx(100.0, abs=0.1)
        assert age["status"] == vc.FAIL          # stored value said ok
        assert report["overall_status"] == vc.FAIL

    async def test_a_fresh_snapshot_keeps_its_own_overall_status(self):
        db = _FakeDb(_BASELINE_RAW, snapshot=self._stored(2))

        report = await vc.read_vocab_coverage(db)

        assert _by_key(report["metrics"])["vocab_snapshot_age"]["status"] == vc.OK
        assert report["overall_status"] == vc.OK

    async def test_every_other_metric_passes_through_untouched(self):
        stored = self._stored(3, metrics=[
            {"key": "orphan_sentences", "value": 825, "status": vc.FAIL, "detail": "as stored"},
        ])
        db = _FakeDb(_BASELINE_RAW, snapshot=stored)

        by_key = _by_key((await vc.read_vocab_coverage(db))["metrics"])

        assert by_key["orphan_sentences"] == {
            "key": "orphan_sentences", "value": 825, "status": vc.FAIL, "detail": "as stored",
        }

    async def test_the_capture_time_is_reported_so_the_screen_can_say_how_old(self):
        db = _FakeDb(_BASELINE_RAW, snapshot=self._stored(5))

        report = await vc.read_vocab_coverage(db)

        assert report["captured_at"] is not None

    async def test_a_corrupt_snapshot_falls_back_to_computing(self, monkeypatch):
        # A row whose JSON is not a report at all (a half-written snapshot, a
        # schema that has moved on) must not be served as one.
        monkeypatch.setattr(vc, "get_settings", lambda: SimpleNamespace(llm_cost_cap_usd=50.0))
        broken = SimpleNamespace(
            capturedAt=datetime.now(timezone.utc), metrics={"not": "a report"}
        )
        db = _FakeDb(_BASELINE_RAW, snapshot=broken)

        report = await vc.read_vocab_coverage(db)

        assert report["from_snapshot"] is False
        assert db.events

    async def test_the_live_path_still_labels_itself(self, monkeypatch):
        # Both paths carry the same two keys, so the screen never has to guess
        # which one it got by looking for a missing field.
        monkeypatch.setattr(vc, "get_settings", lambda: SimpleNamespace(llm_cost_cap_usd=50.0))

        report = await vc.compute_vocab_coverage(_FakeDb(_BASELINE_RAW))

        assert report["from_snapshot"] is False
        assert report["captured_at"] is None


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
