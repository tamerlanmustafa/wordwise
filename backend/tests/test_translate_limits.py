"""Request-size and spend limits on the public translate endpoints (#152).

What was wrong: `POST /translate/batch` accepted 2,000 texts of any length,
30 times a minute, against DeepL's 500,000-characters-a-MONTH free allowance.
One signed-in account could exhaust the quota everybody shares in seconds and
push the rest of the app onto Google's paid tier.

The distinction these tests exist to hold is between a cost cap and a
cosmetic one: a limit that rejects *after* the provider round trip has been
paid for saves nothing. So every rejection case also asserts that no
translation ever reached the service — which is where the DeepL and Google
clients are constructed.

No DB and no network: the router is mounted on a bare app with the auth and
database dependencies overridden.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.database import get_db
from src.middleware.auth import get_current_active_user
from src.routes import translation as translation_route
from src.routes.translation import (
    DAILY_TRANSLATION_CHARS,
    MAX_BATCH_CHARS,
    MAX_BATCH_ITEMS,
    MAX_TEXT_CHARS,
)
from src.utils.char_budget import DailyCharBudget, seconds_until_utc_midnight


class _SpyService:
    """Stands in for TranslationService, counting what reached a provider.

    Constructing the real one builds a DeepLClient and a GoogleTranslateClient,
    so "was this class instantiated at all" is the honest test of whether a
    rejection happened before any provider existed.
    """

    constructions = 0
    calls: list = []

    def __init__(self, db):
        type(self).constructions += 1
        self.db = db

    async def batch_translate(self, texts, target_lang, source_lang="auto", user_id=None):
        type(self).calls.append(("batch", list(texts)))
        return [
            {
                "source": t,
                "translated": f"{t}-{target_lang.lower()}",
                "target_lang": target_lang,
                "source_lang": "EN",
                "cached": True,
                "provider": "batch",
            }
            for t in texts
        ]

    async def get_translation(self, text, target_lang, source_lang="auto",
                              user_id=None, context=None):
        type(self).calls.append(("single", text))
        return {
            "source": text,
            "translated": f"{text}-{target_lang.lower()}",
            "target_lang": target_lang,
            "source_lang": "EN",
            "cached": True,
            "provider": "cache",
        }

    @classmethod
    def reset(cls):
        cls.constructions = 0
        cls.calls = []


@pytest.fixture
def spy(monkeypatch) -> type[_SpyService]:
    _SpyService.reset()
    monkeypatch.setattr(translation_route, "TranslationService", _SpyService)
    return _SpyService


@pytest.fixture(autouse=True)
def _fresh_budget():
    """The budget is module state, so it leaks between tests otherwise."""
    translation_route._translation_char_budget.reset()
    yield
    translation_route._translation_char_budget.reset()


def _client(user_id: int = 1) -> TestClient:
    app = FastAPI()
    app.include_router(translation_route.router)
    app.dependency_overrides[get_db] = lambda: object()
    app.dependency_overrides[get_current_active_user] = lambda: SimpleNamespace(
        id=user_id, email="user@example.com", isActive=True, isAdmin=False
    )
    # The per-minute request throttle is a different limit with its own test
    # file; leaving it armed would make these tests fail on request *count*
    # rather than on the size caps they exist to pin.
    app.dependency_overrides[translation_route._translate_batch_throttle] = lambda: None
    app.dependency_overrides[translation_route._translate_throttle] = lambda: None
    return TestClient(app)


def _batch(texts, target="ES") -> dict:
    return {"texts": texts, "target_lang": target, "source_lang": "auto"}


_PER_ITEM = MAX_BATCH_CHARS // MAX_BATCH_ITEMS


def _spend(client: TestClient, chars: int) -> None:
    """Spend exactly `chars` of the caller's daily budget, in legal requests."""
    while chars:
        chunk = min(chars, MAX_BATCH_CHARS)
        items, remainder = divmod(chunk, _PER_ITEM)
        texts = ["x" * _PER_ITEM] * items + (["x" * remainder] if remainder else [])
        assert client.post("/translate/batch", json=_batch(texts)).status_code == 200
        chars -= chunk


class TestBatchItemCount:
    def test_exactly_the_item_cap_is_accepted(self, spy):
        res = _client().post("/translate/batch", json=_batch(["a"] * MAX_BATCH_ITEMS))
        assert res.status_code == 200
        assert res.json()["total"] == MAX_BATCH_ITEMS

    def test_one_over_the_item_cap_is_rejected_before_any_provider(self, spy):
        res = _client().post("/translate/batch", json=_batch(["a"] * (MAX_BATCH_ITEMS + 1)))
        assert res.status_code == 422
        assert spy.constructions == 0
        assert spy.calls == []

    def test_the_old_2000_item_ceiling_is_gone(self, spy):
        """The number the endpoint used to enforce, which is the whole bug."""
        res = _client().post("/translate/batch", json=_batch(["a"] * 2000))
        assert res.status_code == 422
        assert spy.calls == []


class TestPerItemLength:
    def test_exactly_the_per_item_cap_is_accepted(self, spy):
        res = _client().post("/translate/batch", json=_batch(["x" * MAX_TEXT_CHARS]))
        assert res.status_code == 200

    def test_one_char_over_is_rejected_before_any_provider(self, spy):
        res = _client().post("/translate/batch", json=_batch(["x" * (MAX_TEXT_CHARS + 1)]))
        assert res.status_code == 422
        assert spy.constructions == 0
        assert spy.calls == []

    def test_single_endpoint_keeps_its_own_cap(self, spy):
        res = _client().post(
            "/translate",
            json={"text": "x" * (MAX_TEXT_CHARS + 1), "target_lang": "ES"},
        )
        assert res.status_code == 422
        assert spy.calls == []


class TestTotalCharacters:
    def test_exactly_the_character_cap_is_accepted(self, spy):
        # 100 items x 200 chars = exactly MAX_BATCH_CHARS.
        per_item = MAX_BATCH_CHARS // MAX_BATCH_ITEMS
        res = _client().post(
            "/translate/batch", json=_batch(["x" * per_item] * MAX_BATCH_ITEMS)
        )
        assert res.status_code == 200

    def test_one_char_over_the_cap_is_rejected_before_any_provider(self, spy):
        per_item = MAX_BATCH_CHARS // MAX_BATCH_ITEMS
        texts = ["x" * per_item] * MAX_BATCH_ITEMS
        texts[0] += "x"
        res = _client().post("/translate/batch", json=_batch(texts))
        assert res.status_code == 422
        assert spy.constructions == 0
        assert spy.calls == []

    def test_item_count_alone_cannot_smuggle_the_characters_through(self, spy):
        """Few items, each legal, adding up to more than the cap.

        This is the case a max_items limit can never catch, and the reason the
        cap has to be in characters: 5 x 5,000 clears both other limits.
        """
        texts = ["x" * MAX_TEXT_CHARS] * 5
        assert len(texts) <= MAX_BATCH_ITEMS
        assert sum(len(t) for t in texts) > MAX_BATCH_CHARS
        res = _client().post("/translate/batch", json=_batch(texts))
        assert res.status_code == 422
        assert spy.calls == []

    def test_whitespace_only_items_are_not_billed(self, spy):
        """They are dropped before the provider, so they must not count.

        Raw, this payload is over the character cap; cleaned, it is four
        characters. Billing follows the cleaned list because that is what a
        provider is ever asked to translate.
        """
        padding = ["   " * 83] * (MAX_BATCH_ITEMS - 1)  # 249 chars each
        raw_total = sum(len(t) for t in padding) + len("word")
        assert raw_total > MAX_BATCH_CHARS

        res = _client().post("/translate/batch", json=_batch(padding + ["word"]))
        assert res.status_code == 200
        assert spy.calls == [("batch", ["word"])]


class TestDailyBudget:
    def test_a_caller_is_cut_off_once_the_day_is_spent(self, spy):
        client = _client()
        _spend(client, DAILY_TRANSLATION_CHARS)

        served = len(spy.calls)
        res = client.post("/translate/batch", json=_batch(["word"]))
        assert res.status_code == 429
        assert int(res.headers["Retry-After"]) > 0
        # Rejected before the provider — the spy saw nothing new.
        assert len(spy.calls) == served

    def test_the_last_character_of_the_budget_is_still_served(self, spy):
        client = _client()
        _spend(client, DAILY_TRANSLATION_CHARS - 4)
        assert client.post("/translate/batch", json=_batch(["word"])).status_code == 200
        assert client.post("/translate/batch", json=_batch(["a"])).status_code == 429

    def test_the_budget_is_per_caller(self, spy):
        _spend(_client(user_id=1), DAILY_TRANSLATION_CHARS)
        # A second account is untouched by the first one's spending.
        second = _client(user_id=2)
        assert second.post("/translate/batch", json=_batch(["word"])).status_code == 200

    def test_both_endpoints_draw_on_the_same_budget(self, spy):
        """Otherwise /translate is just the cheaper way to spend the quota —
        120 requests a minute at 5,000 characters each."""
        client = _client()
        _spend(client, DAILY_TRANSLATION_CHARS)

        served = len(spy.calls)
        res = client.post("/translate", json={"text": "word", "target_lang": "ES"})
        assert res.status_code == 429
        assert len(spy.calls) == served

    def test_the_single_endpoint_also_spends_the_shared_budget(self, spy):
        """The reverse direction: /translate must charge, not just check."""
        client = _client()
        _spend(client, DAILY_TRANSLATION_CHARS - MAX_TEXT_CHARS)
        assert client.post(
            "/translate", json={"text": "x" * MAX_TEXT_CHARS, "target_lang": "ES"}
        ).status_code == 200
        assert client.post("/translate/batch", json=_batch(["a"])).status_code == 429

    def test_a_normal_reading_session_is_nowhere_near_the_budget(self, spy):
        """The heaviest day any prod account has had is 178 lookups / 1,318
        characters (user_translation_history, 2026-08-22). Ten times that must
        still go through, or the cap is a bug rather than a guard."""
        client = _client()
        words = ["translation"] * MAX_BATCH_ITEMS  # 11 chars each
        for _ in range(18):  # 1,800 lookups, ~19,800 characters
            assert client.post("/translate/batch", json=_batch(words)).status_code == 200


class TestBudgetRollover:
    def test_the_tally_resets_on_the_next_utc_day(self):
        clock = {"now": datetime(2026, 8, 22, 23, 59, tzinfo=timezone.utc)}
        budget = DailyCharBudget(100, scope="test", now=lambda: clock["now"])

        assert budget.reserve("user:1", 100) is True
        assert budget.reserve("user:1", 1) is False

        clock["now"] += timedelta(minutes=2)  # past midnight UTC
        assert budget.reserve("user:1", 100) is True

    def test_a_rejected_reservation_charges_nothing(self):
        budget = DailyCharBudget(100, scope="test")
        assert budget.reserve("user:1", 60) is True
        assert budget.reserve("user:1", 60) is False
        # The refused 60 must not have been banked, or a caller could be
        # locked out by requests that were never served.
        assert budget.spent("user:1") == 60
        assert budget.reserve("user:1", 40) is True

    def test_retry_after_points_at_midnight_utc(self):
        now = datetime(2026, 8, 22, 23, 0, tzinfo=timezone.utc)
        assert seconds_until_utc_midnight(now) == 3600
        # Never zero: "retry immediately" is the one answer that is never true.
        assert seconds_until_utc_midnight(
            datetime(2026, 8, 22, 23, 59, 59, 900000, tzinfo=timezone.utc)
        ) >= 1

    def test_stale_days_are_swept(self):
        clock = {"now": datetime(2026, 8, 22, 12, 0, tzinfo=timezone.utc)}
        budget = DailyCharBudget(10, scope="test", now=lambda: clock["now"])
        for i in range(budget._GC_THRESHOLD + 1):
            budget.reserve(f"user:{i}", 1)
        assert len(budget._spent) > budget._GC_THRESHOLD

        clock["now"] += timedelta(days=1)
        budget.reserve("user:new", 1)
        # Yesterday's keys no longer bind, so they must not be held forever.
        assert len(budget._spent) == 1


class TestDocumentedContract:
    def test_the_docstring_and_the_enforced_limits_agree(self):
        """They disagreed for the whole life of the endpoint: the docstring
        said 100 texts while the code enforced 2,000."""
        doc = translation_route.translate_batch.__doc__
        assert f"Max {MAX_BATCH_ITEMS} texts per request" in doc
        assert f"Each text max {MAX_TEXT_CHARS} characters" in doc
        assert f"{MAX_BATCH_CHARS:,} characters per request" in doc
        # The daily budget is deliberately not named as a number here: it is
        # settings-driven so it can be raised in Railway without a deploy, and
        # a docstring quoting 50,000 would go stale the moment it was.
        assert "translation_daily_char_budget" in doc

    def test_the_daily_budget_can_be_raised_without_a_deploy(self):
        """A cost cap whose right value is still unknown must be operable.

        The mobile card's sentence translations have no usage history to size
        against, so if a real user is ever cut off the fix has to be a Railway
        variable, not a release.
        """
        from src.config import Settings

        assert "translation_daily_char_budget" in Settings.model_fields
        assert translation_route.DAILY_TRANSLATION_CHARS == DAILY_TRANSLATION_CHARS

    def test_the_only_repo_caller_still_fits(self):
        """frozen `frontend/`'s useTranslationQueue chunks at MAX_BATCH_SIZE
        and sends single words. If either cap dropped below what it sends,
        the web reader would start 422-ing."""
        from pathlib import Path

        source = (
            Path(__file__).resolve().parents[2]
            / "frontend/src/hooks/useTranslationQueue.ts"
        ).read_text()
        chunk_size = int(
            [line for line in source.splitlines() if "MAX_BATCH_SIZE =" in line][0]
            .split("=")[1]
            .split(";")[0]
        )
        assert chunk_size <= MAX_BATCH_ITEMS
        # Its items are single words; the longest word ever translated in prod
        # is 16 characters (user_translation_history, 2026-08-22).
        assert chunk_size * 100 <= MAX_BATCH_CHARS
