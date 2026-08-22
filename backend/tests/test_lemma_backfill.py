"""
`POST /cefr/v2/backfill-lemmas` aggregates in Postgres instead of in the API
process (issue #145).

The endpoint is admin-only and runs as a FastAPI background task — which, for
an `async def`, means it runs *on the event loop*, so anything slow or large in
it stalls every other request on this single-process API. The old version was
both. Against prod today it would have:

  * read all 4,830,264 `word_classifications` rows (471 MB of heap) into Prisma
    model objects, to group them into 35,650 lemmas in Python;
  * read all 4,409 `movie_scripts` rows *including* `cleaned_script_text`
    (178 MB of text, ~42k characters a row) to build an int -> int map;
  * then issued two queries per classification row — ~9.6M round trips — to
    write the movie/lemma mappings.

All three are set operations, so they moved into SQL. What is protected here:

1. Nothing loads a whole table into the process. In particular the script query
   asks for `id` only; the script -> movie step is a JOIN, not a Python dict.
2. Scoring is unchanged: the same highest-confidence row wins, the same
   `total_movie_count`, the same `priority_score`, `word_forms`, `is_multi_word`.
3. Writes are chunked and bounded — one statement per 1,000 lemmas and per 100
   scripts — instead of one per row.
4. A re-run cannot roll back a re-graded lemma: `ON CONFLICT DO UPDATE` touches
   only the two derived columns, the same split the old create/update branch
   made.
5. The surviving Python work is one `run_cpu` hop for the whole batch, never one
   per lemma.
6. A static guard, because a whole-table load is *correct*, just ruinous — no
   assertion fails when one comes back.

No Postgres and no Prisma engine here: the fake DB records what it was asked.
Equivalence against a real Postgres was checked separately by replaying the old
Python algorithm over the same seeded data (304 lemmas, 4,692 mappings, zero
disagreements).
"""
from __future__ import annotations

import ast
import asyncio
import json
import re
import threading
from pathlib import Path

import pytest

from src.services import lemmatization_service as svc
from src.services.lemmatization_service import (
    LEMMA_UPSERT_CHUNK,
    MAPPING_SCRIPT_CHUNK,
    _BEST_CLASSIFICATION_SQL,
    _LEMMA_MOVIE_COUNT_SQL,
    _LEMMA_UPSERT_SQL,
    _MAPPING_INSERT_SQL,
    _SCRIPT_IDS_SQL,
    _build_lemma_upsert_payloads,
    backfill_lemmas_from_classifications,
    compute_priority_score,
)

_SERVICE = Path(__file__).resolve().parents[1] / "src" / "services" / "lemmatization_service.py"


def _squash(sql: str) -> str:
    return " ".join(sql.split())


# ---------------------------------------------------------------------------
# Fake DB
# ---------------------------------------------------------------------------

class _FakeDB:
    """Answers the three reads and records every statement it is handed."""

    def __init__(self, best_rows, count_rows, script_ids, inserted_per_chunk=7):
        self._best = best_rows
        self._counts = count_rows
        self._script_ids = script_ids
        self._inserted = inserted_per_chunk
        self.queries: list[tuple[str, tuple]] = []
        self.executes: list[tuple[str, tuple]] = []

    async def query_raw(self, sql, *args):
        self.queries.append((_squash(sql), args))
        if "JSONB_TO_RECORDSET" in sql:  # pragma: no cover - a read, never this
            raise AssertionError("upserts go through execute_raw")
        if "GROUP BY" in sql:
            return list(self._counts)
        if "movie_scripts" in sql:
            return [{"id": i} for i in self._script_ids]
        return list(self._best)

    async def execute_raw(self, sql, *args):
        self.executes.append((_squash(sql), args))
        return self._inserted

    # Anything that would pull a whole table is the bug this fixes.
    def __getattr__(self, name):  # pragma: no cover - must never run
        raise AssertionError(
            f"backfill reached the Prisma model API (db.{name}); the aggregation "
            "belongs in SQL"
        )


def _best_row(lemma, confidence=0.5, cefr="B1", rank=None, source="llm", pos=None):
    return {
        "lemma": lemma,
        "pos": pos,
        "cefr_level": cefr,
        "confidence": confidence,
        "source": source,
        "frequency_rank": rank,
    }


def _run(db):
    return asyncio.run(backfill_lemmas_from_classifications(db))


# ---------------------------------------------------------------------------
# 1. Nothing loads a whole table
# ---------------------------------------------------------------------------

def test_reads_only_the_three_aggregates():
    db = _FakeDB([_best_row("run")], [{"lemma": "run", "movie_count": 3}], [1])

    _run(db)

    assert len(db.queries) == 3
    assert [sql for sql, _ in db.queries] == [
        _squash(_BEST_CLASSIFICATION_SQL),
        _squash(_LEMMA_MOVIE_COUNT_SQL),
        _squash(_SCRIPT_IDS_SQL),
    ]


def test_script_query_never_asks_for_the_script_text():
    """
    The whole point of #145: two of the thirteen `movie_scripts` columns were
    wanted and Prisma selected all of them, `cleaned_script_text` included —
    4,409 rows x ~42k characters pulled into the API to build an int -> int
    map. Only `id` is needed now; `movie_id` comes from the JOIN.
    """
    assert _squash(_SCRIPT_IDS_SQL) == "SELECT id FROM movie_scripts ORDER BY id"
    assert "cleaned_script_text" not in _SCRIPT_IDS_SQL
    assert "*" not in _SCRIPT_IDS_SQL


def test_the_script_to_movie_map_is_a_join_not_a_dict():
    assert "JOIN movie_scripts ms ON ms.id = wc.script_id" in _squash(_MAPPING_INSERT_SQL)
    assert "ms.movie_id" in _MAPPING_INSERT_SQL


def test_aggregates_group_in_sql_rather_than_returning_every_row():
    best = _squash(_BEST_CLASSIFICATION_SQL)
    counts = _squash(_LEMMA_MOVIE_COUNT_SQL)

    # Highest confidence per lemma, decided by Postgres.
    assert "DISTINCT ON (LOWER(BTRIM(lemma)))" in best
    assert "ORDER BY LOWER(BTRIM(lemma)), confidence DESC" in best
    # movie_scripts.movie_id is UNIQUE, so distinct script_id is distinct movie.
    assert "COUNT(DISTINCT script_id)::int" in counts
    assert "GROUP BY 1" in counts
    # Blank lemmas were skipped by the old Python loop; they are skipped here.
    for sql in (best, counts):
        assert "WHERE BTRIM(lemma) <> ''" in sql


# ---------------------------------------------------------------------------
# 2. Scoring is unchanged
# ---------------------------------------------------------------------------

def test_scoring_matches_the_old_per_lemma_computation():
    best = [
        _best_row("run", cefr="A1", rank=12),
        _best_row("give up", cefr="C1", rank=None),
        _best_row("storm", cefr="B2", rank=4000),
    ]
    counts = [
        {"lemma": "run", "movie_count": 812},
        {"lemma": "storm", "movie_count": 5},
    ]

    (payload, rows), = _build_lemma_upsert_payloads(best, counts)
    by_lemma = {r["lemma"]: r for r in json.loads(payload)}

    assert rows == 3
    # total_lemmas is the size of the whole registry, as it was in the old loop.
    for r in best:
        assert by_lemma[r["lemma"]]["priority_score"] == compute_priority_score(
            frequency_rank=r["frequency_rank"],
            total_lemmas=len(best),
            cefr_level=r["cefr_level"],
        )
    assert by_lemma["run"]["movie_count"] == 812
    assert by_lemma["storm"]["movie_count"] == 5
    # A lemma the count query didn't return falls back to 0, not to a KeyError.
    assert by_lemma["give up"]["movie_count"] == 0


def test_word_forms_and_multi_word_are_derived_in_sql():
    """
    The old code wrote `wordForms=[lemma]` and `isMultiWord=" " in lemma`. Both
    are now expressions in the INSERT, so they can't be in the JSON payload —
    assert on the SQL instead, or nothing checks them at all.
    """
    upsert = _squash(_LEMMA_UPSERT_SQL)

    assert "TO_JSONB(ARRAY[r.lemma])" in upsert
    assert "POSITION(' ' IN r.lemma) > 0" in upsert


def test_payload_carries_every_column_the_insert_names():
    (payload, _), = _build_lemma_upsert_payloads(
        [_best_row("run", rank=3)], [{"lemma": "run", "movie_count": 2}]
    )
    row = json.loads(payload)[0]

    recordset = re.search(
        r"JSONB_TO_RECORDSET\(\$1::jsonb\) AS r\((.*?)\)", _squash(_LEMMA_UPSERT_SQL)
    ).group(1)
    declared = {part.split()[0] for part in recordset.split(",")}

    assert declared == set(row), f"payload keys {sorted(row)} vs SQL {sorted(declared)}"


def test_a_null_pos_or_rank_survives_as_json_null():
    """
    Every one of prod's 4.83M classifications has `pos IS NULL`, and
    `frequency_rank` is often null too. jsonb carries that through as SQL NULL;
    a typed-array parameter per column would not have, without extra care.
    """
    (payload, _), = _build_lemma_upsert_payloads(
        [_best_row("run", rank=None, pos=None)], []
    )

    assert '"pos": null' in payload
    assert '"frequency_rank": null' in payload


# ---------------------------------------------------------------------------
# 3. Writes are chunked and bounded
# ---------------------------------------------------------------------------

def test_lemma_upsert_is_chunked_not_one_statement_per_lemma():
    n = LEMMA_UPSERT_CHUNK * 2 + 1
    best = [_best_row(f"w{i}") for i in range(n)]
    counts = [{"lemma": f"w{i}", "movie_count": 1} for i in range(n)]
    db = _FakeDB(best, counts, [])

    _run(db)

    upserts = [(sql, args) for sql, args in db.executes if "JSONB_TO_RECORDSET" in sql]
    assert len(upserts) == 3
    assert [len(json.loads(args[0])) for _, args in upserts] == [
        LEMMA_UPSERT_CHUNK,
        LEMMA_UPSERT_CHUNK,
        1,
    ]
    # One jsonb parameter per statement, not one placeholder per column per row.
    assert all(len(args) == 1 for _, args in upserts)


def test_mapping_insert_is_chunked_by_script_and_passes_one_array():
    script_ids = list(range(1, MAPPING_SCRIPT_CHUNK * 2 + 4))
    db = _FakeDB([_best_row("run")], [{"lemma": "run", "movie_count": 1}], script_ids)

    _run(db)

    maps = [(sql, args) for sql, args in db.executes if "movie_lemma_mappings" in sql]
    assert len(maps) == 3
    assert [len(args[0]) for _, args in maps] == [
        MAPPING_SCRIPT_CHUNK,
        MAPPING_SCRIPT_CHUNK,
        3,
    ]
    # One int[] parameter, so a chunk can't approach the bind-parameter limit.
    assert all(len(args) == 1 and isinstance(args[0], list) for _, args in maps)
    assert "$1::int[]" in _squash(_MAPPING_INSERT_SQL)
    # Every script id is covered exactly once.
    assert sorted(i for _, args in maps for i in args[0]) == script_ids


def test_returns_the_number_of_lemmas_upserted():
    n = LEMMA_UPSERT_CHUNK + 5
    best = [_best_row(f"w{i}") for i in range(n)]
    db = _FakeDB(best, [], [1])

    assert _run(db) == n


def test_a_failed_chunk_does_not_abort_the_rest_of_the_backfill():
    """The old loop swallowed a per-lemma failure and carried on; a chunked
    write must not turn one bad chunk into a dead migration."""
    n = LEMMA_UPSERT_CHUNK + 5
    db = _FakeDB([_best_row(f"w{i}") for i in range(n)], [], [1])
    real_execute = db.execute_raw
    calls = {"n": 0}

    async def flaky(sql, *args):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("deadlock detected")
        return await real_execute(sql, *args)

    db.execute_raw = flaky

    assert _run(db) == 5  # the second chunk still landed
    assert any("movie_lemma_mappings" in sql for sql, _ in db.executes)


def test_an_empty_registry_writes_nothing():
    db = _FakeDB([], [], [])

    assert _run(db) == 0
    assert db.executes == []


# ---------------------------------------------------------------------------
# 4. A re-run must not roll back a re-graded lemma
# ---------------------------------------------------------------------------

def test_conflict_update_touches_only_the_derived_columns():
    """
    `lemmas` is also written by register_lemmas_for_movie and by the admin
    re-grading paths (#91, #119). The old code's `if existing:` branch updated
    only totalMovieCount and priorityScore for exactly that reason — an upsert
    that wrote the whole row would silently undo every re-grade the moment an
    admin re-ran the migration.
    """
    upsert = _squash(_LEMMA_UPSERT_SQL)
    do_update = upsert.split("DO UPDATE", 1)[1]

    assert "ON CONFLICT (lemma) DO UPDATE" in upsert
    updated = {m.group(1) for m in re.finditer(r"(\w+) = ", do_update)}
    assert updated == {"total_movie_count", "priority_score", "updated_at"}
    for preserved in ("cefr_level", "confidence", "source", "pos"):
        assert f"{preserved} = " not in do_update


def test_updated_at_is_set_explicitly():
    """Prisma's @updatedAt is applied by the client, not by the column default,
    and `lemmas.updated_at` is NOT NULL with no default — a raw INSERT that
    forgets it fails outright."""
    assert "updated_at" in _LEMMA_UPSERT_SQL
    assert "NOW()" in _LEMMA_UPSERT_SQL


def test_mapping_insert_keeps_existing_rows():
    assert "ON CONFLICT (movie_id, lemma_id) DO NOTHING" in _squash(_MAPPING_INSERT_SQL)
    assert "SELECT DISTINCT ms.movie_id" in _squash(_MAPPING_INSERT_SQL)


# ---------------------------------------------------------------------------
# 5-6. Offload, and the static guards
# ---------------------------------------------------------------------------

def test_scoring_runs_off_the_event_loop_exactly_once():
    """
    35.6k lemmas is ~17ms of scoring plus ~33ms of JSON serialization — past
    what the loop can absorb, and both belong in the *same* hop. A hop per
    lemma would be worse than doing it inline (see utils/offload).
    """
    n = LEMMA_UPSERT_CHUNK * 3
    db = _FakeDB([_best_row(f"w{i}") for i in range(n)], [], [1])
    threads: list[int] = []
    real = svc.__dict__["_build_lemma_upsert_payloads"]

    def spy(*args, **kwargs):
        threads.append(threading.get_ident())
        return real(*args, **kwargs)

    svc._build_lemma_upsert_payloads = spy
    try:
        _run(db)
    finally:
        svc._build_lemma_upsert_payloads = real

    assert len(threads) == 1, "one hop for the whole batch, not one per chunk"
    assert threads[0] != threading.get_ident(), "scoring ran on the event loop"


def test_serialization_happens_inside_the_offloaded_hop():
    """If json.dumps stayed on the caller's side the hop would only move a
    third of the cost off the loop."""
    (payload, _), = _build_lemma_upsert_payloads([_best_row("run")], [])

    assert isinstance(payload, str)


def test_no_whole_table_prisma_loads_left_in_the_backfill():
    """
    A `find_many()` with no arguments is correct, just ruinous — it comes back
    with every column of every row and nothing fails. Reading the source is the
    only way to notice one reappearing.
    """
    src = _SERVICE.read_text()
    offenders = re.findall(r"db\.\w+\.find_many\(\s*\)", src)

    assert offenders == [], (
        f"{offenders} loads a whole table into the API process; aggregate in SQL "
        "(issue #145)."
    )


def test_the_backfill_issues_no_query_inside_a_loop():
    """
    The original wrote mappings with two queries per classification row — ~9.6M
    round trips against prod. Nothing here may await the database once per item
    again; the chunk loops await once per *batch*, which is why the guard counts
    the calls rather than banning the shape outright.
    """
    tree = ast.parse(_SERVICE.read_text())
    fn = next(
        node for node in ast.walk(tree)
        if isinstance(node, ast.AsyncFunctionDef)
        and node.name == "backfill_lemmas_from_classifications"
    )

    awaited_db_calls = [
        node for node in ast.walk(fn)
        if isinstance(node, ast.Await)
        and isinstance(node.value, ast.Call)
        and isinstance(node.value.func, ast.Attribute)
        and node.value.func.attr in {"query_raw", "execute_raw"}
    ]

    # 3 reads + 1 upsert + 1 mapping insert, each written once.
    assert len(awaited_db_calls) == 5


@pytest.mark.parametrize("sql", [
    _BEST_CLASSIFICATION_SQL,
    _LEMMA_MOVIE_COUNT_SQL,
    _LEMMA_UPSERT_SQL,
    _MAPPING_INSERT_SQL,
    _SCRIPT_IDS_SQL,
])
def test_statements_bind_their_inputs(sql):
    """No lemma or id is ever interpolated into these strings."""
    assert "%" not in sql and "format(" not in sql
