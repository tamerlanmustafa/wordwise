"""
Issue #102: movies.script_text is dropped.

Three files have to agree or the column comes back to life in a way nothing
else would catch:

  * schema.prisma — the generated Prisma client SELECTs every column it names,
    so re-declaring `script_text` after the migration has run makes *every*
    movie read fail against prod, not just the write path.
  * prisma/manual/...issue_102.sql — the only thing that actually removes the
    column. Prisma has no migration history here (see prisma/manual/README.md),
    so nothing but this test ties the schema edit to the SQL.
  * schemas/movie.py + routes/movies.py — the write path. The field was an
    unbounded Optional[str] on an authenticated endpoint; it must not return.
"""
from __future__ import annotations

import re
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
MIGRATION = (
    BACKEND / "prisma" / "manual" / "2026_08_22_drop_movies_script_text_issue_102.sql"
)


def _movie_model_block() -> str:
    schema = (BACKEND / "prisma" / "schema.prisma").read_text()
    match = re.search(r"^model Movie \{(.*?)^\}", schema, re.S | re.M)
    assert match, "model Movie not found in schema.prisma"
    return match.group(1)


def test_schema_does_not_declare_script_text():
    block = _movie_model_block()
    fields = [
        line.split()[0]
        for line in block.splitlines()
        if line.strip() and not line.strip().startswith(("//", "@@"))
    ]
    assert "script_text" not in fields
    # The relation to the table that does hold script text is still there.
    assert "movieScripts" in fields


def test_migration_drops_the_column_idempotently():
    sql = MIGRATION.read_text()
    assert "ALTER TABLE movies DROP COLUMN IF EXISTS script_text;" in sql
    # It must run *after* the deploy: the old client still selects the column.
    assert "AFTER" in sql


def test_movie_create_has_no_script_text_field():
    from src.schemas.movie import MovieCreate

    assert "script_text" not in MovieCreate.model_fields


def test_create_movie_route_writes_no_script_text():
    """A field absent from the schema but still passed to db.movie.create
    would be a runtime Prisma error on the first admin call, which no unit
    test exercises — so assert on the source of the create payload."""
    source = (BACKEND / "src" / "routes" / "movies.py").read_text()
    create_call = source[source.index("async def create_movie") :]
    create_call = create_call[: create_call.index("return new_movie")]
    assert '"script_text"' not in create_call
