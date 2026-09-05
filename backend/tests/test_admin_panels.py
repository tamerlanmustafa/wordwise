"""
The admin dashboard's per-page panels.

These exist because the single `/admin/stats` that used to back the whole
screen measured **5,487 ms p95** on prod (2026-09-05, from the access log),
against <200 ms for every other route the app calls. Two things caused it and
both are pinned here:

  - it answered every question on the screen whether or not you were looking at
    that part of it, so the cost of the slowest tile was the cost of opening
    admin at all;
  - its slowest question, "how many distinct words sit in each CEFR band", was
    asked of `word_classifications` — millions of rows, one per (script, word)
    — when the thing it is a question about is the lemma registry, which has
    one row per word.

So the assertions below are mostly about *which table* a panel reads and *how
many statements* it runs. That is unusual for a unit test and deliberate: the
output of these functions was never wrong, only slow, and a test that checks
only the output would have passed on the 5-second version.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

import pytest

from src.services import admin_panels as ap


class _FakeDb:
    """Records every statement and answers from a canned row list.

    Matching is by substring on the SQL so a test can say "the query that
    mentions lemmas" without pinning whitespace.
    """

    def __init__(self, answers: dict[str, list[dict]] | None = None, fail_on: str | None = None):
        self.answers = answers or {}
        self.fail_on = fail_on
        self.calls: list[str] = []

    async def query_raw(self, sql, *args):
        self.calls.append(sql)
        if self.fail_on and self.fail_on in sql:
            raise RuntimeError(f"relation does not exist: {self.fail_on}")
        for needle, rows in self.answers.items():
            if needle in sql:
                return rows
        return []

    def sql_mentioning(self, needle: str) -> list[str]:
        return [s for s in self.calls if needle in s]


def _normalised(sql: str) -> str:
    return re.sub(r"\s+", " ", sql).strip().lower()


# ── the registry, not the per-script table ──────────────────────────────────

class TestWordsComeFromTheRegistry:
    async def test_reads_lemmas_and_never_word_classifications(self):
        db = _FakeDb()

        await ap.words_panel(db)

        joined = _normalised(" ".join(db.calls))
        assert "from lemmas" in joined
        # The whole point of the change. `word_classifications` holds one row
        # per (script, word); counting distinct lemmas in it is the same
        # question asked of a table two orders of magnitude larger.
        assert "word_classifications" not in joined

    async def test_does_not_cast_the_cefr_enum_to_text(self):
        # #118: casting this particular enum column to text is what turned a
        # fast plan into a slow one. The bands are a fixed six-item list, so
        # `count(*) FILTER (WHERE cefr_level = '...')` needs no cast at all.
        db = _FakeDb()

        await ap.words_panel(db)

        assert "cefr_level::text" not in _normalised(" ".join(db.calls))

    async def test_counts_every_band_including_unknown(self):
        row = {f"lvl_{lvl.lower()}": i for i, lvl in enumerate(ap.REGISTRY_LEVELS)}
        row.update(total=100, defined=60, definition_skipped=1, sentence_skipped=2,
                   multi_word=3, ranked=4)
        db = _FakeDb({"FROM lemmas": [row]})

        panel = await ap.words_panel(db)

        # UNKNOWN is kept here and hidden on learner surfaces: this is the
        # screen where "how much have we failed to grade" is the question.
        assert set(panel["words_by_level"]) == set(ap.REGISTRY_LEVELS)
        assert "UNKNOWN" in panel["words_by_level"]

    async def test_missing_definitions_is_the_complement_of_written_ones(self):
        db = _FakeDb({"FROM lemmas": [{"total": 100, "defined": 73}]})

        panel = await ap.words_panel(db)

        assert panel["definitions_written"] == 73
        assert panel["definitions_missing"] == 27

    async def test_a_defined_count_above_the_total_cannot_go_negative(self):
        # Belt and braces: the two counts come from one scan so they cannot
        # actually disagree, but a negative backlog on a dashboard is worse
        # than a zero.
        db = _FakeDb({"FROM lemmas": [{"total": 10, "defined": 12}]})

        assert (await ap.words_panel(db))["definitions_missing"] == 0

    async def test_one_scan_of_lemmas_not_one_query_per_number(self):
        db = _FakeDb()

        await ap.words_panel(db)

        # Nine figures, one scan. The old endpoint made a round trip per count.
        assert len(db.sql_mentioning("FROM lemmas")) == 1


# ── films ───────────────────────────────────────────────────────────────────

class TestFilmsPanel:
    async def test_bands_the_score_rather_than_reading_a_stored_level(self, monkeypatch):
        # #103: the level is derived from difficulty_score on read, which is
        # what stops this screen disagreeing with the learner-facing shelves.
        monkeypatch.setattr(ap, "cefr_from_score", lambda s: "B2" if s == 50 else "C1")
        db = _FakeDb({
            "GROUP BY difficulty_score": [{"score": 50, "n": 3}, {"score": 70, "n": 2}],
            "SELECT\n          (SELECT count(*)::int FROM movies)": [
                {"total": 10, "processed": 8, "scored": 5}
            ],
        })

        panel = await ap.films_panel(db)

        assert panel["movies_by_level"]["B2"] == 3
        assert panel["movies_by_level"]["C1"] == 2

    async def test_unprocessed_is_stated_not_left_as_a_subtraction(self):
        db = _FakeDb({"(SELECT count(*)::int FROM movies)": [
            {"total": 4600, "processed": 4400, "scored": 4400}
        ]})

        panel = await ap.films_panel(db)

        assert panel["movies_unprocessed"] == 200

    async def test_more_processed_than_total_does_not_go_negative(self):
        db = _FakeDb({"(SELECT count(*)::int FROM movies)": [
            {"total": 5, "processed": 9, "scored": 5}
        ]})

        assert (await ap.films_panel(db))["movies_unprocessed"] == 0

    async def test_a_score_outside_every_band_is_dropped_not_miscounted(self, monkeypatch):
        monkeypatch.setattr(ap, "cefr_from_score", lambda s: None)
        db = _FakeDb({"GROUP BY difficulty_score": [{"score": -1, "n": 7}]})

        panel = await ap.films_panel(db)

        assert sum(panel["movies_by_level"].values()) == 0


# ── users ───────────────────────────────────────────────────────────────────

class TestUsersPanel:
    async def test_counts_every_subscription_tier(self):
        db = _FakeDb({"FROM users": [
            {"total": 10, "premium": 1, "trial": 2, "comped": 3, "free": 4}
        ]})

        panel = await ap.users_panel(db)

        assert (panel["premium"], panel["trial"], panel["comped"], panel["free"]) == (1, 2, 3, 4)

    async def test_activity_is_a_rolling_window_not_an_all_time_total(self):
        db = _FakeDb()

        await ap.users_panel(db)

        sql = _normalised(" ".join(db.calls))
        assert "interval '7 days'" in sql and "interval '30 days'" in sql

    async def test_survives_a_database_with_no_rows_at_all(self):
        panel = await ap.users_panel(_FakeDb())

        assert panel["users_total"] == 0


# ── workers ─────────────────────────────────────────────────────────────────

class TestWorkersPanel:
    async def test_reports_recent_activity_not_only_lifetime_totals(self):
        # A lifetime count cannot tell a worker that finished its backlog from
        # one that died holding a full queue — which is how the sentence worker
        # sat wedged for five days (#154) and the seed reported "0 new jobs" on
        # every restart for months.
        db = _FakeDb()

        await ap.workers_panel(db)

        sql = _normalised(" ".join(db.calls))
        assert "interval '24 hours'" in sql
        assert "interval '1 hour'" in sql

    async def test_spend_is_broken_out_per_worker_so_a_loop_is_attributable(self):
        db = _FakeDb({"AS calls": [
            {"context": "definition_worker", "calls": 12, "cost": 0.42,
             "last_at": datetime(2026, 9, 5, 12, 0, tzinfo=timezone.utc)},
            {"context": "sentence_worker", "calls": 3, "cost": 0.10, "last_at": None},
        ]})

        panel = await ap.workers_panel(db)

        assert panel["llm_24h"]["definition_worker"]["calls"] == 12
        assert panel["llm_24h"]["definition_worker"]["cost_usd"] == 0.42
        # A worker with no timestamp is idle, not broken.
        assert panel["llm_24h"]["sentence_worker"]["last_at"] is None

    async def test_a_silent_worker_still_reports_when_it_went_quiet(self):
        db = _FakeDb({"SELECT context, max(ts)": [
            {"context": "sentence_worker",
             "last_at": datetime(2026, 8, 1, tzinfo=timezone.utc)},
        ]})

        panel = await ap.workers_panel(db)

        # Nothing in the last 24h, but the page can still say "last seen 5
        # weeks ago" rather than a bare zero.
        assert panel["llm_last_seen"]["sentence_worker"].startswith("2026-08-01")

    async def test_missing_worker_tables_degrade_to_zero_not_a_500(self):
        # movie_jobs / api_events / rate_state are created by the worker's own
        # bootstrap, not by Prisma. On an environment where the worker has
        # never run they do not exist, and that is a blank row on a panel.
        db = _FakeDb(fail_on="movie_jobs")

        panel = await ap.workers_panel(db)

        assert panel["queue"]["done"] == 0
        assert panel["queue"]["last_done_at"] is None

    async def test_never_counts_the_multi_million_row_tables(self):
        # Not only for speed: a parallel plan on Railway asks for a shared
        # memory segment the container cannot always give it, which is what
        # killed the daily coverage snapshot silently for five days (#154).
        db = _FakeDb()

        await ap.workers_panel(db)

        sql = _normalised(" ".join(db.calls))
        assert "sentence_bank" not in sql
        assert "word_classifications" not in sql

    async def test_timestamps_serialise_the_same_from_datetimes_and_strings(self):
        db = _FakeDb({"max(finished_at)": [
            {"last_done_at": datetime(2026, 9, 5, 9, 30, tzinfo=timezone.utc),
             "last_queued_at": "2026-09-05T09:00:00+00:00",
             "next_run_at": None, "done_24h": 4},
        ]})

        panel = await ap.workers_panel(db)

        assert panel["queue"]["last_done_at"] == "2026-09-05T09:30:00+00:00"
        assert panel["queue"]["last_queued_at"] == "2026-09-05T09:00:00+00:00"
        assert panel["queue"]["next_run_at"] is None


# ── the panels as a set ─────────────────────────────────────────────────────

class TestEveryPanelIsCheap:
    """The screen is only fast because no single panel is allowed to be slow."""

    @pytest.mark.parametrize("panel", [ap.films_panel, ap.words_panel, ap.users_panel])
    async def test_a_panel_is_at_most_two_statements(self, panel):
        db = _FakeDb()

        await panel(db)

        assert len(db.calls) <= 2, f"{panel.__name__} runs {len(db.calls)} statements"

    @pytest.mark.parametrize(
        "panel", [ap.films_panel, ap.words_panel, ap.users_panel, ap.workers_panel]
    )
    async def test_a_panel_never_raises_on_an_empty_database(self, panel):
        # Every panel is one page of a dashboard. One missing table should cost
        # that page its numbers, never the whole screen.
        assert isinstance(await panel(_FakeDb()), dict)
