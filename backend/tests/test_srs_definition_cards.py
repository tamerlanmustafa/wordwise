"""
`POST /srs/session/start` asks the 4th and 8th question as definition cards.

WHAT WAS BROKEN

The definition card shipped behind two conditions and neither one held.

1. Its gloss was read from the legacy `words` table — `db.word.find_many`.
   That table holds **zero rows in prod**, so `def_map` was always empty,
   `base["definition"]` was always None, and the card could never be built.
   Not rarely: never, in any session, since the feature landed. The gloss the
   rest of the app shows has always come from `lemmas.definition` (27,946 of
   42,998 lemmas in prod), and nothing tied the two reads together.
2. Even with a gloss, placement was greedy: a single pass over rows asked
   "is this the 4th card?" of whichever row happened to arrive fourth. That is
   a different question from "make the 4th card a definition", and it made the
   session's shape a property of composer ordering.

Both failures are invisible from inside a unit test of either half —
`build_definition_choices` was correct the whole time, and so was
`is_definition_slot`. The defect lived in the composition, which is why these
tests drive the handler.

spaCy and Postgres are both absent from the CI env, so the parser and the
Prisma client are faked. These tests are about which card lands on which slot
and where its gloss came from, not about linguistics.
"""
from __future__ import annotations

import threading
from datetime import datetime, timezone
from types import SimpleNamespace

from src.routes import srs as srs_routes
from src.routes.srs import SESSION_SIZE, start_session
from src.services import lemmatization_service


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------

#: Ten headwords with a registry gloss, plus four glossless ones standing in
#: for the session headroom. Deliberately unrelated words: the distractor pool
#: below must be able to fill four grids without reaching for a near-form.
GLOSSED = [
    "ravenous", "belligerent", "fastidious", "querulous", "laconic",
    "tenacious", "sanguine", "obdurate", "candid", "vapid",
]
GLOSSLESS = ["zulu", "yankee", "xray", "whiskey"]

#: Registry lemmas outside the deck — where a definition card's wrong answers
#: come from in prod.
POOL = [
    "verbose", "morose", "jocular", "pensive", "brusque", "affable",
    "dour", "genial", "irate", "placid", "sullen", "wistful",
]


class _FakeToken:
    def __init__(self, text: str, lemma: str, pos: str):
        self.text, self.lemma_, self.pos_ = text, lemma, pos


class _FakeNlp:
    """Every form is its own lemma here — the dedupe/lemmatization path has its
    own tests in test_srs_lemmatize_offload.py."""

    def _parse(self, text: str):
        return [_FakeToken(text, text.lower(), "ADJ")]

    def __call__(self, text):
        return self._parse(text)

    def pipe(self, texts):
        return [self._parse(t) for t in texts]


class _FakeTranslationService:
    """Every deck word translates, so a card only becomes a definition card
    because the slot asked for it — never because the translation path had
    nothing to offer. That separation is the whole point: the rescue path
    (a word with no translation) already worked."""

    def __init__(self, db):
        self._db = db

    async def batch_translate(self, *, texts, target_lang, source_lang, user_id):
        return [{"translated": f"{t}-tr"} for t in texts]


def _user_word(id: int, word: str):
    return SimpleNamespace(
        id=id,
        word=word,
        movieId=None,
        srsBox=1,
        srsDueAt=datetime.now(timezone.utc),
    )


def _fake_db(*, glossed=()):
    """Enough of the Prisma client for session start.

    `word` (the legacy table) always answers empty — exactly as prod does —
    so any definition card these tests see came from the registry.
    """
    glossed = set(glossed)

    async def count(where):
        return len(glossed)

    async def empty(where=None, **kwargs):
        return []

    async def lemma_find_many(where=None, **kwargs):
        wanted = (where or {}).get("lemma", {}).get("in", [])
        return [
            SimpleNamespace(lemma=w, definition=f"means {w}")
            for w in wanted
            if w in glossed
        ]

    async def query_raw(sql, *args):
        return []

    async def update(where, data):
        return None

    return SimpleNamespace(
        userword=SimpleNamespace(count=count, find_many=empty),
        word=SimpleNamespace(find_many=empty),
        lemma=SimpleNamespace(find_many=lemma_find_many),
        movie=SimpleNamespace(find_many=empty),
        user=SimpleNamespace(update=update),
        query_raw=query_raw,
    )


def _stub(monkeypatch, *, due, pool=POOL):
    monkeypatch.setattr(lemmatization_service, "get_nlp", _FakeNlp)

    async def compose(db, **kwargs):
        return list(due), []

    async def pad(db, **kwargs):
        return []

    async def no_examples(db, lemmas):
        return {}

    async def no_translation_pool(db, **kwargs):
        # A cold `translation_cache`, so translation distractors come from the
        # deck. Keeps the assertions about *definition* options unambiguous.
        return {}

    async def lemma_pool(db, **kwargs):
        # One bucket, reached through `pool_for`'s widening ladder whatever the
        # card's (pos, level) turns out to be.
        return {("ADJ", "B2"): list(pool)}

    async def levels(db, words):
        return {w.lower(): "B2" for w in words}

    async def poses(db, words):
        return {w.lower(): "ADJ" for w in words}

    monkeypatch.setattr(srs_routes, "compose_for_kind", compose)
    monkeypatch.setattr(srs_routes, "_pad_with_fresh_level_lemmas", pad)
    monkeypatch.setattr(srs_routes, "_pad_with_fresh_reel_lemmas", pad)
    monkeypatch.setattr(srs_routes, "get_llm_examples_for_lemmas", no_examples)
    monkeypatch.setattr(srs_routes, "build_pool", no_translation_pool)
    monkeypatch.setattr(srs_routes, "build_lemma_pool", lemma_pool)
    monkeypatch.setattr(srs_routes, "registry_levels", levels)
    monkeypatch.setattr(srs_routes, "registry_pos", poses)
    monkeypatch.setattr(srs_routes, "TranslationService", _FakeTranslationService)


def _premium_user():
    # Admin ⇒ premium ⇒ the free daily cap never fires, and nativeLanguage is
    # not English so the translation MCQ is on the table for every card.
    return SimpleNamespace(
        id=1, isAdmin=True, nativeLanguage="es", proficiencyLevel="B2",
    )


async def _start(db, user=None):
    return await start_session(
        kind="practice",
        movie_id=None,
        list_id=None,
        current_user=user or _premium_user(),
        db=db,
    )


def _slots(cards, card_type="definition"):
    """1-based positions of `card_type` in the deck, as a user would count."""
    return [i + 1 for i, c in enumerate(cards) if c.card_type == card_type]


# ---------------------------------------------------------------------------
# 1. The gloss comes from the registry, not the empty `words` table
# ---------------------------------------------------------------------------

async def test_a_definition_card_is_built_from_the_lemma_registry(monkeypatch):
    rows = [_user_word(i, w) for i, w in enumerate(GLOSSED, start=1)]
    _stub(monkeypatch, due=rows)

    result = await _start(_fake_db(glossed=GLOSSED))

    assert _slots(result.cards), (
        "no definition card in a deck where every word has a registry gloss — "
        "the gloss lookup is reading somewhere that has no rows"
    )
    card = next(c for c in result.cards if c.card_type == "definition")
    assert card.definition == f"means {card.word}"


async def test_an_empty_words_table_cannot_disable_the_feature(monkeypatch):
    """The regression itself. `db.word.find_many` returns nothing in every test
    here *and* in prod; if that is the only place the gloss is read from, the
    assertion above is the one that fails."""
    rows = [_user_word(i, w) for i, w in enumerate(GLOSSED, start=1)]
    _stub(monkeypatch, due=rows)
    db = _fake_db(glossed=GLOSSED)
    seen = []

    async def record(where=None, **kwargs):
        seen.append(where)
        return []

    db.word.find_many = record

    result = await _start(db)

    assert seen, "the legacy lookup was dropped rather than backstopped"
    assert _slots(result.cards)


# ---------------------------------------------------------------------------
# 2. The 4th and the 8th, not "every fourth if it happens to fit"
# ---------------------------------------------------------------------------

async def test_the_fourth_and_eighth_cards_are_definition_cards(monkeypatch):
    rows = [_user_word(i, w) for i, w in enumerate(GLOSSED, start=1)]
    _stub(monkeypatch, due=rows)

    result = await _start(_fake_db(glossed=GLOSSED))

    assert _slots(result.cards) == [4, 8]


async def test_a_glossless_word_is_moved_off_the_definition_slot(monkeypatch):
    """The placement half. Only three deck words carry a gloss, and none of
    them starts on slot 4 or 8 — a greedy pass leaves both slots as ordinary
    translation cards."""
    deck = list(GLOSSLESS) + GLOSSED[:3] + ["alpha", "beta", "gamma"]
    rows = [_user_word(i, w) for i, w in enumerate(deck, start=1)]
    _stub(monkeypatch, due=rows)

    result = await _start(_fake_db(glossed=GLOSSED[:3]))

    assert _slots(result.cards) == [4, 8]


async def test_the_rest_of_the_deck_is_still_translation_cards(monkeypatch):
    """Definition cards are a seasoning, not the session. Eight of ten cards
    still ask for the translation."""
    rows = [_user_word(i, w) for i, w in enumerate(GLOSSED, start=1)]
    _stub(monkeypatch, due=rows)

    result = await _start(_fake_db(glossed=GLOSSED))

    assert _slots(result.cards, "mcq") == [1, 2, 3, 5, 6, 7, 9, 10]


async def test_a_deck_with_no_glosses_still_runs_a_full_session(monkeypatch):
    """Graceful degradation: ten questions with no definition card beats eight
    questions and two apologies."""
    deck = GLOSSLESS + ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta"]
    rows = [_user_word(i, w) for i, w in enumerate(deck, start=1)]
    _stub(monkeypatch, due=rows)

    result = await _start(_fake_db(glossed=[]))

    assert len(result.cards) == SESSION_SIZE
    assert _slots(result.cards) == []


# ---------------------------------------------------------------------------
# 3. Ten questions, every time
# ---------------------------------------------------------------------------

async def test_a_session_is_exactly_ten_questions(monkeypatch):
    rows = [_user_word(i, w) for i, w in enumerate(GLOSSED + GLOSSLESS, start=1)]
    _stub(monkeypatch, due=rows)

    result = await _start(_fake_db(glossed=GLOSSED))

    assert len(result.cards) == SESSION_SIZE == 10
    assert result.session_size == SESSION_SIZE


async def test_headroom_rows_never_become_an_eleventh_card(monkeypatch):
    """Fourteen rows go in — the composer's ten plus four of headroom — and ten
    cards come out. The slack absorbs drops; it does not lengthen the lesson."""
    rows = [_user_word(i, w) for i, w in enumerate(GLOSSED + GLOSSLESS, start=1)]
    _stub(monkeypatch, due=rows)

    result = await _start(_fake_db(glossed=GLOSSED + GLOSSLESS))

    assert len(result.cards) == SESSION_SIZE
    assert len({c.word for c in result.cards}) == SESSION_SIZE


# ---------------------------------------------------------------------------
# 4. The options make sense and do not repeat
# ---------------------------------------------------------------------------

async def test_the_options_are_words_and_one_of_them_is_the_headword(monkeypatch):
    """A definition card asks "which word means this?", so its four options are
    English words — never the `-tr` translations the mcq cards use."""
    rows = [_user_word(i, w) for i, w in enumerate(GLOSSED, start=1)]
    _stub(monkeypatch, due=rows)

    result = await _start(_fake_db(glossed=GLOSSED))

    asked = [c for c in result.cards if c.card_type == "definition"]
    assert len(asked) == 2, "nothing to assert about — no definition card was built"
    for card in asked:
        assert len(card.choices) == 4
        assert sum(c.is_correct for c in card.choices) == 1
        correct = next(c for c in card.choices if c.is_correct)
        assert correct.word == card.word
        assert not any(c.word.endswith("-tr") for c in card.choices)


async def test_wrong_answers_come_from_outside_the_deck(monkeypatch):
    """A distractor that is another card's answer teaches the deck rather than
    the vocabulary, so the registry pool is preferred over the session's own
    words while it can fill the grid."""
    rows = [_user_word(i, w) for i, w in enumerate(GLOSSED, start=1)]
    _stub(monkeypatch, due=rows)

    result = await _start(_fake_db(glossed=GLOSSED))

    asked = [c for c in result.cards if c.card_type == "definition"]
    assert len(asked) == 2, "nothing to assert about — no definition card was built"
    for card in asked:
        wrong = {c.word for c in card.choices if not c.is_correct}
        assert wrong <= set(POOL)
        assert wrong.isdisjoint(GLOSSED)


async def test_the_two_definition_cards_do_not_reuse_options(monkeypatch):
    """The "too repetitive" half: a session that offers the same four words
    twice is answered by elimination. `avoid` carries across cards, and with a
    twelve-word pool there is no reason for an overlap."""
    rows = [_user_word(i, w) for i, w in enumerate(GLOSSED, start=1)]
    _stub(monkeypatch, due=rows)

    result = await _start(_fake_db(glossed=GLOSSED))

    grids = [
        {c.word for c in card.choices if not c.is_correct}
        for card in result.cards
        if card.card_type == "definition"
    ]
    assert len(grids) == 2
    assert grids[0].isdisjoint(grids[1])


async def test_a_thin_pool_still_produces_a_four_option_grid(monkeypatch):
    """Exactly three usable distractors for two cards: the second grid has to
    reuse rather than come back with three options, because a card that
    silently changes shape is worse than one that repeats a word."""
    rows = [_user_word(i, w) for i, w in enumerate(GLOSSED, start=1)]
    _stub(monkeypatch, due=rows, pool=["verbose", "morose", "jocular"])

    result = await _start(_fake_db(glossed=GLOSSED))

    assert _slots(result.cards) == [4, 8]
    for card in (c for c in result.cards if c.card_type == "definition"):
        assert len(card.choices) == 4


# ---------------------------------------------------------------------------
# 5. Still off the event loop
# ---------------------------------------------------------------------------

async def test_the_second_pass_added_no_parse_on_the_event_loop(monkeypatch):
    """The card loop was split into a plan pass and a build pass. Both walk
    rows, and a lemmatize call dropped into either would be ~0.6ms/word of CPU
    on the loop of a single-process API (#117/#144)."""
    hops: list = []
    real_run_nlp = srs_routes.run_nlp
    threads: list = []

    async def counting(fn, *args, **kwargs):
        hops.append(fn)
        return await real_run_nlp(fn, *args, **kwargs)

    class _ThreadNotingNlp(_FakeNlp):
        def pipe(self, texts):
            threads.append(threading.current_thread().ident)
            return super().pipe(texts)

    rows = [_user_word(i, w) for i, w in enumerate(GLOSSED, start=1)]
    _stub(monkeypatch, due=rows)
    monkeypatch.setattr(lemmatization_service, "get_nlp", _ThreadNotingNlp)
    monkeypatch.setattr(srs_routes, "run_nlp", counting)

    await _start(_fake_db(glossed=GLOSSED))

    assert len(hops) == 1, f"{len(hops)} hops for a ten-word deck, expected 1"
    assert threads and threads[0] != threading.current_thread().ident
