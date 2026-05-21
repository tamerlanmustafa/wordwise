"""
Unit tests for practice_service.derive_lesson_states — the pure
slot-state machine that drives the v0.7 Practice tab path.

`build_units_for_user` is DB-touching and exercised by the smoke test.
"""
from __future__ import annotations

from src.services.practice_service import (
    MCQ_PASS_BOX,
    RECALL_PASS_BOX,
    derive_lesson_states,
    progress_counts,
)


def states(lessons):
    return [l.state for l in lessons]


def kinds(lessons):
    return [l.kind for l in lessons]


class TestDeriveLessonStates:
    def test_fresh_user_no_words_done(self):
        # Nothing studied → lesson 1 active, 2/3 locked, listen locked,
        # chest locked.
        lessons = derive_lesson_states(
            words_lesson_1=["a", "b", "c", "d", "e"],
            words_lesson_3=["f", "g", "h", "i", "j"],
            word_max_box={},
            is_mastered=False,
        )
        assert kinds(lessons) == ["recall", "mcq", "recall", "listen", "chest"]
        assert states(lessons) == ["active", "locked", "locked", "locked", "locked"]

    def test_first_recall_done_unlocks_mcq(self):
        # All 5 lesson-1 words at box >= RECALL_PASS_BOX → lesson 1 done,
        # lesson 2 active.
        word_box = {w: RECALL_PASS_BOX for w in ["a", "b", "c", "d", "e"]}
        lessons = derive_lesson_states(
            words_lesson_1=["a", "b", "c", "d", "e"],
            words_lesson_3=["f", "g", "h", "i", "j"],
            word_max_box=word_box,
            is_mastered=False,
        )
        assert states(lessons) == ["done", "active", "locked", "locked", "locked"]

    def test_mcq_pass_unlocks_second_recall(self):
        word_box = {w: MCQ_PASS_BOX for w in ["a", "b", "c", "d", "e"]}
        lessons = derive_lesson_states(
            words_lesson_1=["a", "b", "c", "d", "e"],
            words_lesson_3=["f", "g", "h", "i", "j"],
            word_max_box=word_box,
            is_mastered=False,
        )
        # Lesson 1 done (recall threshold met), lesson 2 done (MCQ threshold met),
        # lesson 3 active.
        assert states(lessons) == ["done", "done", "active", "locked", "locked"]

    def test_all_three_done_unlocks_chest_skipping_locked_listen(self):
        # All lesson-1+3 words at MCQ_PASS_BOX, listen still locked,
        # chest becomes active because listen is permanently locked.
        word_box = {
            w: MCQ_PASS_BOX
            for w in ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]
        }
        lessons = derive_lesson_states(
            words_lesson_1=["a", "b", "c", "d", "e"],
            words_lesson_3=["f", "g", "h", "i", "j"],
            word_max_box=word_box,
            is_mastered=False,
        )
        # Locked listen sits between two unlocked nodes — chest still becomes
        # active because the "first non-done, non-locked" search keeps walking
        # past listen.
        assert states(lessons) == ["done", "done", "done", "locked", "active"]

    def test_listen_is_never_done_in_v07(self):
        # Even with maxed-out boxes everywhere, listen stays locked because
        # the listen exercise doesn't exist yet. v1.1 changes this.
        word_box = {
            w: 5
            for w in ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]
        }
        lessons = derive_lesson_states(
            words_lesson_1=["a", "b", "c", "d", "e"],
            words_lesson_3=["f", "g", "h", "i", "j"],
            word_max_box=word_box,
            is_mastered=False,
        )
        assert lessons[3].state == "locked"
        assert lessons[3].kind == "listen"

    def test_mastered_replaces_chest_with_star_done(self):
        # When the user has mastered the whole movie, the last node
        # flips to a celebratory `star` in `done` state.
        lessons = derive_lesson_states(
            words_lesson_1=["a", "b", "c", "d", "e"],
            words_lesson_3=["f", "g", "h", "i", "j"],
            word_max_box={},  # earlier lessons stay un-done; that's fine
            is_mastered=True,
        )
        assert lessons[4].kind == "star"
        assert lessons[4].state == "done"

    def test_partial_word_set_doesnt_satisfy_lesson(self):
        # Only 4 of 5 words at threshold → lesson NOT done.
        word_box = {
            "a": RECALL_PASS_BOX,
            "b": RECALL_PASS_BOX,
            "c": RECALL_PASS_BOX,
            "d": RECALL_PASS_BOX,
            # "e" missing
        }
        lessons = derive_lesson_states(
            words_lesson_1=["a", "b", "c", "d", "e"],
            words_lesson_3=["f", "g", "h", "i", "j"],
            word_max_box=word_box,
            is_mastered=False,
        )
        assert lessons[0].state == "active"

    def test_empty_word_sets_no_crash(self):
        # Movie with no lemma data — every lesson reads as not-done.
        # First non-locked slot becomes active so the user has SOMETHING
        # to interact with.
        lessons = derive_lesson_states(
            words_lesson_1=[],
            words_lesson_3=[],
            word_max_box={},
            is_mastered=False,
        )
        assert states(lessons)[0] == "active"

    def test_lesson_id_pattern(self):
        # IDs are l1..l5 — stable so the client can deep-link to a lesson.
        lessons = derive_lesson_states(
            words_lesson_1=["a"], words_lesson_3=["b"], word_max_box={}, is_mastered=False,
        )
        assert [l.id for l in lessons] == ["l1", "l2", "l3", "l4", "l5"]


class TestProgressCounts:
    def test_counts_done(self):
        lessons = derive_lesson_states(
            words_lesson_1=["a", "b", "c", "d", "e"],
            words_lesson_3=["f", "g", "h", "i", "j"],
            word_max_box={w: MCQ_PASS_BOX for w in ["a", "b", "c", "d", "e"]},
            is_mastered=False,
        )
        # Lesson 1 done (recall), 2 done (mcq), 3 active, 4 locked listen, 5 locked.
        done, total = progress_counts(lessons)
        assert done == 2
        assert total == 5

    def test_zero_done_for_fresh_user(self):
        lessons = derive_lesson_states(
            words_lesson_1=["a"], words_lesson_3=["b"], word_max_box={}, is_mastered=False,
        )
        done, total = progress_counts(lessons)
        assert done == 0
        assert total == 5
