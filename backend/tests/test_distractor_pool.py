"""
The wide distractor pool: where a quiz card's wrong answers come from.

No DB and no network. `build_pool` is exercised against a fake that records
the two calls it makes, because the two properties worth protecting are
structural: it must never reach a translation API, and it must never offer a
deck word back as a wrong answer.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from src.services.distractor_pool import (
    CANDIDATES_PER_BUCKET,
    MAX_CANDIDATES,
    build_film_pool,
    build_pool,
    is_thin,
    merge_pools,
    pool_for,
)

pytestmark = pytest.mark.asyncio


class FakeDb:
    """Records `query_raw` SQL + args and serves canned candidate/cache rows."""

    def __init__(self, candidates=None, cached=None, raise_on=None):
        self._candidates = candidates or []
        self._cached = cached or []
        self._raise_on = raise_on or set()
        self.sql: list[str] = []
        self.args: list[tuple] = []
        self.cache_where: list[dict] = []
        self.translationcache = SimpleNamespace(find_many=self._find_many)

    async def query_raw(self, sql, *args):
        if "query_raw" in self._raise_on:
            raise RuntimeError("boom")
        self.sql.append(sql)
        self.args.append(args)
        return list(self._candidates)

    async def _find_many(self, where=None, **_kw):
        if "cache" in self._raise_on:
            raise RuntimeError("boom")
        self.cache_where.append(where or {})
        return list(self._cached)


def candidate(lemma, pos, level):
    return {"lemma": lemma, "pos": pos, "cefr_level": level}


def cache_row(source_text, translated):
    return SimpleNamespace(sourceText=source_text, translated=translated)


def film_row(lemma, pos, level, translated):
    """A row of `_FILM_POOL_SQL`: a film word the deck already paid to
    translate, carrying the registry's own (pos, level)."""
    return {"lemma": lemma, "pos": pos, "cefr_level": level, "translated": translated}


# The (pos, level) pairs a scene's cards span — what the route passes both
# rungs. The film rung reads only the parts of speech out of them.
DECK_BUCKETS = [("VERB", "B2"), ("NOUN", "B2")]


class TestBuildPool:
    async def test_buckets_by_pos_and_level(self):
        db = FakeDb(
            candidates=[
                candidate("linger", "VERB", "B2"),
                candidate("ponder", "VERB", "B2"),
                candidate("kettle", "NOUN", "B2"),
            ],
            cached=[
                cache_row("linger", "demorarse"),
                cache_row("ponder", "reflexionar"),
                cache_row("kettle", "hervidor"),
            ],
        )
        pool = await build_pool(
            db, target_lang="ES",
            buckets=[("VERB", "B2"), ("NOUN", "B2")],
            exclude_lemmas=[],
        )
        assert pool[("VERB", "B2")] == ["demorarse", "reflexionar"]
        assert pool[("NOUN", "B2")] == ["hervidor"]

    async def test_only_cached_translations_survive(self):
        # This is the cost model: an uncached candidate is simply not a
        # candidate. Nothing here may ever reach a translation provider.
        db = FakeDb(
            candidates=[
                candidate("linger", "VERB", "B2"),
                candidate("ponder", "VERB", "B2"),
            ],
            cached=[cache_row("linger", "demorarse")],
        )
        pool = await build_pool(
            db, target_lang="ES", buckets=[("VERB", "B2")], exclude_lemmas=[],
        )
        assert pool == {("VERB", "B2"): ["demorarse"]}

    async def test_exactly_two_reads_and_no_more(self):
        db = FakeDb(
            candidates=[candidate("linger", "VERB", "B2")],
            cached=[cache_row("linger", "demorarse")],
        )
        await build_pool(
            db, target_lang="ES", buckets=[("VERB", "B2")], exclude_lemmas=[],
        )
        assert len(db.sql) == 1
        assert len(db.cache_where) == 1

    async def test_deck_words_are_excluded_in_sql(self):
        # A card's answer must never be another card's wrong answer, and the
        # cheapest place to enforce that is before the rows come back.
        db = FakeDb(candidates=[], cached=[])
        await build_pool(
            db, target_lang="ES", buckets=[("VERB", "B2")],
            exclude_lemmas=["Linger", "PONDER"],
        )
        assert db.args[0][1] == ["linger", "ponder"]

    async def test_cache_read_is_scoped_to_the_target_language(self):
        db = FakeDb(
            candidates=[candidate("linger", "VERB", "B2")],
            cached=[cache_row("linger", "demorarse")],
        )
        await build_pool(
            db, target_lang="tr", buckets=[("VERB", "B2")], exclude_lemmas=[],
        )
        assert db.cache_where[0]["targetLang"] == "TR"

    async def test_english_natives_get_no_pool(self):
        # Translating en->en is gibberish, so their deck has no translations
        # to build a grid from at all — don't spend two queries discovering it.
        db = FakeDb(candidates=[candidate("linger", "VERB", "B2")])
        assert await build_pool(
            db, target_lang="EN", buckets=[("VERB", "B2")], exclude_lemmas=[],
        ) == {}
        assert db.sql == []

    async def test_untagged_or_unplaced_cards_are_skipped(self):
        # ~14% of the registry has a NULL pos. A (None, None) bucket would
        # match everything, which is not a distractor rule.
        db = FakeDb(candidates=[])
        assert await build_pool(
            db, target_lang="ES",
            buckets=[(None, "B2"), ("VERB", None), (None, None)],
            exclude_lemmas=[],
        ) == {}
        assert db.sql == []

    async def test_candidate_query_failure_degrades_to_empty(self):
        # A pool failure must cost choice variety, never the session.
        db = FakeDb(raise_on={"query_raw"})
        assert await build_pool(
            db, target_lang="ES", buckets=[("VERB", "B2")], exclude_lemmas=[],
        ) == {}

    async def test_cache_failure_degrades_to_empty(self):
        db = FakeDb(
            candidates=[candidate("linger", "VERB", "B2")],
            raise_on={"cache"},
        )
        assert await build_pool(
            db, target_lang="ES", buckets=[("VERB", "B2")], exclude_lemmas=[],
        ) == {}

    async def test_per_bucket_cap_is_bounded(self):
        db = FakeDb(candidates=[], cached=[])
        await build_pool(
            db, target_lang="ES",
            buckets=[(p, "B2") for p in ("VERB", "NOUN", "ADJ", "ADV")],
            exclude_lemmas=[],
        )
        sql = db.sql[0]
        assert "row_number() OVER" in sql
        assert "PARTITION BY l.cefr_level, l.pos" in sql
        cap = int(sql.split("WHERE rn <=")[1].split()[0].rstrip(")"))
        assert 1 <= cap <= CANDIDATES_PER_BUCKET
        assert cap * 4 <= MAX_CANDIDATES

    async def test_level_is_compared_bare_not_cast(self):
        # Casting the column strips the Index Cond and mis-plans the row
        # estimate — the #118 trap, which lint cannot catch.
        db = FakeDb(candidates=[], cached=[])
        await build_pool(
            db, target_lang="ES", buckets=[("VERB", "B2")], exclude_lemmas=[],
        )
        where = db.sql[0].split("WHERE")[1]
        assert "l.cefr_level IN ('B2')" in where
        assert "cefr_level::text IN" not in where

    async def test_hidden_words_are_never_offered_as_options(self):
        # hidden_words is where profanity and junk lemmas live. A distractor
        # is printed on a tile, so it goes through the same curation.
        db = FakeDb(candidates=[], cached=[])
        await build_pool(
            db, target_lang="ES", buckets=[("VERB", "B2")], exclude_lemmas=[],
        )
        assert "hidden_words" in db.sql[0]


class TestBuildFilmPool:
    """Rung 2 (#167): the film's own already-translated vocabulary.

    It exists for the cold-language case the wide pool cannot serve — prod
    holds 18,317 cached lemma translations for TR and 48 for ES — where a
    five-word scene test would otherwise build every grid out of the five
    words it is testing.
    """

    ROWS = [
        film_row("linger", "VERB", "B2", "demorarse"),
        film_row("kettle", "NOUN", "B2", "hervidor"),
        film_row("ponder", "VERB", "C1", "reflexionar"),
    ]

    async def test_only_the_decks_parts_of_speech_are_candidates(self):
        # Measured against prod: unrestricted, the rung's most frequent film
        # words are its function words — `that`, `this`, `with`, `your` — and
        # no learner mistakes "with" for a B2 verb, so the grid gives itself
        # away. Rung 1 never meets this because it only queries the deck's
        # own buckets.
        db = FakeDb(candidates=[])
        await build_film_pool(
            db, target_lang="ES", movie_id=42,
            buckets=[("VERB", "B2"), ("NOUN", "B2")], exclude_lemmas=[],
        )
        assert db.args[0][2] == ["NOUN", "VERB"]
        assert "l.pos = ANY($3::text[])" in db.sql[0]

    async def test_level_is_left_open_unlike_the_wide_pool(self):
        # A cold film has too few translations to also demand an exact CEFR
        # match, and `pool_for` already counts a neighbouring level as fair.
        db = FakeDb(candidates=[])
        await build_film_pool(
            db, target_lang="ES", movie_id=42,
            buckets=[("VERB", "B2")], exclude_lemmas=[],
        )
        assert "cefr_level IN" not in db.sql[0]

    async def test_no_placeable_part_of_speech_means_no_rung(self):
        # Same rule rung 1 applies: a (None, …) bucket matches everything,
        # which is not a distractor rule. Don't spend a query proving it.
        db = FakeDb(candidates=self.ROWS)
        assert await build_film_pool(
            db, target_lang="ES", movie_id=42,
            buckets=[(None, "B2"), (None, None)], exclude_lemmas=[],
        ) == {}
        assert db.sql == []

    async def test_each_bucket_gets_its_own_slots(self):
        # The #116 trap, which the first cut of this query walked into:
        # frequency rank correlates hard with CEFR, so one global
        # `ORDER BY frequency_rank LIMIT n` hands every slot to the easiest
        # bucket. Ordering by `rn` takes each bucket's best before any
        # bucket's second.
        db = FakeDb(candidates=[])
        await build_film_pool(
            db, target_lang="ES", movie_id=42,
            buckets=DECK_BUCKETS, exclude_lemmas=[],
        )
        sql = db.sql[0]
        assert "PARTITION BY l.cefr_level, l.pos" in sql
        assert f"WHERE rn <= {CANDIDATES_PER_BUCKET}" in sql
        assert "ORDER BY rn" in sql

    async def test_one_translation_per_lemma_in_sql(self):
        # The cache and the gloss can both hold a word; the plain word
        # translation wins because a distractor is read with no sentence
        # around it to be aligned to.
        db = FakeDb(candidates=[])
        await build_film_pool(
            db, target_lang="ES", movie_id=42,
            buckets=DECK_BUCKETS, exclude_lemmas=[],
        )
        assert "DISTINCT ON (lemma)" in db.sql[0]
        assert "ORDER BY lemma, src" in db.sql[0]

    async def test_buckets_the_films_words_by_pos_and_level(self):
        db = FakeDb(candidates=self.ROWS)
        pool = await build_film_pool(
            db, target_lang="ES", movie_id=42, buckets=DECK_BUCKETS, exclude_lemmas=[],
        )
        assert pool == {
            ("VERB", "B2"): ["demorarse"],
            ("NOUN", "B2"): ["hervidor"],
            ("VERB", "C1"): ["reflexionar"],
        }

    async def test_one_indexed_read_and_no_translation_api(self):
        # Same cost model as the wide pool: a word the film has not already
        # paid to translate is simply not a candidate. This rung must never
        # become a reason to spend DeepL characters.
        db = FakeDb(candidates=self.ROWS)
        await build_film_pool(
            db, target_lang="ES", movie_id=42,
            buckets=DECK_BUCKETS, exclude_lemmas=[],
        )
        assert len(db.sql) == 1
        assert db.cache_where == [], "no cache read, and certainly no provider call"

    async def test_the_scenes_own_words_are_excluded_in_sql(self):
        # The acceptance criterion: a word under test must never be another
        # question's wrong answer within the same scene.
        db = FakeDb(candidates=[])
        await build_film_pool(
            db, target_lang="ES", movie_id=42, buckets=DECK_BUCKETS,
            exclude_lemmas=["Linger", "VEER"],
        )
        assert db.args[0][3] == ["linger", "veer"]

    async def test_scoped_to_the_film_and_the_language(self):
        db = FakeDb(candidates=[])
        await build_film_pool(
            db, target_lang="tr", movie_id=7,
            buckets=DECK_BUCKETS, exclude_lemmas=[],
        )
        assert db.args[0][0] == 7
        assert db.args[0][1] == "TR"

    async def test_reads_both_paid_sources(self):
        # translation_cache holds the deck's standalone word translations;
        # word_sentence_examples holds the gloss aligned to the card's
        # sentence, which never reaches translation_cache. A film whose deck
        # was read but never quizzed has its translations only in the second.
        db = FakeDb(candidates=[])
        await build_film_pool(
            db, target_lang="ES", movie_id=42,
            buckets=DECK_BUCKETS, exclude_lemmas=[],
        )
        sql = db.sql[0]
        assert "translation_cache" in sql
        assert "word_sentence_examples" in sql

    async def test_a_lemma_in_both_sources_yields_one_option(self):
        # The gloss and the cache can both hold "linger". Two tiles carrying
        # one word is a grid with two answers that look right.
        db = FakeDb(candidates=[
            film_row("linger", "VERB", "B2", "demorarse"),
            film_row("linger", "VERB", "B2", "demorarse"),
        ])
        pool = await build_film_pool(
            db, target_lang="ES", movie_id=42, buckets=DECK_BUCKETS, exclude_lemmas=[],
        )
        assert pool == {("VERB", "B2"): ["demorarse"]}

    async def test_passthrough_translations_are_dropped_in_sql(self):
        # A translation identical to its source is a word the provider could
        # not translate (the deck renders those as "same as English"). On a
        # Spanish grid it is an English tile, which gives the answer away.
        db = FakeDb(candidates=[])
        await build_film_pool(
            db, target_lang="ES", movie_id=42,
            buckets=DECK_BUCKETS, exclude_lemmas=[],
        )
        assert "LOWER(BTRIM(b.translated)) <> l.lemma" in db.sql[0]

    async def test_hidden_words_are_never_offered_as_options(self):
        # Same curation as rung 1: profanity and the over-stripped junk
        # lemmas live in hidden_words, and a distractor is printed on a tile.
        db = FakeDb(candidates=[])
        await build_film_pool(
            db, target_lang="ES", movie_id=42,
            buckets=DECK_BUCKETS, exclude_lemmas=[],
        )
        assert "hidden_words" in db.sql[0]

    async def test_row_budget_is_bounded(self):
        db = FakeDb(candidates=[])
        await build_film_pool(
            db, target_lang="ES", movie_id=42,
            buckets=DECK_BUCKETS, exclude_lemmas=[],
        )
        assert f"LIMIT {MAX_CANDIDATES}" in db.sql[0]

    @pytest.mark.parametrize(
        "lang,movie_id", [("EN", 42), ("ES", None), ("", 42)],
    )
    async def test_nothing_to_do_costs_no_query(self, lang, movie_id):
        # English natives have no translations to build a grid from at all,
        # and a session with no film has no film rung.
        db = FakeDb(candidates=self.ROWS)
        assert await build_film_pool(
            db, target_lang=lang, movie_id=movie_id,
            buckets=DECK_BUCKETS, exclude_lemmas=[],
        ) == {}
        assert db.sql == []

    async def test_query_failure_degrades_to_empty(self):
        # A pool failure costs choice variety, never the session.
        db = FakeDb(raise_on={"query_raw"})
        assert await build_film_pool(
            db, target_lang="ES", movie_id=42, buckets=DECK_BUCKETS, exclude_lemmas=[],
        ) == {}


class TestIsThin:
    """The gate on the film rung: a warm language never pays for the read."""

    def test_a_pool_that_can_fill_every_grid_is_not_thin(self):
        pool = {("VERB", "B2"): [f"t{i}" for i in range(15)]}
        assert is_thin(pool, 5) is False

    def test_one_option_short_is_thin(self):
        pool = {("VERB", "B2"): [f"t{i}" for i in range(14)]}
        assert is_thin(pool, 5) is True

    def test_an_empty_pool_is_thin(self):
        assert is_thin({}, 5) is True

    def test_measured_on_the_total_not_per_bucket(self):
        # `pool_for` widens to the whole pool before it starves a card, so
        # the total is what a card actually sees.
        pool = {("VERB", "B2"): ["a", "b", "c"], ("NOUN", "B2"): ["d", "e", "f"]}
        assert is_thin(pool, 2) is False

    def test_a_session_with_no_cards_needs_nothing(self):
        assert is_thin({}, 0) is False


class TestMergePools:
    WIDE = {("VERB", "B2"): ["demorarse"]}
    FILM = {("VERB", "B2"): ["quedarse"], ("NOUN", "B2"): ["hervidor"]}

    def test_film_widens_the_wide_pool(self):
        merged, added = merge_pools(self.WIDE, self.FILM)
        assert merged[("VERB", "B2")] == ["demorarse", "quedarse"]
        assert merged[("NOUN", "B2")] == ["hervidor"]
        assert added == 2

    def test_wide_entries_keep_their_place_at_the_front(self):
        # Registry candidates are the better-matched ones; the film rung is
        # what a card falls back on, not what it sees first.
        merged, _ = merge_pools(self.WIDE, self.FILM)
        assert merged[("VERB", "B2")][0] == "demorarse"

    def test_a_translation_already_in_the_wide_pool_is_not_added_twice(self):
        merged, added = merge_pools(self.WIDE, {("VERB", "B2"): ["Demorarse"]})
        assert merged == self.WIDE
        assert added == 0, "a film pool that adds nothing must report nothing"

    def test_dedupe_spans_buckets_not_just_one(self):
        # One grid draws from several buckets through `pool_for`'s ladder, so
        # the same translation in two buckets could still land twice on it.
        merged, added = merge_pools(self.WIDE, {("NOUN", "B2"): ["demorarse"]})
        assert added == 0
        assert ("NOUN", "B2") not in merged

    def test_an_empty_film_pool_returns_the_wide_pool_unchanged(self):
        merged, added = merge_pools(self.WIDE, {})
        assert merged is self.WIDE
        assert added == 0

    def test_the_wide_pool_is_never_mutated(self):
        wide = {("VERB", "B2"): ["demorarse"]}
        merge_pools(wide, self.FILM)
        assert wide == {("VERB", "B2"): ["demorarse"]}


class TestPoolFor:
    POOL = {
        ("VERB", "B2"): ["demorarse"],
        ("VERB", "C1"): ["reflexionar"],
        ("NOUN", "B2"): ["hervidor"],
    }

    def test_exact_bucket_wins(self):
        assert pool_for(self.POOL, "VERB", "B2") == ["demorarse"]

    def test_falls_back_to_same_pos_other_level(self):
        # A B1 verb's options being C1 verbs is a fair grid; being nouns is not.
        assert set(pool_for(self.POOL, "VERB", "A1")) == {"demorarse", "reflexionar"}

    def test_falls_back_to_same_level_other_pos(self):
        # No adjectives cached at all, so level is the only thing left to
        # match on — every B2 bucket contributes, C1 does not.
        assert set(pool_for(self.POOL, "ADJ", "B2")) == {"demorarse", "hervidor"}
        assert "reflexionar" not in pool_for(self.POOL, "ADJ", "B2")

    def test_falls_back_to_everything_before_starving(self):
        # Widening beats starving: a card with no pool reverts to the
        # repetitive deck distractors, which is what this all exists to avoid.
        assert len(pool_for(self.POOL, "ADJ", "A1")) == 3

    def test_empty_pool_is_empty(self):
        assert pool_for({}, "VERB", "B2") == []

    def test_tolerates_missing_pos_and_level(self):
        assert len(pool_for(self.POOL, None, None)) == 3

    def test_matching_is_case_insensitive(self):
        assert pool_for(self.POOL, "verb", "b2") == ["demorarse"]
