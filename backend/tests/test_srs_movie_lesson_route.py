"""
POST /srs/session/start?kind=movie_lesson — the route half of #166.

The composer's row-writing contract lives in test_session_kinds.py. Here we
pin what the ROUTE adds around it: the 422s for a malformed request, the
free daily cap that a scene test is exempt from (and must not spend), and
the no-padding rule. Same harness shape as test_srs_lemmatize_offload.py —
`start_session` is called directly with a fake Prisma client and everything
after hydration stubbed out.
"""
from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.routes import srs as srs_routes
from src.routes.srs import start_session
from src.services.session_kinds import MOVIE_LESSON_MAX_WORDS

NOW = datetime.now(timezone.utc)
FILM = 42


def _user_word(id, word, movie_id=FILM):
    return SimpleNamespace(
        id=id, word=word, movieId=movie_id, srsBox=1, srsDueAt=NOW,
    )


def _fake_db(*, movie_exists=True):
    """Enough of the Prisma client for the handler, plus a log of the writes
    it makes to `users` — the daily-cap stamp is the thing under test."""
    log: list = []

    async def count(where):
        return 0

    async def find_many(where=None, **kwargs):
        return []

    async def query_raw(sql, *args):
        return []

    async def user_update(where, data):
        log.append(("user.update", data))
        return None

    async def movie_find_unique(where):
        if not movie_exists:
            return None
        return SimpleNamespace(id=where["id"], title="Interstellar")

    db = SimpleNamespace(
        userword=SimpleNamespace(count=count, find_many=find_many),
        word=SimpleNamespace(find_many=find_many),
        movie=SimpleNamespace(find_many=find_many, find_unique=movie_find_unique),
        user=SimpleNamespace(update=user_update),
        query_raw=query_raw,
    )
    db.log = log
    return db


def _free_user(*, last_started):
    # No admin flag, no tier ⇒ `is_premium` says free. English native so the
    # translation step is skipped and the stubbed choice builder decides
    # which rows become cards.
    return SimpleNamespace(
        id=1, isAdmin=False, nativeLanguage="en", proficiencyLevel="B1",
        srsLastSessionStartedAt=last_started,
    )


def _stub_after_compose(monkeypatch, *, rows):
    """Pin the composer's output and neutralise everything downstream, while
    recording whether the route reached for padding."""
    calls: dict = {"compose": None, "pad": 0}

    async def compose(db, **kwargs):
        calls["compose"] = kwargs
        return list(rows), []

    async def pad(db, **kwargs):
        calls["pad"] += 1
        return []

    async def no_examples(db, lemmas):
        return {}

    async def no_pool(db, **kwargs):
        return {}

    async def identity_nlp(fn, words, *args, **kwargs):
        return {w: (w.lower(), None) for w in words}

    monkeypatch.setattr(srs_routes, "compose_for_kind", compose)
    monkeypatch.setattr(srs_routes, "_pad_with_fresh_level_lemmas", pad)
    monkeypatch.setattr(srs_routes, "_pad_with_fresh_reel_lemmas", pad)
    monkeypatch.setattr(srs_routes, "get_llm_examples_for_lemmas", no_examples)
    monkeypatch.setattr(srs_routes, "build_pool", no_pool)
    monkeypatch.setattr(srs_routes, "run_nlp", identity_nlp)
    monkeypatch.setattr(
        srs_routes, "build_translation_choices",
        lambda lemma, translations, **kwargs: [{"word": lemma, "is_correct": True}],
    )
    return calls


async def _start(db, user, **kwargs):
    params = dict(kind="movie_lesson", movie_id=FILM, list_id=None, words=["linger", "veer"])
    params.update(kwargs)
    return await start_session(current_user=user, db=db, **params)


# ---------------------------------------------------------------------------
# 1. Malformed requests are the client's problem, never a 500
# ---------------------------------------------------------------------------

async def test_unknown_movie_is_422(monkeypatch):
    _stub_after_compose(monkeypatch, rows=[])
    with pytest.raises(HTTPException) as exc:
        await _start(_fake_db(movie_exists=False), _free_user(last_started=None))
    assert exc.value.status_code == 422
    assert "movie_id" in str(exc.value.detail)


async def test_missing_movie_id_is_422(monkeypatch):
    _stub_after_compose(monkeypatch, rows=[])
    with pytest.raises(HTTPException) as exc:
        await _start(_fake_db(), _free_user(last_started=None), movie_id=None)
    assert exc.value.status_code == 422


@pytest.mark.parametrize("words", [None, [], ["", "   "]])
async def test_no_words_is_422(monkeypatch, words):
    _stub_after_compose(monkeypatch, rows=[])
    with pytest.raises(HTTPException) as exc:
        await _start(_fake_db(), _free_user(last_started=None), words=words)
    assert exc.value.status_code == 422
    assert "words" in str(exc.value.detail)


async def test_too_many_words_is_422(monkeypatch):
    _stub_after_compose(monkeypatch, rows=[])
    too_many = [f"w{i}" for i in range(MOVIE_LESSON_MAX_WORDS + 1)]
    with pytest.raises(HTTPException) as exc:
        await _start(_fake_db(), _free_user(last_started=None), words=too_many)
    assert exc.value.status_code == 422


async def test_duplicates_do_not_count_against_the_cap(monkeypatch):
    calls = _stub_after_compose(monkeypatch, rows=[_user_word(1, "w0")])
    repeated = [f"w{i % 3}" for i in range(MOVIE_LESSON_MAX_WORDS + 10)]
    resp = await _start(_fake_db(), _free_user(last_started=None), words=repeated)
    assert resp.kind == "movie_lesson"
    assert calls["compose"]["words"] == repeated, "the composer normalises; the route only counts"


# ---------------------------------------------------------------------------
# 2. Outside the free daily cap, and never spending it
# ---------------------------------------------------------------------------

async def test_free_user_past_the_daily_cap_still_gets_a_lesson(monkeypatch):
    # #161: a scene test is priced by energy, not by the one-Practice-a-day
    # cap. Same user, same day, Practice already done.
    _stub_after_compose(monkeypatch, rows=[_user_word(1, "linger"), _user_word(2, "veer")])
    db = _fake_db()

    resp = await _start(db, _free_user(last_started=NOW))

    assert resp.kind == "movie_lesson"
    assert [c.word for c in resp.cards] == ["linger", "veer"]
    assert resp.is_preview is True, "still a free user"


async def test_practice_stays_capped_for_that_same_user(monkeypatch):
    # Control: the exemption is per kind, not a hole in the gate.
    _stub_after_compose(monkeypatch, rows=[_user_word(1, "linger")])
    with pytest.raises(HTTPException) as exc:
        await _start(_fake_db(), _free_user(last_started=NOW), kind="practice", movie_id=None, words=None)
    assert exc.value.status_code == 402


async def test_a_lesson_does_not_stamp_the_daily_cap_fields(monkeypatch):
    # If it stamped `srsLastSessionStartedAt`, a free user's morning lesson
    # would lock them out of Practice for the rest of the day — the opposite
    # of "energy replaces the cap".
    _stub_after_compose(monkeypatch, rows=[_user_word(1, "linger")])
    db = _fake_db()

    await _start(db, _free_user(last_started=None))

    assert db.log == [], "no users.update at all for a movie_lesson"


async def test_previews_remaining_reports_the_practice_slot_untouched(monkeypatch):
    _stub_after_compose(monkeypatch, rows=[_user_word(1, "linger")])

    fresh = await _start(_fake_db(), _free_user(last_started=None))
    spent = await _start(_fake_db(), _free_user(last_started=NOW))

    assert fresh.previews_remaining == 1, "Practice slot still available today"
    assert spent.previews_remaining == 0, "Practice slot was already used today"


async def test_practice_still_stamps_and_spends_the_slot(monkeypatch):
    # Regression guard for the refactor of the stamp: the Practice path must
    # behave exactly as before.
    _stub_after_compose(monkeypatch, rows=[_user_word(1, "linger", movie_id=None)])
    db = _fake_db()

    resp = await _start(db, _free_user(last_started=None), kind="practice", movie_id=None, words=None)

    assert [op for op, _ in db.log] == ["user.update"]
    assert db.log[0][1]["srsLastSessionKind"] == "practice"
    assert resp.previews_remaining == 0


# ---------------------------------------------------------------------------
# 3. A scene test asks its own words and nothing else
# ---------------------------------------------------------------------------

async def test_a_short_lesson_is_never_padded(monkeypatch):
    calls = _stub_after_compose(monkeypatch, rows=[_user_word(1, "linger")])

    resp = await _start(_fake_db(), _free_user(last_started=None))

    assert len(resp.cards) == 1 < srs_routes.SESSION_SIZE
    assert calls["pad"] == 0, "a one-word scene must not become a ten-card session"


async def test_the_composer_receives_the_film_and_the_words(monkeypatch):
    calls = _stub_after_compose(monkeypatch, rows=[])

    await _start(_fake_db(), _free_user(last_started=None), words=["Linger", "veer"])

    assert calls["compose"]["kind"] == "movie_lesson"
    assert calls["compose"]["movie_id"] == FILM
    assert calls["compose"]["words"] == ["Linger", "veer"]


async def test_other_kinds_do_not_receive_the_lesson_arguments(monkeypatch):
    # `movie_id` is still sent by installed builds for the retired
    # movie_deep_dive tile; it must keep being ignored there.
    calls = _stub_after_compose(monkeypatch, rows=[])

    await _start(
        _fake_db(), _free_user(last_started=None),
        kind="movie_deep_dive", movie_id=FILM, words=None,
    )

    assert calls["compose"]["kind"] == "practice"
    assert calls["compose"]["movie_id"] is None
    assert calls["compose"]["words"] is None
