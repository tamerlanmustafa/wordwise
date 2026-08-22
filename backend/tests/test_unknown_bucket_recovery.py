"""
The UNKNOWN bucket stops filling itself, and the rows in it can get out (#131).

`lemmas.cefr_level = 'UNKNOWN'` is the "classifier could not place this"
holding pen from #91. Nothing in it is taught: the Explore feed skips it, the
sentence worker filters it out, should_keep_word drops it at read time. On
prod 2026-08-22 it held 14,819 rows — 34.8% of the registry — and 14,447 of
those carried confidence 0.9, the signature of a single branch: the
proper-noun check, whose rule 1 is `word[0].isupper()`.

Two defects fed it, and both are covered here.

1. classify_text kept the FIRST surface form it saw for each word, so whether
   a script's "baby" was read as a name depended on line order — one
   line-initial "Baby, I'm home." classified every "baby" in the file. Prod
   recorded both halves: `word_classifications` grades "baby" A2 in 2,596
   scripts and UNKNOWN in 668, "angry" B1 in 1,259 and UNKNOWN in 3.

2. _upsert_lemmas resolved conflicts on max(confidence). The proper-noun
   branch returns UNKNOWN at 0.9; a real wordlist grade returns 0.85 or less.
   So one capitalized script overwrote the level every other script agreed
   on, and no later re-classification could ever climb back past 0.9. The
   registry could not self-heal even once defect 1 was fixed — which is why
   the confidence comparison, not just the case map, has to change.

The write path and the backfill are held to the same rule on purpose: the
backfill decides what to repair by voting on the grades prod already stored,
so the two cannot drift the way a re-implemented rule would.
"""
from __future__ import annotations

import pytest

from src.services.cefr_classifier import _case_rank
from src.services.lemmatization_service import UNKNOWN_LEVEL, _level_wins, level_str


class TestCaseRank:
    """The surface form classify_text hands to the proper-noun branch."""

    def test_lowercase_beats_capitalized(self):
        # "Baby" first, "baby" later in the same script: the script does use
        # the word as a common noun, so the proper-noun branch must not fire.
        assert _case_rank("baby") < _case_rank("Baby")

    def test_lowercase_beats_all_caps(self):
        assert _case_rank("baby") < _case_rank("BABY")

    def test_all_caps_ranks_last(self):
        # Subtitles use ALL-CAPS for shouting and on-screen signs, so it says
        # nothing about whether the word is a name — and "Baby" is the better
        # form to store as the classification's surface word.
        assert _case_rank("Baby") < _case_rank("BABY")

    def test_a_real_name_never_gets_a_lowercase_form(self):
        # Nothing rescues "York": every form the corpus records is
        # capitalized, so it keeps ranking as a proper noun. Prod agrees —
        # 1,277 recorded tokens, none of them lowercase.
        assert _case_rank("York") == _case_rank("Yorks")
        assert _case_rank("York") > _case_rank("york")

    @pytest.mark.parametrize("word", ["mcdonald", "iphone", "o'brien"])
    def test_mixed_case_forms_are_ordered_below_all_caps(self, word):
        assert _case_rank(word.capitalize()) < _case_rank(word.upper())


class TestClassifyTextEndToEnd:
    """The whole defect, on a script shaped like the ones that caused it."""

    def test_a_line_initial_capital_no_longer_costs_the_word_its_level(self):
        # Subtitles open lines with the word constantly. Before the case map
        # preferred lowercase, the first "Baby," here classified every "baby"
        # in the file as a proper noun — and the registry then locked that in
        # for every other film, because UNKNOWN arrives at confidence 0.9.
        #
        # "York" is the control: nothing in the corpus ever writes it in
        # lowercase, so it must still land in the holding pen. If this fix
        # rescued it too, it would be #91 all over again — a name taught as
        # vocabulary.
        pytest.importorskip("nltk")
        from src.services.cefr_classifier import CEFRLevel, get_shared_classifier

        script = (
            "Baby, I'm home.\n"
            "Did you see the baby today?\n"
            "The baby was crying all night.\n"
            "Angry men shout. He looked angry.\n"
            "York is a long way from here.\n"
            "We drove through York last spring."
        )
        levels = {
            cls.lemma: cls.cefr_level
            for cls in get_shared_classifier().classify_text(script)
        }

        assert levels["baby"] != CEFRLevel.UNKNOWN
        assert levels["angry"] != CEFRLevel.UNKNOWN
        assert levels["york"] == CEFRLevel.UNKNOWN


class TestLevelWins:
    """Which CEFR level survives when two scripts disagree about a lemma."""

    def test_real_level_replaces_unknown_even_when_less_confident(self):
        # The exact prod case. "angry" was stored UNKNOWN at 0.9 by one
        # capitalized script while 1,259 scripts graded it B1 at 0.85. Under
        # max(confidence) the holding pen won every time.
        assert _level_wins(UNKNOWN_LEVEL, 0.9, "B1", 0.85) is True

    def test_a_barely_confident_real_level_still_beats_unknown(self):
        # frequency_backoff bottoms out around 0.55. UNKNOWN is the absence of
        # a level, not a level, so it does not get to compete on confidence.
        assert _level_wins(UNKNOWN_LEVEL, 0.9, "B2", 0.55) is True

    def test_unknown_never_replaces_a_real_level(self):
        # The other direction is the one that filled the bucket: a word
        # already graded B1 must not be demoted by the next script that
        # happens to start a line with it.
        assert _level_wins("B1", 0.65, UNKNOWN_LEVEL, 0.9) is False

    def test_between_real_levels_confidence_still_decides(self):
        # Unchanged behaviour: a wordlist hit (1.0) outranks a frequency
        # guess (0.65), and the weaker guess does not overwrite it.
        assert _level_wins("B2", 0.65, "A2", 1.0) is True
        assert _level_wins("A2", 1.0, "B2", 0.65) is False

    def test_equal_confidence_keeps_what_is_stored(self):
        # Ties do not churn the row; whichever script ran first keeps it.
        assert _level_wins("B1", 0.85, "B2", 0.85) is False

    def test_unknown_does_not_displace_unknown_without_better_evidence(self):
        assert _level_wins(UNKNOWN_LEVEL, 0.9, UNKNOWN_LEVEL, 0.2) is False
        assert _level_wins(UNKNOWN_LEVEL, 0.2, UNKNOWN_LEVEL, 0.9) is True

    def test_enum_valued_levels_are_compared_as_strings(self):
        # Prisma returns enum columns as str on some client builds and as an
        # enum member on others. If level_str got this wrong the UNKNOWN rule
        # would silently stop firing and the bucket would refill.
        class _Enum:
            value = UNKNOWN_LEVEL

        assert level_str(_Enum()) == UNKNOWN_LEVEL
        assert level_str(UNKNOWN_LEVEL) == UNKNOWN_LEVEL
        assert _level_wins(level_str(_Enum()), 0.9, "B1", 0.85) is True


class TestBackfillDecision:
    """The vote the backfill takes over the grades prod already recorded."""

    @staticmethod
    def _entry(lemma, graded_levels, unknown_votes):
        """One lemma's recorded per-script grades, shaped as _tally emits."""
        from backfill_unknown_bucket import _tally

        rows = [
            {
                "id": 1, "lemma": lemma, "total_movie_count": 100,
                "level": level, "votes": votes, "confidence": 0.85,
                "source": "efllex",
            }
            for level, votes in graded_levels.items()
        ]
        if unknown_votes:
            rows.append({
                "id": 1, "lemma": lemma, "total_movie_count": 100,
                "level": UNKNOWN_LEVEL, "votes": unknown_votes,
                "confidence": 0.9, "source": "fallback",
            })
        return _tally(rows)[1]

    def test_a_word_graded_by_almost_every_script_is_promoted(self):
        # prod: "angry" is B1 in 1,259 scripts and UNKNOWN in 3.
        from backfill_unknown_bucket import _decide

        entry = self._entry("angry", {"B1": 1259}, unknown_votes=3)
        promote, reason = _decide(entry)
        assert promote, reason
        assert entry["level"] == "B1"

    def test_a_proper_noun_with_no_grades_at_all_stays(self):
        # prod: "york" and "jesus" are UNKNOWN in every script they appear in,
        # because they are capitalized in every script they appear in.
        from backfill_unknown_bucket import _decide

        entry = self._entry("york", {}, unknown_votes=1277)
        promote, reason = _decide(entry)
        assert not promote
        assert reason == "no_real_grade"

    def test_a_name_with_a_stray_grade_stays(self):
        # This is what the threshold is for. "mary" has exactly one real grade
        # against 725 UNKNOWNs, "john" nine against 1,248. A plain majority of
        # the GRADED votes would promote both — the gate is the share of
        # scripts that graded it at all.
        from backfill_unknown_bucket import _decide

        for lemma, graded, unknown in [("mary", 1, 725), ("john", 9, 1248)]:
            entry = self._entry(lemma, {"B1": graded}, unknown_votes=unknown)
            promote, reason = _decide(entry)
            assert not promote, f"{lemma} should not leave the bucket"
            assert reason == "capitalized_majority"

    def test_a_split_vote_has_no_level_worth_writing(self):
        from backfill_unknown_bucket import _decide

        entry = self._entry("murky", {"B1": 30, "B2": 30, "C1": 30}, unknown_votes=0)
        promote, reason = _decide(entry)
        assert not promote
        assert reason == "no_level_plurality"

    def test_the_purity_guard_still_gets_the_last_word(self):
        # These rows were written before #96 recalibrated the guard, so being
        # stored is not evidence today's guard would admit them. Prod's
        # promotion set contained motel/selfie/tsunami/podcast/saxophone
        # (internationalisms, #89) with perfectly good grades behind them.
        from backfill_unknown_bucket import _decide

        entry = self._entry("tsunami", {"B2": 40}, unknown_votes=0)
        promote, reason = _decide(entry)
        assert not promote
        assert reason.startswith("guard:")

    def test_a_word_in_almost_no_films_stays_in_the_pen(self):
        # Below MIN_MOVIES the bucket stops being vocabulary and starts being
        # transliterated names out of foreign-film subtitles — the 1-2 movie
        # band is about two thirds aku/hui/lak/rik/rix/zan. lemma_guard keeps
        # them because they are in Webster's 2nd and its foreign check covers
        # es/fr/de/pt/it/ru, not transliterated CJK.
        from backfill_unknown_bucket import _decide

        entry = self._entry("aku", {"C1": 4}, unknown_votes=1)
        entry["movies"] = 1
        promote, reason = _decide(entry)
        assert not promote
        assert reason == "too_few_movies"

    def test_slur_truncations_the_holding_pen_was_hiding(self):
        # Nothing surfaced these while they sat in UNKNOWN. Giving the bucket
        # an exit path is what made them reachable, so the filter has to know
        # them: prod graded "nig" (7 movies) and "goy" (9) at C1, both above
        # MIN_MOVIES and both cleanly through the purity guard.
        from src.services.profanity_filter import is_profane

        assert is_profane("nig")
        assert is_profane("goy")

    def test_the_gate_sits_where_it_was_measured(self):
        # Both sides of the cut, as swept against all 14,819 prod rows.
        from backfill_unknown_bucket import MIN_GRADED_SHARE, _decide

        assert MIN_GRADED_SHARE == 0.75
        just_under = self._entry("outta", {"B1": 71}, unknown_votes=29)
        assert _decide(just_under)[1] == "capitalized_majority"
        just_over = self._entry("baby", {"A2": 80}, unknown_votes=20)
        assert _decide(just_over)[0] is True
