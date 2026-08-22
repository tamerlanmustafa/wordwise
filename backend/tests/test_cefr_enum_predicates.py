"""
Guard against `cefr_level::text` reappearing in a WHERE clause (issue #118).

`cefr_level` is a `proficiencylevel` enum column. Casting it to text in a
predicate turns the column reference into an expression, which costs twice:

  * the planner has no statistics for the expression and falls back to a
    hardcoded guess. On `word_classifications` (4.8M rows) that was 23,870
    estimated against 473,861 actual — a 20x under-estimate that then chose
    nested loops sized for a handful of rows.
  * the b-tree index on the column can no longer supply an Index Cond, so a
    matching scan reads the whole index and filters. Measured on prod:
    5,512 buffers / 147ms with the cast, 414 buffers / 8.3ms without.

The fix is to compare against the enum — inlining validated labels, or casting
the *parameter* with `$n::proficiencylevel`. The cast is still fine in a SELECT
list, where it is only output formatting, and in a GROUP BY that references the
bare column.

Source-level assertions because the pytest suite has no database.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parents[1] / "src"

# Files that build raw SQL touching cefr_level.
SQL_MODULES = [
    SRC / "routes" / "srs.py",
    SRC / "routes" / "quiz.py",
    SRC / "routes" / "movies.py",
    SRC / "services" / "lists.py",
]

# `WHERE`/`AND`/`OR` followed by an optional alias, then the cast.
PREDICATE_CAST = re.compile(
    r"\b(?:WHERE|AND|OR)\s+(?:\w+\.)?cefr_level\s*::\s*text",
    re.IGNORECASE,
)

# Any cast of the column to text, wherever it appears.
ANY_CAST = re.compile(r"(?:\w+\.)?cefr_level\s*::\s*text", re.IGNORECASE)

# A SELECT-list projection — `cefr_level::text AS something`. Allowed.
PROJECTION_CAST = re.compile(
    r"(?:\w+\.)?cefr_level\s*::\s*text\s+AS\s+\w+",
    re.IGNORECASE,
)


def _strip_comments(source: str) -> str:
    """Drop `#` comment lines so prose about the trap doesn't trip the regex."""
    return "\n".join(
        line for line in source.splitlines() if not line.lstrip().startswith("#")
    )


@pytest.mark.parametrize("path", SQL_MODULES, ids=lambda p: p.name)
def test_no_enum_to_text_cast_in_a_predicate(path: Path):
    source = _strip_comments(path.read_text())
    offenders = PREDICATE_CAST.findall(source)
    assert not offenders, (
        f"{path.name} filters on cefr_level::text, which discards the column's "
        f"statistics and its index. Compare against the enum instead: inline a "
        f"validated label, or cast the parameter ($n::proficiencylevel). "
        f"Found: {offenders}"
    )


@pytest.mark.parametrize("path", SQL_MODULES, ids=lambda p: p.name)
def test_remaining_casts_are_select_list_projections(path: Path):
    """Every surviving `::text` should be output formatting, not a filter."""
    source = _strip_comments(path.read_text())
    for match in ANY_CAST.finditer(source):
        tail = source[match.start(): match.start() + 60]
        assert PROJECTION_CAST.match(tail), (
            f"{path.name} casts cefr_level to text outside a SELECT list: "
            f"{tail.splitlines()[0]!r}"
        )


def test_band_placeholders_cast_the_parameter_not_the_column():
    """Both band builders must emit `$n::proficiencylevel`."""
    for path in (SRC / "routes" / "srs.py", SRC / "routes" / "quiz.py"):
        source = path.read_text()
        assert 'f"${i + 4}::proficiencylevel"' in source, (
            f"{path.name} builds CEFR band placeholders without casting them to "
            f"the enum, so the query would have to cast the column instead."
        )


def test_journey_query_casts_the_level_parameter():
    # Aliased since #127 moved the deck off word_classifications onto the
    # `lemmas` registry; the invariant is unchanged — cast the parameter, so
    # the column stays a bare enum the index can seek on.
    source = (SRC / "routes" / "quiz.py").read_text()
    assert "WHERE l.cefr_level = $1::proficiencylevel" in source


def test_feed_candidate_query_compares_the_bare_enum_column():
    source = (SRC / "routes" / "srs.py").read_text()
    assert "WHERE l.cefr_level IN ({levels_sql})" in source


def test_inlined_levels_are_always_valid_enum_labels():
    """The feed inlines `levels` into SQL, so a bare enum comparison is only
    safe while every label the callers can produce is a real enum label."""
    from src.routes.srs import _CEFR_ORDER, _band_levels_around

    enum_labels = {"A1", "A2", "B1", "B2", "C1", "C2", "UNKNOWN"}
    assert set(_CEFR_ORDER) <= enum_labels

    # Including the fallback path for an unrecognised level.
    for level in list(_CEFR_ORDER) + ["", "nonsense", "b1"]:
        assert set(_band_levels_around(level)) <= enum_labels
