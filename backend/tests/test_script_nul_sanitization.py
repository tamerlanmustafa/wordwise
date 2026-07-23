"""
NUL/control-byte sanitization on the script write path (issue #88).

A script whose text carries a NUL byte can't go into a Postgres `text` column
(22021). The write raises, the fetch is classified transient, and the job fails
identically on all 6 retries before dying — a poison pill that silently drops a
film with a perfectly good script. `_save_to_database` must strip the bytes for
every source, not just the parsers that happen to normalize their own output.
"""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from src.services.script_ingestion_service import ScriptIngestionService
from src.utils.text_sanitize import sanitize_for_db, strip_control_chars


class _FakeTable:
    """Records what the service tried to persist, and rejects NUL like PG does."""

    def __init__(self, existing=None):
        self.existing = existing
        self.created = None
        self.updated = None

    @staticmethod
    def _reject_nul(data: dict) -> None:
        for key, value in data.items():
            if isinstance(value, str) and "\x00" in value:
                raise RuntimeError(
                    f'invalid byte sequence for encoding "UTF8": 0x00 (column {key})'
                )

    async def find_unique(self, where):
        return self.existing

    async def create(self, data):
        self._reject_nul(data)
        self.created = data
        return SimpleNamespace(
            id=1,
            movieId=data.get("movieId", 42),
            sourceUsed=data.get("sourceUsed"),
            cleanedScriptText=data.get("cleanedScriptText"),
            cleanedWordCount=data.get("cleanedWordCount"),
            isComplete=data.get("isComplete"),
            isTruncated=data.get("isTruncated"),
            processingMetadata=data.get("processingMetadata"),
        )

    async def update(self, where, data):
        self._reject_nul(data)
        self.updated = data
        return SimpleNamespace(
            id=7,
            movieId=where["movieId"],
            sourceUsed=data.get("sourceUsed"),
            cleanedScriptText=data.get("cleanedScriptText"),
            cleanedWordCount=data.get("cleanedWordCount"),
            isComplete=data.get("isComplete"),
            isTruncated=data.get("isTruncated"),
            processingMetadata=data.get("processingMetadata"),
        )


def _service(existing_script=None):
    svc = ScriptIngestionService(db=None)
    svc.db = SimpleNamespace(
        movie=_FakeTable(),
        moviescript=_FakeTable(existing=existing_script),
    )
    return svc


def _script_data(text: str, metadata: dict | None = None) -> dict:
    return {
        "cleaned_text": text,
        "word_count": len(text.split()),
        "is_valid": True,
        "is_complete": True,
        "is_truncated": False,
        "metadata": metadata if metadata is not None else {},
    }


# The exact shape that killed 'The Switch (2010)': a NUL mid-dialogue.
POISONED = "INT. APARTMENT - NIGHT\x00\n\nWALLY\nYou\x00 look great.\x0c"


async def test_create_strips_nul_from_script_text():
    svc = _service()

    result = await svc._save_to_database(
        movie_title="The Switch",
        movie_id=42,
        source_used="SUBTITLE_SRT",
        script_data=_script_data(POISONED),
    )

    saved = svc.db.moviescript.created["cleanedScriptText"]
    assert "\x00" not in saved
    assert "\x0c" not in saved
    assert "INT. APARTMENT - NIGHT" in saved
    assert "\n\n" in saved  # newlines/tabs survive — only control bytes go
    assert "\x00" not in result["cleaned_text"]


async def test_update_strips_nul_from_script_text():
    existing = SimpleNamespace(id=7, movieId=42)
    svc = _service(existing_script=existing)

    await svc._save_to_database(
        movie_title="The Switch",
        movie_id=42,
        source_used="SUBTITLE_SRT",
        script_data=_script_data(POISONED),
    )

    assert svc.db.moviescript.created is None
    assert "\x00" not in svc.db.moviescript.updated["cleanedScriptText"]


async def test_metadata_strings_are_sanitized():
    svc = _service()

    await svc._save_to_database(
        movie_title="The Switch",
        movie_id=42,
        source_used="STANDS4_API",
        script_data=_script_data(
            "clean text",
            metadata={"title": "The Sw\x00itch", "writer": "Allan Lo\x00eb", "year": 2010},
        ),
    )

    metadata = json.loads(svc.db.moviescript.created["processingMetadata"])
    assert metadata["title"] == "The Switch"
    assert metadata["writer"] == "Allan Loeb"
    assert metadata["year"] == 2010


async def test_new_movie_record_is_sanitized():
    """Movie title/description come from the same poisoned payload."""
    svc = _service()

    await svc._save_to_database(
        movie_title="The Sw\x00itch",
        movie_id=None,
        source_used="STANDS4_API",
        script_data=_script_data(
            "clean text",
            metadata={"title": "The Sw\x00itch", "year": "2010", "synopsis": "A wo\x00man..."},
        ),
    )

    created = svc.db.movie.created
    assert created["title"] == "The Switch"
    assert created["actualTitle"] == "The Switch"
    assert created["description"] == "A woman..."


async def test_clean_text_is_untouched():
    svc = _service()
    text = "INT. BAR - DAY\n\n\tKASSIE\nHello.\r\n"

    await svc._save_to_database(
        movie_title="Some Film",
        movie_id=42,
        source_used="SUBTITLE_VTT",
        script_data=_script_data(text),
    )

    assert svc.db.moviescript.created["cleanedScriptText"] == text


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("a\x00b", "ab"),
        ("a\x1fb", "ab"),
        ("a\x7fb", "ab"),
        ("keep\tthis\nand\rthis", "keep\tthis\nand\rthis"),
        ("héllo — ünicode ok", "héllo — ünicode ok"),
    ],
)
def test_strip_control_chars(raw, expected):
    assert strip_control_chars(raw) == expected


def test_sanitize_for_db_walks_nested_structures():
    payload = {
        "a\x00": ["x\x00", {"b": "y\x00"}, 3, None, True],
        "c": ("t\x00",),
    }

    assert sanitize_for_db(payload) == {
        "a": ["x", {"b": "y"}, 3, None, True],
        "c": ("t",),
    }
