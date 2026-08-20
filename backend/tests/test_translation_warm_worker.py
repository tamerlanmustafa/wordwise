"""
The warming worker's budget gating and provider handover (#124).

The failure this guards against is not a crash — it is a worker that quietly
spends the monthly allowance that live traffic needs, or that keeps calling a
provider which has already walled out. Both look like a healthy running process
in the logs, so they are asserted here instead.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from src.services.translation_coverage import GOOGLE_FREE_CHARS_PER_MONTH, build_report
from src.workers import translation_warm_worker as tw


class _FakeCacheTable:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    async def find_many(self, where):
        wanted = set(where["sourceText"]["in"])
        lang = where["targetLang"]
        return [r for r in self.rows if r.sourceText in wanted and r.targetLang == lang]


class _FakeDb:
    """Serves tier rows by matching the tier's distinctive SQL, plus the
    Google-spend query the worker derives its second budget from."""

    def __init__(self, tier_texts=None, cached=None, google_spent=0):
        self.translationcache = _FakeCacheTable(cached)
        self.tier_texts = tier_texts or {}
        self.google_spent = google_spent

    async def query_raw(self, sql, *args):
        if "provider = 'google'" in sql:
            return [{"chars": self.google_spent}]
        for tier, texts in self.tier_texts.items():
            marker = {
                "pool_lemmas": "GROUP BY lemma",
                "pool_sentences": "b.sentence",
            }[tier]
            if marker in sql:
                return [{"text": t} for t in texts]
        return []


class _FakeService:
    def __init__(self, fail=False):
        self.calls = []
        self.fail = fail

    async def batch_translate(self, texts, target_lang, source_lang="auto",
                              force_provider=None, **kw):
        if self.fail:
            raise RuntimeError("provider down")
        self.calls.append((list(texts), target_lang, force_provider))
        return [{"translated": f"{t}-{target_lang}"} for t in texts]


class _FakeDeepL:
    def __init__(self, used=0, limit=500_000, raises=False):
        self.used, self.limit, self.raises = used, limit, raises

    async def get_usage(self):
        if self.raises:
            raise RuntimeError("deepl unreachable")
        return {"character_count": self.used, "character_limit": self.limit}


def _row(text, lang="TR"):
    return SimpleNamespace(sourceText=text, targetLang=lang, translated="x",
                           sourceLang="EN", createdAt=None)


class TestBudgetGating:
    def test_unreadable_deepl_quota_falls_to_google_not_to_guessing(self):
        # Failing closed matters: assuming quota is available would spend the
        # reserve that live traffic depends on.
        db = _FakeDb(google_spent=0)
        assert asyncio.run(tw.deepl_remaining(_FakeDeepL(raises=True), 50_000)) == 0

    def test_deepl_remaining_subtracts_the_live_traffic_reserve(self):
        got = asyncio.run(tw.deepl_remaining(_FakeDeepL(used=400_000), 50_000))
        assert got == 50_000  # 500k - 400k - 50k reserve

    def test_deepl_remaining_never_negative(self):
        assert asyncio.run(tw.deepl_remaining(_FakeDeepL(used=499_000), 50_000)) == 0

    def test_google_remaining_is_derived_from_this_month_only(self):
        db = _FakeDb(google_spent=100_000)
        got = asyncio.run(tw.google_remaining(db, 50_000))
        assert got == GOOGLE_FREE_CHARS_PER_MONTH - 100_000 - 50_000

    def test_disabled_google_is_zero_budget_not_an_error(self):
        # A half-configured deploy (creds set, feature flag missing) must make
        # the worker sleep, not enter a 60s retry loop emailing admins.
        db = _FakeDb(google_spent=0)
        disabled = SimpleNamespace(enabled=False)
        assert asyncio.run(tw.google_remaining(db, 0, client=disabled)) == 0

    def test_enabled_google_reads_the_real_spend(self):
        db = _FakeDb(google_spent=10_000)
        enabled = SimpleNamespace(enabled=True)
        got = asyncio.run(tw.google_remaining(db, 0, client=enabled))
        assert got == GOOGLE_FREE_CHARS_PER_MONTH - 10_000

    def test_google_remaining_fails_closed_on_query_error(self):
        class _Broken:
            async def query_raw(self, sql, *a):
                raise RuntimeError("db down")
        assert asyncio.run(tw.google_remaining(_Broken(), 0)) == 0


class TestCycle:
    def test_uses_deepl_while_it_has_budget(self):
        db = _FakeDb(tier_texts={"pool_lemmas": ["alpha", "bravo"], "pool_sentences": []})
        svc = _FakeService()
        result = asyncio.run(tw.run_cycle(db, svc, _FakeDeepL(used=0), ["TR"], batch_sleep=0))

        assert result.outcome == "warmed"
        assert result.provider == "deepl"
        # force_provider stays None so batch_translate takes its normal path.
        assert svc.calls[0][2] is None

    def test_switches_to_google_when_deepl_is_spent(self):
        db = _FakeDb(tier_texts={"pool_lemmas": ["alpha"], "pool_sentences": []},
                     google_spent=0)
        svc = _FakeService()
        result = asyncio.run(
            tw.run_cycle(db, svc, _FakeDeepL(used=500_000), ["TR"], batch_sleep=0)
        )

        assert result.provider == "google"
        # Must be forced, or every batch re-discovers the DeepL wall first.
        assert svc.calls[0][2] == "google"

    def test_a_nearly_empty_deepl_does_not_strand_google(self):
        # Regression, found in prod: DeepL sat at exactly 2 spendable chars
        # (500,000 - 449,998 used - 50,000 reserve). A `<= 0` handover treated
        # that as "still has budget", so the worker picked DeepL, fitted no
        # word into 2 characters, warmed nothing, and slept — every cycle until
        # the monthly reset, while Google had ~450,000 chars going unused.
        db = _FakeDb(tier_texts={"pool_lemmas": ["alpha"], "pool_sentences": []},
                     google_spent=0)
        svc = _FakeService()
        svc.google_client = SimpleNamespace(enabled=True)

        result = asyncio.run(
            tw.run_cycle(db, svc, _FakeDeepL(used=449_998), ["TR"], batch_sleep=0)
        )

        assert result.provider == "google"
        assert result.warmed == 1
        assert svc.calls[0][2] == "google"

    def test_keeps_deepl_when_google_has_even_less(self):
        # The handover is "whichever has more", not "always leave DeepL" — a
        # nearly-empty DeepL still beats a completely empty Google.
        db = _FakeDb(tier_texts={"pool_lemmas": ["alpha"], "pool_sentences": []},
                     google_spent=GOOGLE_FREE_CHARS_PER_MONTH)
        svc = _FakeService()
        svc.google_client = SimpleNamespace(enabled=True)

        result = asyncio.run(
            tw.run_cycle(db, svc, _FakeDeepL(used=449_998), ["TR"], batch_sleep=0)
        )
        assert result.outcome == "cap"

    def test_reports_cap_when_both_providers_are_spent(self):
        db = _FakeDb(tier_texts={"pool_lemmas": ["alpha"], "pool_sentences": []},
                     google_spent=GOOGLE_FREE_CHARS_PER_MONTH)
        svc = _FakeService()
        result = asyncio.run(
            tw.run_cycle(db, svc, _FakeDeepL(used=500_000), ["TR"], batch_sleep=0)
        )

        assert result.outcome == "cap"
        assert svc.calls == []

    def test_idle_when_everything_is_already_cached(self):
        db = _FakeDb(tier_texts={"pool_lemmas": ["alpha"], "pool_sentences": []},
                     cached=[_row("alpha")])
        svc = _FakeService()
        result = asyncio.run(tw.run_cycle(db, svc, _FakeDeepL(), ["TR"], batch_sleep=0))

        assert result.outcome == "idle"
        assert svc.calls == []

    def test_finishes_a_language_before_starting_the_next(self):
        # Language-major on purpose: a language warmed halfway still fires a
        # provider call on most pages, so spreading budget across languages
        # buys nothing.
        db = _FakeDb(tier_texts={"pool_lemmas": ["alpha"], "pool_sentences": []})
        svc = _FakeService()
        asyncio.run(tw.run_cycle(db, svc, _FakeDeepL(), ["TR", "ES"], batch_sleep=0))

        assert {c[1] for c in svc.calls} == {"TR"}

    def test_a_failed_batch_still_charges_the_budget(self):
        # The provider has billed the characters even though we did not store
        # them; not charging would let a failing loop overspend silently.
        db = _FakeDb(tier_texts={"pool_lemmas": ["alpha"], "pool_sentences": []})
        with pytest.raises(RuntimeError):
            asyncio.run(tw.run_cycle(db, _FakeService(fail=True), _FakeDeepL(),
                                     ["TR"], batch_sleep=0))

    def test_cycle_budget_caps_a_single_pass(self):
        # Bounded so a spike in live traffic is noticed within one cycle
        # rather than after the whole allowance is gone.
        db = _FakeDb(tier_texts={"pool_lemmas": ["x" * 100] * 50, "pool_sentences": []})
        svc = _FakeService()
        result = asyncio.run(tw.run_cycle(db, svc, _FakeDeepL(), ["TR"],
                                          batch_sleep=0, cycle_chars=250))
        assert result.chars <= 250


class TestCoverageReport:
    def _metrics(self, **kw):
        defaults = dict(
            hot_set_size=1000,
            per_lang=[{"target_lang": "TR", "total": 900, "deepl": 600,
                       "google": 250, "untracked": 50, "last_written": None}],
            langs_expected=["TR", "ES"],
            deepl_usage={"character_count": 450_000, "character_limit": 500_000},
            google_spent=0,
        )
        defaults.update(kw)
        return {m["key"]: m for m in build_report(**defaults)}

    def test_reports_coverage_per_expected_language(self):
        m = self._metrics()
        assert m["hot_set_coverage_tr"]["value"] == 90.0
        # A language never warmed must still appear, at zero — absence would
        # read as "fine" on the dashboard.
        assert m["hot_set_coverage_es"]["value"] == 0.0
        assert m["hot_set_coverage_es"]["status"] == "fail"

    def test_coverage_is_capped_at_100(self):
        m = self._metrics(per_lang=[{"target_lang": "TR", "total": 5000, "deepl": 5000,
                                     "google": 0, "untracked": 0, "last_written": None}])
        assert m["hot_set_coverage_tr"]["value"] == 100.0

    def test_google_share_is_surfaced_as_quality_debt(self):
        m = self._metrics()
        assert m["google_provider_share"]["value"] == pytest.approx(27.78, abs=0.01)

    def test_low_deepl_quota_is_flagged(self):
        m = self._metrics()
        # 50k of 500k left = 10% -> warn band
        assert m["deepl_characters_remaining"]["status"] == "warn"
        assert m["deepl_characters_remaining"]["value"] == 50_000

    def test_missing_deepl_usage_degrades_by_one_metric_not_the_report(self):
        m = self._metrics(deepl_usage=None)
        assert "deepl_characters_remaining" not in m
        assert "hot_set_coverage_tr" in m

    def test_untracked_rows_are_reported_but_not_a_failure(self):
        m = self._metrics()
        assert m["untracked_provider_rows"]["value"] == 50
        assert m["untracked_provider_rows"]["status"] == "ok"
