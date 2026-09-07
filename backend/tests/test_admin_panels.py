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
        #: (sql, args) per call. Kept alongside `calls` so the assertions that
        #: only care about SQL text stay readable; the paginated browser needs
        #: the binds, because its limit cap and offset clamp are applied to the
        #: parameters rather than to the query text.
        self.bound: list[tuple[str, tuple]] = []

    async def query_raw(self, sql, *args):
        self.calls.append(sql)
        self.bound.append((sql, args))
        if self.fail_on and self.fail_on in sql:
            raise RuntimeError(f"relation does not exist: {self.fail_on}")
        for needle, rows in self.answers.items():
            if needle in sql:
                return rows
        return []

    def sql_mentioning(self, needle: str) -> list[str]:
        return [s for s in self.calls if needle in s]

    def args_for(self, needle: str) -> tuple:
        """Binds of the first statement mentioning `needle`."""
        for sql, args in self.bound:
            if needle in sql:
                return args
        raise AssertionError(f"no statement mentioning {needle!r}")


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


# ── one level's words, for the tabs ─────────────────────────────────────────

def _word_row(lemma: str = "contingent", **over) -> dict:
    row = {
        "id": 1,
        "lemma": lemma,
        "pos": "NOUN",
        "cefr_level": "B2",
        "confidence": 0.55,
        "source": "frequency_backoff",
        "frequency_rank": 2041,
        "total_movie_count": 21,
        "has_definition": True,
        "hidden": False,
        "excluded_reason": None,
    }
    row.update(over)
    return row


class TestWordsByLevel:
    async def test_returns_one_page_with_the_row_shape_the_browser_renders(self):
        db = _FakeDb({"FROM lemmas": [_word_row()]})

        page = await ap.words_by_level(db, level="B2")

        assert page["level"] == "B2"
        assert page["sort"] == "frequency"
        assert page["offset"] == 0
        assert page["words"][0] == {
            "id": 1,
            "lemma": "contingent",
            "pos": "NOUN",
            "cefr_level": "B2",
            "confidence": 0.55,
            "source": "frequency_backoff",
            "frequency_rank": 2041,
            "movie_count": 21,
            "has_definition": True,
            "hidden": False,
            "excluded_reason": None,
        }

    async def test_has_more_comes_from_an_over_fetch_not_a_count(self):
        # limit+1 rows come back and the extra is dropped. Asserted on an
        # append, where the band's `total` is not computed, so the only COUNT
        # that could appear would be one paging needed — and none does.
        db = _FakeDb({"FROM lemmas": [_word_row(f"w{i}", id=i) for i in range(4)]})

        page = await ap.words_by_level(db, level="B2", limit=3, offset=40)

        assert page["has_more"] is True
        assert len(page["words"]) == 3
        assert "count(" not in _normalised(" ".join(db.calls))

    async def test_a_short_page_is_the_last_page(self):
        db = _FakeDb({"FROM lemmas": [_word_row(f"w{i}", id=i) for i in range(2)]})

        page = await ap.words_by_level(db, level="B2", limit=3)

        assert page["has_more"] is False
        assert len(page["words"]) == 2

    async def test_all_can_still_serve_what_every_learner_reader_filters_out(self):
        # The point of keeping a third slice. `trusted_registry_sql` and the
        # hidden_words exclusion are what keep an ungraded or curated-away word
        # off a learner's screen; `all` is how an admin finds exactly those.
        # (`excluded_reason` names them in the projection, hence the split.)
        db = _FakeDb()

        await ap.words_by_level(db, level="A2", visibility="all")

        where = _normalised(" ".join(db.calls)).split("case")[0]
        assert "confidence < 0.5" not in where
        assert "not exists" not in where

    async def test_projects_the_signals_that_expose_an_ungraded_row(self):
        # source + confidence are how 3,850 fake-A2 rows would have been
        # visible on this page instead of needing a DB session to find.
        db = _FakeDb()

        await ap.words_by_level(db, level="A2")

        sql = _normalised(" ".join(db.calls))
        for column in ("l.source::text", "l.confidence", "hidden", "has_definition"):
            assert column.lower() in sql

    async def test_filters_the_level_without_casting_the_enum(self):
        # #118 again: the cast that mis-plans is the one in the predicate.
        # Projecting `cefr_level::text` shapes the row, not the plan.
        db = _FakeDb()

        await ap.words_by_level(db, level="C1")

        sql = _normalised(" ".join(db.calls))
        assert "where l.cefr_level = 'c1'" in sql
        assert "where l.cefr_level::text" not in sql

    @pytest.mark.parametrize("sort", sorted(ap.WORD_SORTS))
    async def test_every_offered_sort_is_accepted(self, sort):
        db = _FakeDb()

        page = await ap.words_by_level(db, level="B2", sort=sort)

        assert page["sort"] == sort

    async def test_an_unknown_sort_is_refused_rather_than_interpolated(self):
        db = _FakeDb()

        with pytest.raises(ValueError):
            await ap.words_by_level(db, level="B2", sort="lemma; DROP TABLE lemmas")

    async def test_an_unknown_level_is_refused(self):
        # The level IS interpolated (it is an enum literal), so the allowlist
        # is the only thing between a caller and the query text.
        db = _FakeDb()

        with pytest.raises(ValueError):
            await ap.words_by_level(db, level="A2' OR '1'='1")

    async def test_the_holding_pen_is_a_browsable_level(self):
        # UNKNOWN is where every unplaceable word lands (#91), so it is the
        # band an admin most needs to be able to read.
        db = _FakeDb({"FROM lemmas": [_word_row(cefr_level="UNKNOWN")]})

        page = await ap.words_by_level(db, level="UNKNOWN")

        assert page["level"] == "UNKNOWN"

    async def test_page_size_is_capped(self):
        db = _FakeDb()

        await ap.words_by_level(db, level="B2", limit=10_000)

        # The cap is applied to the bind, not the SQL text.
        assert db.args_for("FROM lemmas")[0] == ap.WORD_PAGE_MAX + 1

    async def test_a_negative_offset_is_clamped(self):
        db = _FakeDb()

        page = await ap.words_by_level(db, level="B2", offset=-5)

        assert page["offset"] == 0
        assert db.args_for("FROM lemmas")[1] == 0

    async def test_defaults_to_what_a_learner_can_see(self):
        # The registry is 1.6x the servable set (prod 2026-09-07: 42,998 vs
        # 27,209), so listing it raw overstates every band.
        db = _FakeDb()

        page = await ap.words_by_level(db, level="B2")

        assert page["visibility"] == "learner"
        assert "sll.is_global" in _normalised(" ".join(db.calls))

    async def test_the_learner_slice_is_the_feeds_own_predicate(self):
        # Not a restatement of it. A second definition of "eligible" is exactly
        # the drift this browser was built to expose.
        from src.services.feed_pool import feed_eligibility_sql

        assert feed_eligibility_sql("l") in ap.word_filter_sql("learner", "l")[0]

    async def test_removed_is_the_exact_complement_of_learner(self):
        from src.services.feed_pool import feed_eligibility_sql

        assert ap.word_filter_sql("removed", "l")[0] == f"NOT ({feed_eligibility_sql('l')})"

    async def test_all_applies_no_filter(self):
        db = _FakeDb()

        await ap.words_by_level(db, level="B2", visibility="all")

        sql = _normalised(" ".join(db.calls))
        assert "sll.is_global" not in sql.split("case")[0]

    async def test_an_unknown_visibility_is_refused(self):
        db = _FakeDb()

        with pytest.raises(ValueError):
            await ap.words_by_level(db, level="B2", visibility="everything")

    @pytest.mark.parametrize("name", ap.WORD_FILTERS)
    async def test_every_offered_filter_builds_and_runs(self, name):
        db = _FakeDb({"FROM lemmas": [_word_row()]})

        page = await ap.words_by_level(db, level="B2", visibility=name)

        assert page["visibility"] == name
        assert ap.WORDS_PARAM not in " ".join(db.calls)

    @pytest.mark.parametrize("name", ["slur", "profane"])
    async def test_the_word_lists_are_bound_not_interpolated(self, name):
        # 443 quoted literals in the statement text would be a quoting bug
        # waiting to happen, and would defeat the plan cache.
        db = _FakeDb()

        await ap.words_by_level(db, level="B2", visibility=name)

        sql = " ".join(db.calls)
        assert "= ANY($1::text[])" in sql
        assert "'faggot'" not in sql
        words = db.args_for("FROM lemmas")[0]
        assert isinstance(words, list) and len(words) > 50

    @pytest.mark.parametrize("name", ["slur", "profane"])
    async def test_a_bound_filter_shifts_limit_and_offset(self, name):
        # The filter's params come first, so LIMIT/OFFSET are $2/$3 rather than
        # $1/$2. Getting this wrong binds the array to LIMIT.
        db = _FakeDb()

        await ap.words_by_level(db, level="B2", visibility=name, limit=7, offset=14)

        list_sql = next(s for s in db.calls if "count(*)" not in s)
        assert "LIMIT $2 OFFSET $3" in list_sql
        _, take, start = db.args_for("ORDER BY")
        assert (take, start) == (8, 14)

    async def test_an_unbound_filter_leaves_limit_and_offset_first(self):
        db = _FakeDb()

        await ap.words_by_level(db, level="B2", visibility="hidden", limit=7, offset=14)

        list_sql = next(s for s in db.calls if "count(*)" not in s)
        assert "LIMIT $1 OFFSET $2" in list_sql
        assert db.args_for("ORDER BY") == (8, 14)

    async def test_slur_is_a_subset_of_profane(self):
        from src.services.profanity_filter import BLOCKED_WORDS, slur_forms

        assert slur_forms() <= BLOCKED_WORDS

    async def test_the_offensive_filters_are_not_scoped_to_removed(self):
        # They answer "is anything we refuse to teach still reachable", which
        # a subset of `removed` cannot express: a slur that is NOT removed is
        # exactly the row worth finding.
        sql, _ = ap.word_filter_sql("slur", "l")

        assert "sll.is_global" not in sql
        assert "hidden_words" not in sql

    @pytest.mark.parametrize(
        "name,reason",
        [
            ("unknown", "unknown_level"),
            ("ungraded", "ungraded"),
            ("short", "shape"),
            ("hidden", "curated_away"),
            ("no_sentence", "no_sentence"),
        ],
    )
    async def test_each_single_cause_filter_matches_its_exclusion_branch(self, name, reason):
        # The filter and the row's `excluded_reason` must agree about what e.g.
        # "hidden" means, or filtering to a reason returns rows labelled with a
        # different one.
        def squash(sql: str) -> str:
            # Whitespace-free: the CASE branch and the filter are written in
            # different layouts, and only the logic has to match.
            return "".join(sql.split()).strip("()")

        frag, _ = ap.word_filter_sql(name, "l")
        case = "".join(ap.excluded_reason_sql("l").split())
        branch = case.split(f"THEN'{reason}'")[0].split("WHEN")[-1]

        assert squash(frag) == squash(branch)

    async def test_counts_the_band_only_on_the_first_page(self):
        # The count costs 10-49ms and is the same for every page of a band, so
        # an append must not pay it again.
        first = _FakeDb({"FROM lemmas": [_word_row()]})
        await ap.words_by_level(first, level="B2", offset=0)
        assert len([s for s in first.calls if "count(*)" in s]) == 1

        later = _FakeDb({"FROM lemmas": [_word_row()]})
        page = await ap.words_by_level(later, level="B2", offset=40)
        assert [s for s in later.calls if "count(*)" in s] == []
        assert page["total"] is None

    async def test_the_count_and_the_list_share_one_where_clause(self):
        # A total computed from a different predicate than the rows is a number
        # that disagrees with the list under it.
        db = _FakeDb()

        await ap.words_by_level(db, level="C1", visibility="removed")

        count_sql = next(s for s in db.calls if "count(*)" in s)
        list_sql = next(s for s in db.calls if "count(*)" not in s)
        where = f"l.cefr_level = 'C1' AND {ap.word_filter_sql('removed')[0]}"
        assert where in count_sql
        assert where in list_sql

    async def test_every_row_reports_whether_a_learner_can_reach_it(self):
        db = _FakeDb({"FROM lemmas": [_word_row(excluded_reason="curated_away")]})

        page = await ap.words_by_level(db, level="B2", visibility="removed")

        assert page["words"][0]["excluded_reason"] == "curated_away"

    async def test_a_visible_row_has_no_exclusion_reason(self):
        db = _FakeDb({"FROM lemmas": [_word_row(excluded_reason=None)]})

        page = await ap.words_by_level(db, level="B2")

        assert page["words"][0]["excluded_reason"] is None

    async def test_the_exclusion_reason_names_the_most_fundamental_filter(self):
        # A row can fail several tests; the CASE is ordered so it reports the
        # one worth acting on. UNKNOWN outranks "no sentence yet".
        frag = _normalised(ap.excluded_reason_sql("l"))
        for earlier, later in (
            ("unknown_level", "ungraded"),
            ("ungraded", "shape"),
            ("shape", "curated_away"),
            ("curated_away", "no_sentence"),
        ):
            assert frag.index(earlier) < frag.index(later)

    async def test_a_failed_query_raises_instead_of_reporting_an_empty_band(self):
        # The panels degrade a broken query to [] on purpose — a missing
        # worker table is a missing stat. A *list* must not: "no words in A2"
        # is a claim, and a dev database missing `lemmas.definition` made that
        # claim about a band holding 98,192 rows. An admin has to be able to
        # tell "empty" from "broken".
        db = _FakeDb(fail_on="FROM lemmas")

        with pytest.raises(RuntimeError):
            await ap.words_by_level(db, level="A2")


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
