"""
Tests for src/services/cefr_registry.py — issue #119.

The classifier is script-sensitive in a way the word is not: its proper-noun
branch fires on capitalisation, so "Journey" opening a line of dialogue was
stored UNKNOWN for that script while `lemmas` — and every other script — had
it at A1. should_keep_word drops UNKNOWN, so 526,251 prod rows over 8,521
words never reached a movie vocabulary screen.

What matters and is asserted here:
1. An UNKNOWN classification adopts the level the registry already holds.
2. Rows that are not UNKNOWN are never touched — the registry does not get to
   overrule a level the classifier actually made.
3. Entries are REPLACED, not mutated: classify_word returns objects it keeps
   in _GLOBAL_CEFR_CACHE, so mutating one relabels that word for every other
   movie in the process.
4. One query for the whole script, one array parameter, and no query at all
   when nothing is UNKNOWN.
5. The lookup refuses `lemmas` rows that are themselves the classifier giving
   up (source='fallback', no confidence), which would re-import the #91 bucket.
6. Every write path into word_classifications calls it — the propagation
   failure that made #121 necessary.

No Postgres and no Prisma engine: the fake DB replays a fixed lemmas table.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from src.services.cefr_classifier import (
    CEFRLevel,
    ClassificationSource,
    WordClassification,
)
from src.services.cefr_registry import apply_registry_levels


class _FakeDB:
    """Records query_raw calls and replays a fixed lemmas registry."""

    def __init__(self, registry: dict[str, dict] | None = None):
        self.registry = registry or {}
        self.calls: list[tuple[str, tuple]] = []

    async def query_raw(self, sql: str, *args):
        self.calls.append((" ".join(sql.split()), args))
        requested = set(args[0]) if args else set()
        rows = []
        for lemma, row in self.registry.items():
            if lemma not in requested:
                continue
            # Mirror the SQL predicates the real query applies.
            if row["cefr_level"] == "UNKNOWN":
                continue
            if row["source"] == "fallback" and row["confidence"] < 0.5:
                continue
            rows.append({"lemma": lemma, "frequency_rank": None, **row})
        return rows

    async def find_many(self, *a, **kw):  # pragma: no cover - must never run
        raise AssertionError("whole-table load of a 41k-row registry")


def _unknown(word: str, lemma: str) -> WordClassification:
    """What the proper-noun branch stores for a capitalised known word."""
    return WordClassification(
        word=word,
        lemma=lemma,
        pos="",
        cefr_level=CEFRLevel.UNKNOWN,
        confidence=0.9,
        source=ClassificationSource.FALLBACK,
    )


def _registry(level: str, source: str = "efllex", confidence: float = 1.0) -> dict:
    return {"cefr_level": level, "confidence": confidence, "source": source}


# ---------------------------------------------------------------------------
# 1-2. Recovery, and what it must not touch
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_unknown_word_adopts_the_registry_level():
    """The issue's own example: "Journey" at the start of a line."""
    db = _FakeDB({"journey": _registry("A1")})
    classifications = [_unknown("Journey", "journey")]

    recovered = await apply_registry_levels(db, classifications)

    assert recovered == 1
    assert classifications[0].cefr_level == CEFRLevel.A1
    # confidence and source come with it, so the row can't claim the
    # proper-noun branch produced an A1.
    assert classifications[0].source == ClassificationSource.EFLLEX
    assert classifications[0].confidence == 1.0
    # Everything else about the row survives.
    assert classifications[0].word == "Journey"
    assert classifications[0].lemma == "journey"


@pytest.mark.asyncio
async def test_word_the_registry_cannot_place_stays_unknown():
    """A genuine proper noun has no registry entry and stays in the bucket."""
    db = _FakeDB({"journey": _registry("A1")})
    classifications = [_unknown("Fezziwig", "fezziwig")]

    recovered = await apply_registry_levels(db, classifications)

    assert recovered == 0
    assert classifications[0].cefr_level == CEFRLevel.UNKNOWN


@pytest.mark.asyncio
async def test_registry_never_overrules_a_real_classification():
    """
    Only UNKNOWN is recovered. A word the classifier actually placed keeps its
    level even where the registry disagrees — this fixes lost content, it does
    not relabel graded vocabulary.
    """
    db = _FakeDB({"betray": _registry("A1")})
    graded = WordClassification(
        word="betray",
        lemma="betray",
        pos="",
        cefr_level=CEFRLevel.B2,
        confidence=1.0,
        source=ClassificationSource.OXFORD_5000,
    )
    classifications = [graded]

    recovered = await apply_registry_levels(db, classifications)

    assert recovered == 0
    assert classifications[0] is graded
    assert classifications[0].cefr_level == CEFRLevel.B2


@pytest.mark.asyncio
async def test_frequency_rank_prefers_the_classifiers_own_measurement():
    """The registry's rank fills a gap; it never overwrites this script's."""
    db = _FakeDB({
        "courage": {**_registry("B1"), "frequency_rank": 999},
        "wander": {**_registry("A2"), "frequency_rank": 999},
    })
    measured = WordClassification(
        "Courage", "courage", "", CEFRLevel.UNKNOWN, 0.9,
        ClassificationSource.FALLBACK, frequency_rank=1234,
    )
    unmeasured = _unknown("Wander", "wander")
    classifications = [measured, unmeasured]

    await apply_registry_levels(db, classifications)

    assert classifications[0].frequency_rank == 1234
    assert classifications[1].frequency_rank == 999


# ---------------------------------------------------------------------------
# 3. Cache safety
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_entries_are_replaced_not_mutated():
    """
    classify_word returns the object it stored in _GLOBAL_CEFR_CACHE. Mutating
    it here would relabel that word for every other movie the process serves
    until restart — the trap the C2-spike fix in classify_text documents.
    """
    db = _FakeDB({"wander": _registry("A2")})
    cached = _unknown("Wander", "wander")
    classifications = [cached]

    await apply_registry_levels(db, classifications)

    assert classifications[0] is not cached
    assert cached.cefr_level == CEFRLevel.UNKNOWN
    assert cached.confidence == 0.9


# ---------------------------------------------------------------------------
# 4. One query per script
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_one_query_with_one_array_parameter():
    db = _FakeDB({"journey": _registry("A1"), "courage": _registry("B1")})
    classifications = [
        _unknown("Journey", "journey"),
        _unknown("Journeys", "journey"),  # same lemma, deduped in the lookup
        _unknown("Courage", "courage"),
    ]

    recovered = await apply_registry_levels(db, classifications)

    assert recovered == 3
    assert len(db.calls) == 1
    sql, args = db.calls[0]
    assert "ANY($1::text[])" in sql and "FROM lemmas" in sql
    assert len(args) == 1
    assert args[0] == ["courage", "journey"]


@pytest.mark.asyncio
async def test_no_unknown_words_means_no_query():
    db = _FakeDB({"journey": _registry("A1")})
    classifications = [
        WordClassification("journey", "journey", "", CEFRLevel.A1, 1.0,
                           ClassificationSource.EFLLEX)
    ]

    assert await apply_registry_levels(db, classifications) == 0
    assert db.calls == []


@pytest.mark.asyncio
async def test_empty_script_makes_no_query():
    db = _FakeDB({"journey": _registry("A1")})

    assert await apply_registry_levels(db, []) == 0
    assert db.calls == []


# ---------------------------------------------------------------------------
# 5. The registry is trusted only where it is a real classification
# ---------------------------------------------------------------------------

def test_lookup_excludes_the_registrys_own_give_up_rows():
    """
    `lemmas` rows with source='fallback' and confidence 0 are
    populate_lemma_registry's old A2 default for lemmas the classifier never
    placed ("adumbrate", "asse" — 83 in prod). Promoting UNKNOWN to those is
    re-importing #91's bucket under a different label.

    The deliberate whitelists share source='fallback' but carry real
    confidence (kids 0.95, informal slang 0.85), so the split is on
    confidence — as the #91 backfill also did it.
    """
    from src.services.cefr_registry import _REGISTRY_LOOKUP_SQL

    assert "NOT (source = 'fallback' AND confidence < 0.5)" in _REGISTRY_LOOKUP_SQL
    assert "cefr_level <> 'UNKNOWN'" in _REGISTRY_LOOKUP_SQL
    # No cast on the enum COLUMN in a predicate: `cefr_level::text = ...` is
    # what mis-planned the vocabulary queries in #118.
    assert "WHERE cefr_level::text" not in _REGISTRY_LOOKUP_SQL


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "registry_row",
    [
        _registry("A2", source="fallback", confidence=0.0),
        _registry("UNKNOWN", source="efllex", confidence=1.0),
    ],
)
async def test_junk_and_unknown_registry_rows_do_not_recover(registry_row):
    db = _FakeDB({"adumbrate": registry_row})
    classifications = [_unknown("Adumbrate", "adumbrate")]

    recovered = await apply_registry_levels(db, classifications)

    assert recovered == 0
    assert classifications[0].cefr_level == CEFRLevel.UNKNOWN


@pytest.mark.asyncio
async def test_deliberate_whitelist_levels_still_recover():
    """Kids whitelist (A2/0.95) and informal slang (B1/0.85) are real calls."""
    db = _FakeDB({
        "yippee": _registry("A2", source="fallback", confidence=0.95),
        "gonna": _registry("B1", source="fallback", confidence=0.85),
    })
    classifications = [_unknown("Yippee", "yippee"), _unknown("Gonna", "gonna")]

    assert await apply_registry_levels(db, classifications) == 2
    assert [c.cefr_level for c in classifications] == [CEFRLevel.A2, CEFRLevel.B1]


# ---------------------------------------------------------------------------
# 6. Every write path uses it
# ---------------------------------------------------------------------------

_ROUTES = Path(__file__).resolve().parents[1] / "src" / "routes"


def test_every_word_classification_write_path_reconciles_first():
    """
    Three route modules insert into word_classifications (cefr.py's slow path,
    admin.py's two reprocess endpoints, upload.py). A fix that lands in one of
    them and not the others is how #121 happened; here it would mean a
    freshly-ingested movie quietly re-creating the 526k dropped rows.

    books.py writes the separate book_word_classifications table, which #119
    did not measure — it is empty in prod.
    """
    writers = {
        path.name
        for path in sorted(_ROUTES.glob("*.py"))
        if "db.wordclassification.create_many" in path.read_text()
    }
    assert writers == {"admin.py", "cefr.py", "upload.py"}

    missing = [
        name
        for name in sorted(writers)
        if "apply_registry_levels" not in (_ROUTES / name).read_text()
    ]
    assert missing == [], (
        f"{missing} store classifications without reconciling them against "
        "the lemmas registry — UNKNOWN rows the registry can place are "
        "dropped from movie vocabulary by should_keep_word (#119)."
    )


def test_lemma_registry_does_not_default_to_a2():
    """
    populate_lemma_registry used to write A2 for any lemma the classifier
    never placed, at confidence 0 — the same "A2 as a dumping ground" defect
    #91 fixed in the classifier, and the reason the backfill has to exclude
    fallback rows at all.
    """
    from src.services import lemmatization_service

    source = Path(lemmatization_service.__file__).read_text()
    assert 'cls.get("cefr_level", "A2")' not in source
    assert 'cls.get("cefr_level") or "UNKNOWN"' in source


def test_backfill_migration_applies_the_same_rule():
    """
    The SQL and the service are two implementations of one rule (stored rows
    vs new ones). If they drift, prod and fresh ingests disagree again.
    """
    migration = (
        Path(__file__).resolve().parents[1]
        / "prisma"
        / "manual"
        / "2026_08_18_backfill_unknown_cefr_from_lemmas_issue_119.sql"
    )
    sql = migration.read_text()

    assert "wc.cefr_level = 'UNKNOWN'" in sql
    assert "l.cefr_level <> 'UNKNOWN'" in sql
    assert "NOT (l.source = 'fallback' AND l.confidence < 0.5)" in sql
    # Reversible: UNKNOWN is unrecoverable once overwritten.
    assert "backfill_119_unknown_snapshot" in sql
