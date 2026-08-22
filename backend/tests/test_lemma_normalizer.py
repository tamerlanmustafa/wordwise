"""
Lemmatizer over-stripping is corrected before a lemma is stored (#158).

Both lemmatizers WordWise runs drop a letter off some words — NLTK turns
"boss" into "bos", "discuss" into "discus" and "pass" into "pas"; spaCy turns
"cookies" into "cooky" and "fiberglass" into "fiberglas". Every one of those
is a real dictionary entry, so `lemma_guard` looks at it, sees legitimate
English, and keeps it. The word then lives in the registry twice: a junk row
holding all the movie mappings and sentence links, and a correct row holding
almost nothing. On prod 2026-08-22 `pas` carried 2,918 movies while `pass`
carried 31 and read UNKNOWN, and `discus` was graded A1 at position 1,725 of
the 2,000-row A1 deck.

What is protected here:

1. The correction is anchored on the SURFACE FORM. The same lemma `pas` is
   produced by English "passed" (4,532 tokens in prod) and by French "Pas"
   (36). Only the token itself tells them apart, so a lemma-only rule is
   guaranteed to be wrong about one of them.
2. The frequency gate is load-bearing on its own. Surface anchoring alone
   accepts "gasses" -> "gass", because "gasses" really does start with
   "gass".
3. Words that merely look like the bug are left alone — bus, gas, canvas,
   focus, class, baby, city.
4. With wordfreq absent (CI installs it for neither the classifier nor this
   module) every frequency-gated rule declines and the lemma is returned
   untouched. A missing dependency must never rewrite data on a guess.

wordfreq is a real dependency in requirements.txt, but the tests that assert
on specific corrections inject the scores rather than depending on its data.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from src.services import lemma_normalizer
from src.services.lemma_normalizer import MIN_RESTORE_RATIO, correct_lemma


def _fake_nltk_classifier(monkeypatch, raw: dict) -> SimpleNamespace:
    """
    Stand-in for HybridCEFRClassifier along `_get_lemma_fast`'s path, with a
    scratch lemma cache so one test cannot serve another test's answers.
    """
    from src.services import cefr_classifier as cc

    monkeypatch.setattr(cc, "_GLOBAL_LEMMA_CACHE", cc.LRUCache(maxsize=100))
    return SimpleNamespace(
        _lemmatize_uncached=lambda w: raw.get(w.lower(), w.lower()),
    )


def _spacy_token(text: str, lemma: str) -> SimpleNamespace:
    """The five attributes `lemmatize_script` reads off a spaCy token."""
    return SimpleNamespace(
        text=text, lemma_=lemma, pos_="NOUN",
        is_punct=False, is_space=False, like_num=False,
    )

# Zipf scores measured with wordfreq on 2026-08-22. Injected so the assertions
# below pin the RULE, not the corpus release.
ZIPF = {
    "bos": 3.07, "boss": 4.76,
    "discus": 2.76, "discuss": 4.66,
    "pas": 3.59, "pass": 5.05,
    "fiberglas": 1.01, "fiberglass": 3.04,
    "specie": 2.44, "species": 4.85,
    "cooky": 1.93, "cookie": 4.07,
    "goody": 3.04, "goodie": 2.80,
    # Real words that end in a single "s" — the doubled form is either much
    # rarer or not a word at all.
    "bus": 4.64, "buss": 2.11,
    "gas": 4.61, "gass": 0.0,
    "canvas": 3.96, "canvass": 2.81,
    "focus": 4.71, "focuss": 0.0,
    "ros": 3.30, "ross": 4.39,
    "pus": 3.02, "puss": 3.03,
    # Ordinary -y nouns, whose "-ie" form is not a word.
    "baby": 5.26, "babie": 1.38,
    "city": 5.61, "citie": 1.39,
}


def _swap_zipf(monkeypatch, fake):
    """Replace the memoized lookup, clearing the real one either side of it."""
    real = lemma_normalizer._zipf
    real.cache_clear()
    monkeypatch.setattr(lemma_normalizer, "_zipf", fake)
    yield
    real.cache_clear()


@pytest.fixture
def zipf(monkeypatch):
    """Serve the measured table; anything absent is unknown to the corpus."""
    yield from _swap_zipf(monkeypatch, lambda w: ZIPF.get(w, 0.0))


@pytest.fixture
def no_wordfreq(monkeypatch):
    """wordfreq not installed: every lookup answers None, as in CI."""
    yield from _swap_zipf(monkeypatch, lambda w: None)


class TestDoubledSRestoration:
    @pytest.mark.parametrize(
        "surface,stripped,expected",
        [
            ("boss", "bos", "boss"),
            ("bosses", "bos", "boss"),
            ("bossing", "bos", "boss"),
            ("discuss", "discus", "discuss"),
            ("discussed", "discus", "discuss"),
            ("discussing", "discus", "discuss"),
            ("passed", "pas", "pass"),
            ("passes", "pas", "pass"),
            ("fiberglass", "fiberglas", "fiberglass"),
        ],
    )
    def test_the_prod_offenders(self, zipf, surface, stripped, expected):
        assert correct_lemma(surface, stripped) == expected

    def test_capitalised_subtitle_tokens_are_corrected_too(self, zipf):
        # Subtitles are title-cased and ALL-CAPS far more than prose is.
        assert correct_lemma("Bosses", "bos") == "boss"
        assert correct_lemma("DISCUSSED", "discus") == "discuss"

    @pytest.mark.parametrize(
        "surface,lemma",
        [
            # Real words ending in one "s". Nothing to restore.
            ("bus", "bus"), ("buses", "bus"), ("gas", "gas"),
            ("canvas", "canvas"), ("focus", "focus"), ("pus", "pus"),
            # Already doubled — the rule must not run twice.
            ("boss", "boss"), ("class", "class"), ("glasses", "glass"),
        ],
    )
    def test_leaves_real_words_alone(self, zipf, surface, lemma):
        assert correct_lemma(surface, lemma) == lemma

    def test_frequency_gate_stops_surface_anchoring_on_its_own(self, zipf):
        # "gasses" DOES start with "gass", so surface anchoring alone would
        # accept it. Only the frequency test knows "gass" is not a word.
        assert correct_lemma("gasses", "gas") == "gas"

    def test_surface_anchoring_stops_the_frequency_gate_on_its_own(self, zipf):
        # French "pas" clears no bar the frequency test can see — "pass" is
        # 29x more frequent — but the token is not an inflection of "pass",
        # so it keeps its own lemma. In prod this is 36 tokens under a lemma
        # whose other 4,532 are English "pass".
        assert correct_lemma("pas", "pas") == "pas"
        assert correct_lemma("Pas", "pas") == "pas"
        # ...while the English ones under that same lemma are corrected.
        assert correct_lemma("passing", "pas") == "pass"

    def test_a_near_miss_ratio_is_not_enough(self, zipf):
        # "Ross" is 12x "ros", under the 20x bar, so the rule declines. It is
        # the closest real word to the threshold in the whole prod registry.
        assert correct_lemma("ross", "ros") == "ros"


class TestArchaicIePlural:
    def test_cookies_stops_being_cooky(self, zipf):
        assert correct_lemma("cookies", "cooky") == "cookie"
        assert correct_lemma("Cookies", "cooky") == "cookie"

    def test_a_variant_spelling_below_the_bar_is_left_alone(self, zipf):
        # "goodie" is not more frequent than "goody", so there is no evidence
        # the lemmatizer got it wrong.
        assert correct_lemma("goodies", "goody") == "goody"

    def test_ordinary_y_nouns_are_untouched(self, zipf):
        assert correct_lemma("babies", "baby") == "baby"
        assert correct_lemma("cities", "city") == "city"

    def test_only_fires_on_an_ies_token(self, zipf):
        # The genuine singular keeps its own lemma even though "cookie" is
        # far more frequent than "cooky".
        assert correct_lemma("cooky", "cooky") == "cooky"


class TestInvariantPlurals:
    def test_species_is_not_specie(self, zipf):
        assert correct_lemma("species", "specie") == "species"
        assert correct_lemma("Species", "specie") == "species"

    def test_the_rare_singular_keeps_its_own_lemma(self, zipf):
        assert correct_lemma("specie", "specie") == "specie"


class TestWithoutWordfreq:
    @pytest.mark.parametrize(
        "surface,lemma",
        [("bosses", "bos"), ("discussed", "discus"), ("cookies", "cooky")],
    )
    def test_every_frequency_gated_rule_declines(self, no_wordfreq, surface, lemma):
        # CI installs no wordfreq. Declining leaves data exactly as it is
        # today; guessing would rewrite it on no evidence at all.
        assert correct_lemma(surface, lemma) == lemma

    def test_the_listed_invariant_plural_still_works(self, no_wordfreq):
        # This one needs no corpus — it is an explicit entry.
        assert correct_lemma("species", "specie") == "species"


class TestBothWritePathsAgree:
    """
    The registry is written by spaCy (`lemmatize_script` -> lemmas +
    movie_lemma_mappings) and word_classifications by NLTK
    (`_get_lemma_fast`). Before #158 they disagreed on the same token — and
    worse, disagreed differently per word, so `bos` collected the spaCy half
    of the damage and the NLTK half arrived under the same junk key from a
    different direction. Both must now land on one lemma.
    """

    def test_spacy_path_stores_the_corrected_lemma(self, zipf, monkeypatch):
        from src.services import lemmatization_service as ls

        # The guard is not under test here; it keeps every real word anyway.
        monkeypatch.setattr(
            ls, "evaluate_lemma", lambda *a, **k: SimpleNamespace(keep=True)
        )
        monkeypatch.setattr(ls, "_detect_multi_word_expressions", lambda text: [])

        doc = [
            _spacy_token("Bosses", "bos"),
            _spacy_token("discussed", "discus"),
            _spacy_token("Cookies", "cooky"),
            _spacy_token("buses", "bus"),
        ]
        result = ls.lemmatize_script("irrelevant", doc=doc)

        assert set(result.unique_lemmas) == {"boss", "discuss", "cookie", "bus"}
        # The frequency counter is keyed by lemma, so a correction applied
        # after counting would have split one word across two buckets.
        assert result.lemma_frequencies["boss"] == 1

    def test_nltk_path_stores_the_corrected_lemma(self, zipf, monkeypatch):
        from src.services import cefr_classifier as cc

        raw = {"bosses": "bos", "discussed": "discus", "species": "specie"}
        fake = _fake_nltk_classifier(monkeypatch, raw)

        for surface, expected in [
            ("bosses", "boss"), ("discussed", "discuss"), ("species", "species"),
        ]:
            assert cc.HybridCEFRClassifier._get_lemma_fast(fake, surface) == expected

    def test_the_correction_is_what_lands_in_the_cache(self, zipf, monkeypatch):
        from src.services import cefr_classifier as cc

        fake = _fake_nltk_classifier(monkeypatch, {"bosses": "bos"})
        cc.HybridCEFRClassifier._get_lemma_fast(fake, "bosses")

        # Second call is served from the cache; it must not hand back the
        # uncorrected lemma that the raw lemmatizer produced.
        assert cc._GLOBAL_LEMMA_CACHE.get("bosses") == "boss"
        assert cc.HybridCEFRClassifier._get_lemma_fast(fake, "bosses") == "boss"

    def test_the_two_paths_land_on_the_same_lemma(self, zipf, monkeypatch):
        from src.services import cefr_classifier as cc
        from src.services import lemmatization_service as ls

        monkeypatch.setattr(
            ls, "evaluate_lemma", lambda *a, **k: SimpleNamespace(keep=True)
        )
        monkeypatch.setattr(ls, "_detect_multi_word_expressions", lambda text: [])
        # The two lemmatizers over-strip the same token differently: spaCy
        # gets "bosses" right and NLTK does not. Both still have to store the
        # same key, or the movie mapping and the classification row point at
        # two different registry entries for one word.
        fake = _fake_nltk_classifier(monkeypatch, {"bosses": "bos"})

        spacy_lemma = next(iter(
            ls.lemmatize_script("x", doc=[_spacy_token("bosses", "boss")]).unique_lemmas
        ))
        nltk_lemma = cc.HybridCEFRClassifier._get_lemma_fast(fake, "bosses")

        assert spacy_lemma == nltk_lemma == "boss"


class TestInputHandling:
    def test_blank_input_is_returned_unchanged(self, zipf):
        assert correct_lemma("", "bos") == "bos"
        assert correct_lemma("bosses", "") == ""

    def test_multi_word_and_punctuated_lemmas_are_skipped(self, zipf):
        # MWEs from the phrasal-verb dicts and anything non-alphabetic are
        # not the lemmatizer's plural rules misfiring.
        assert correct_lemma("give up", "give up") == "give up"
        assert correct_lemma("o'clock", "o'clock") == "o'clock"

    def test_the_ratio_is_the_documented_one(self):
        assert MIN_RESTORE_RATIO == 20.0
