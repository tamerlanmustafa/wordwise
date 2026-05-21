"""
v0.7 Practice tab — units & lesson nodes.

Each in-progress reel movie becomes a "unit" of 5 fixed lesson nodes:

   1. recall   — "Words 1–5"
   2. mcq      — "Synonyms" (uses the W4 synonym MCQ flow)
   3. recall   — "Words 6–10"
   4. listen   — "In context" — LOCKED in v0.7 (no listening flow yet)
   5. chest    — "Final cut" (or `star` once the movie is mastered)

Lesson state derivation (v0.7 stub — subject to product iteration):
  • `done`   when every word in the lesson's slot has srsBox >= 2 (or
              srsBox >= 3 for the synonym MCQ lesson). The listen lesson
              never goes done because the flow doesn't exist yet.
  • `active` = first non-done, non-locked lesson.
  • `locked` = anything after the first non-done lesson, plus the listen
              lesson (always — until v1.1 ships the listen flow).
  • Mastered movies override lesson 5 to kind `star` with state `done`.

Lemma selection: top frequency_in_movie ascending (most-frequent first)
so the user always sees the highest-leverage words first. CEFR-filtered
to the user's level ±1 to keep the difficulty curve gentle.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional

from prisma import Prisma

# 5 fixed lesson slots per unit. The order is deliberate — recall first
# (cheapest, builds confidence), MCQ second (variation), more recall,
# listen (locked), chest (celebration). Tunable but pin it across
# clients so the path looks consistent.
LessonKind = Literal["recall", "mcq", "recall", "listen", "chest", "star"]
LessonState = Literal["done", "active", "locked"]

WORDS_PER_LESSON: int = 5

# Box thresholds that count a word as "passed" for a given lesson kind.
# Recall = the user got the recall card right at least once → box >= 2.
# Synonym MCQ = the user got the MCQ right too → box >= 3 (since MCQ
# only surfaces for words already past their first correct).
RECALL_PASS_BOX: int = 2
MCQ_PASS_BOX: int = 3


@dataclass(frozen=True)
class LessonSpec:
    id: str
    kind: str  # one of LessonKind (Python literal types are awkward at runtime)
    label: str
    state: str  # one of LessonState
    # Optional word-set for the lesson — used by recall/mcq lessons so
    # the client can later deep-link straight to those words without
    # another round trip. None for listen/chest/star.
    words: Optional[list[str]] = None


@dataclass(frozen=True)
class UnitSpec:
    unit_id: str
    movie_id: int
    tmdb_id: Optional[int]
    title: str
    poster_path: Optional[str]
    cefr_level: Optional[str]
    tagline: Optional[str]
    done: int
    total: int
    lessons: list[LessonSpec]

    def as_dict(self) -> dict:
        return {
            "unit_id": self.unit_id,
            "movie_id": self.movie_id,
            "tmdb_id": self.tmdb_id,
            "title": self.title,
            "poster_path": self.poster_path,
            "cefr_level": self.cefr_level,
            "tagline": self.tagline,
            "done": self.done,
            "total": self.total,
            "lessons": [
                {
                    "id": l.id,
                    "kind": l.kind,
                    "label": l.label,
                    "state": l.state,
                    "words": l.words,
                }
                for l in self.lessons
            ],
        }


# ── Pure helpers ────────────────────────────────────────────────────────────

def derive_lesson_states(
    *,
    words_lesson_1: list[str],
    words_lesson_3: list[str],
    word_max_box: dict[str, int],
    is_mastered: bool,
) -> list[LessonSpec]:
    """Pure: turn (slot words, per-word max srs_box) into 5 LessonSpecs.

    Slot map (indices below):
      0. recall — words_lesson_1, pass at srs_box >= RECALL_PASS_BOX
      1. mcq    — words_lesson_1 (same set, harder bar), pass at MCQ_PASS_BOX
      2. recall — words_lesson_3
      3. listen — always locked in v0.7 (no flow)
      4. chest  — unlocked when lessons 0..2 are done; replaced by
                  `star` + `done` when the movie is fully mastered
    """
    def lesson_done(words: list[str], pass_box: int) -> bool:
        if not words:
            return False
        return all((word_max_box.get(w.lower(), 1) >= pass_box) for w in words)

    l0_done = lesson_done(words_lesson_1, RECALL_PASS_BOX)
    l1_done = lesson_done(words_lesson_1, MCQ_PASS_BOX)
    l2_done = lesson_done(words_lesson_3, RECALL_PASS_BOX)
    earned_chest = l0_done and l1_done and l2_done

    # Walk the path. First non-done is `active`; everything after is
    # `locked`. Listen is force-locked. Lesson 5 stays locked until 0..2
    # are all done.
    slots: list[tuple[str, str, list[str] | None]] = [
        ("recall", "Words 1–5", words_lesson_1),
        ("mcq",    "Synonyms",  words_lesson_1),
        ("recall", "Words 6–10", words_lesson_3),
        ("listen", "In context", None),
        ("chest",  "Final cut",  None),
    ]
    # Mastered → swap the last node to a star and treat it as done.
    if is_mastered:
        slots[-1] = ("star", "Mastery", None)

    states: list[str] = []
    active_assigned = False
    for i, (kind, _label, _words) in enumerate(slots):
        # Determine inherent done state first.
        if i == 0:
            done = l0_done
        elif i == 1:
            done = l1_done
        elif i == 2:
            done = l2_done
        elif i == 3:
            done = False  # listen — never done in v0.7
        else:  # i == 4
            done = is_mastered

        if done:
            states.append("done")
            continue
        # Listen is always locked, regardless of order.
        if kind == "listen":
            states.append("locked")
            continue
        # Lesson 5 is locked until 0..2 done.
        if i == 4 and not earned_chest:
            states.append("locked")
            continue
        if not active_assigned:
            states.append("active")
            active_assigned = True
        else:
            states.append("locked")

    out: list[LessonSpec] = []
    for i, ((kind, label, words), state) in enumerate(zip(slots, states)):
        out.append(LessonSpec(
            id=f"l{i + 1}",
            kind=kind,
            label=label,
            state=state,
            words=words,
        ))
    return out


def progress_counts(lessons: list[LessonSpec]) -> tuple[int, int]:
    """(done_count, total) for the progress chip in the unit marquee."""
    return sum(1 for l in lessons if l.state == "done"), len(lessons)


# ── DB-touching builder ────────────────────────────────────────────────────

async def build_units_for_user(
    db: Prisma,
    *,
    user_id: int,
    limit: int = 20,
) -> list[UnitSpec]:
    """Build the Practice tab unit list for a user.

    One unit per reel movie. Movies the user hasn't added are excluded —
    discovery happens in the Ready-to-Watch shelf on My Movies, not here.
    Returns up to `limit` units, ordered most-recently-added first
    (same as the reel).
    """
    # Reel movies — keep order, map to internal movie ids via tmdb_id.
    reel = await db.userreelmovie.find_many(
        where={"userId": user_id},
        order={"addedAt": "desc"},
        take=limit,
    )
    if not reel:
        return []

    tmdb_ids = [r.tmdbId for r in reel]
    movies = await db.movie.find_many(where={"tmdbId": {"in": tmdb_ids}})
    tmdb_to_movie = {m.tmdbId: m for m in movies}

    movie_ids = [m.id for m in movies]
    progress_rows = await db.usermovieprogress.find_many(
        where={"userId": user_id, "movieId": {"in": movie_ids}},
    )
    progress_by_movie = {p.movieId: p for p in progress_rows}

    # Per-user word → max srsBox. One query covers everything.
    user_words = await db.userword.find_many(where={"userId": user_id})
    word_max_box: dict[str, int] = {}
    for uw in user_words:
        key = uw.word.lower()
        prior = word_max_box.get(key, 0)
        if (uw.srsBox or 1) > prior:
            word_max_box[key] = uw.srsBox or 1

    units: list[UnitSpec] = []
    for r in reel:
        movie = tmdb_to_movie.get(r.tmdbId)
        if movie is None:
            continue  # No internal Movie row — skip; can't drive lessons.
        progress = progress_by_movie.get(movie.id)
        is_mastered = bool(progress and (progress.status == "mastered"
                                         or getattr(progress.status, "value", None) == "mastered"))

        # Pick the top 10 lemmas by frequency_in_movie. Two slots of 5.
        lemma_rows = await db.query_raw(
            """
            SELECT l.lemma
            FROM movie_lemma_mappings mlm
            JOIN lemmas l ON l.id = mlm.lemma_id
            WHERE mlm.movie_id = $1
              AND l.lemma ~ '^[a-zA-Z]+$'
              AND length(l.lemma) >= 3
            ORDER BY mlm.frequency_in_movie DESC, l.frequency_rank ASC NULLS LAST
            LIMIT 10
            """,
            movie.id,
        )
        lemmas = [row["lemma"].lower() for row in lemma_rows]
        words_l1 = lemmas[:WORDS_PER_LESSON]
        words_l3 = lemmas[WORDS_PER_LESSON:WORDS_PER_LESSON * 2]

        lessons = derive_lesson_states(
            words_lesson_1=words_l1,
            words_lesson_3=words_l3,
            word_max_box=word_max_box,
            is_mastered=is_mastered,
        )
        done, total = progress_counts(lessons)

        cefr = None
        if getattr(movie, "difficultyLevel", None) is not None:
            cefr = (
                movie.difficultyLevel.value
                if hasattr(movie.difficultyLevel, "value")
                else str(movie.difficultyLevel)
            )

        units.append(UnitSpec(
            unit_id=f"u-{movie.id}",
            movie_id=movie.id,
            tmdb_id=movie.tmdbId,
            title=movie.title,
            poster_path=r.posterPath,
            cefr_level=cefr,
            tagline=movie.genre or None,
            done=done,
            total=total,
            lessons=lessons,
        ))

    return units
