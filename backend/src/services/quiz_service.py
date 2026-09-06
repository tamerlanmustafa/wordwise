"""
Pure logic for the quiz feature. Kept free of DB / network calls so the
card-selection and scoring rules are unit-testable without a Postgres
harness.

The router in routes/quiz.py composes these helpers with Prisma + the
translation service.
"""
from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Iterable, List, Optional, Set

CARDS_PER_SESSION = 10
MCQ_RATIO = 0.7  # ~70% scored MCQ cards, ~30% self-rate

# How long the shorter of two translations must be before one containing
# the other counts as "too similar". Without this, a legitimate 2-letter
# distractor ("ir") would be thrown out for sitting inside an unrelated
# answer ("vivir").
MIN_CONTAINMENT_LEN = 3

# XP economy — round numbers, tune later.
XP_PER_CORRECT = 10
XP_PER_SELF_RATE = 5  # participation credit; self-rating is honest effort
XP_THREE_STAR_BONUS = 50
XP_TWO_STAR_BONUS = 20


@dataclass(frozen=True)
class CardSpec:
    """What the client renders. For 'mcq' cards the client shows `word` and
    a 2x2 grid of translation choices; `translation` is the canonical
    correct answer echoed for callout copy. The client scores the tap
    locally and sets is_correct when submitting."""
    word: str
    card_type: str  # "mcq" | "self_rate"
    translation: Optional[str]
    choices: Optional[List[dict]] = None  # [{"word": str, "is_correct": bool}]


def pick_card_types(total: int = CARDS_PER_SESSION, *, rng: Optional[random.Random] = None) -> List[str]:
    """
    Produce the interleaved card-type sequence for a session. Deterministic
    via injected rng for tests. MCQ cards are ~70% of the deck, self-rate
    ~30%, shuffled. Guarantees at least one of each type when total >= 3 so
    the user sees the variety.
    """
    r = rng or random.Random()
    n_mcq = round(total * MCQ_RATIO)
    n_self = total - n_mcq
    if total >= 3:
        n_mcq = max(1, min(total - 1, n_mcq))
        n_self = total - n_mcq
    deck = ["mcq"] * n_mcq + ["self_rate"] * n_self
    r.shuffle(deck)
    return deck


def normalize_choice(text: str) -> str:
    """Comparison key for a translation tile: whitespace collapsed and
    case folded. `casefold()` rather than `lower()` because the target
    languages include German (ß/ss) and Turkish (İ/i), where `lower()`
    leaves two spellings of the same word looking different."""
    return " ".join(text.split()).casefold()


def is_near_form(candidate: str, correct: str) -> bool:
    """True when a distractor is spelled closely enough to the correct
    translation that putting both in one grid would confuse the learner
    or give the answer away.

    The rule is containment in either direction, after normalization —
    which covers the three shapes seen in the live TR cache: a suffixed
    inflection ("dakik" vs "dakiklik", "yaşlı" vs "yaşlılar"), a compound
    swallowing the answer ("Hand" vs "Handschuh"), and a phrase built
    around it ("tütsü" vs "tütsü evi"). MIN_CONTAINMENT_LEN keeps a short
    unrelated word that merely sits inside a longer one from being
    rejected.

    Two deliberate limits:
      • It does not catch a related form that alters the stem
        ("casa"/"casita" share no substring), and no cheap string rule
        would without a stemmer per target language.
      • Edit distance is not used. It looks tempting but misfires on real
        decks: Spanish "comer"/"correr" are two edits apart and are a
        perfectly fair pair to show together.

    It over-rejects slightly — an unrelated short word can be an
    incidental substring ("kar" inside "karaciğerle ilgili"). That costs
    one candidate out of a pool that has spares (see the near-form tests),
    so the trade favors the false positive.
    """
    a, b = normalize_choice(candidate), normalize_choice(correct)
    if not a or not b:
        return False
    if a == b:
        return True
    shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
    if len(shorter) < MIN_CONTAINMENT_LEN:
        return False
    return shorter in longer


# Every Nth card is a definition card rather than a translation one: the
# prompt is the gloss and an example sentence, and the options are English
# words. Fourth, not third or fifth — often enough that a session cannot be
# answered purely by recognising translations, rare enough that the quiz is
# still mainly the thing it has always been.
DEFINITION_EVERY = 4


def is_definition_slot(index: int, *, every: int = DEFINITION_EVERY) -> bool:
    """True for the 4th card, the 8th, and so on. `index` is 0-based.

    A pure function rather than a modulo inline in the router because the
    client has to agree with it for the progress bar, and two copies of "every
    fourth" drift the moment one of them is tuned.
    """
    if every <= 0:
        return False
    return (index + 1) % every == 0


def build_definition_choices(
    word: str,
    *,
    pool: Optional[Iterable[str]] = None,
    deck: Optional[Iterable[str]] = None,
    avoid: Optional[Set[str]] = None,
    rng: Optional[random.Random] = None,
    n_choices: int = 4,
) -> Optional[List[dict]]:
    """The option grid for a definition card: the word itself plus wrong words.

    The distractors come from `services/distractor_pool.build_lemma_pool`,
    which matches part of speech and CEFR level — that is what keeps them from
    being *too remote*. A B2 verb surrounded by B2 verbs is a question about
    meaning; the same verb surrounded by A1 nouns is a question about grammar,
    and the user answers it without reading the definition.

    `is_near_form` does the other half. A definition for "consolable" with
    "inconsolable" in the grid is not a harder question, it is an unfair one —
    and it is the shape that turns up most, because a registry bucket is full
    of morphological neighbours.

    `avoid` carries the words already spent as options earlier in the session,
    so a ten-card deck stops offering the same four nouns — that is the *too
    repetitive* half. It is a preference rather than a filter, exactly as it is
    for translations: starving the last cards is a worse failure than an option
    appearing twice.

    `deck` is the fallback: the session's other words. It exists because the
    first version of this had none, and a definition card is all-or-nothing in
    a way a translation card is not — `build_translation_choices` has always
    fallen back to the deck's own translations, so a thin pool costs it
    variety, while this returned None and the feature simply never appeared.
    A deck word is a weaker distractor (it is a word the reader is studying,
    so it may turn up as an answer later in the same session) but it is
    level-appropriate by construction, and a slightly weaker question beats no
    question at all.

    Returns None only when both sources are exhausted. The caller then falls
    back to the translation MCQ for that card rather than dropping the word.
    """
    correct = (word or "").strip()
    if not correct:
        return None
    r = rng or random.Random()
    n_distractors = n_choices - 1

    seen = {normalize_choice(correct)}

    def usable(candidates: Iterable[str]) -> List[str]:
        out: List[str] = []
        for candidate in candidates:
            text = (candidate or "").strip()
            if not text:
                continue
            key = normalize_choice(text)
            if key in seen:
                continue
            if is_near_form(text, correct):
                continue
            seen.add(key)
            out.append(text)
        return out

    distractors = _sample_preferring_unused(
        usable(pool or ()), avoid, n_distractors, r,
    )
    if len(distractors) < n_distractors:
        distractors += _sample_preferring_unused(
            usable(deck or ()), avoid, n_distractors - len(distractors), r,
        )
    if len(distractors) < n_distractors:
        return None

    choices = [{"word": correct, "is_correct": True}] + [
        {"word": d, "is_correct": False} for d in distractors
    ]
    r.shuffle(choices)
    return choices


def build_translation_choices(
    word: str,
    translations: dict[str, str],
    *,
    pool: Optional[Iterable[str]] = None,
    avoid: Optional[Set[str]] = None,
    rng: Optional[random.Random] = None,
    n_choices: int = 4,
) -> Optional[List[dict]]:
    """
    Compose the choice grid for a translation MCQ: the word's own
    translation plus `n_choices - 1` wrong answers.

    Where the wrong answers come from, in order:

    1. `pool` — translations of words OUTSIDE the deck, matched to this
       card's part of speech and CEFR level (see `services/distractor_pool`).
       Preferred *exclusively*: while the pool can fill the grid, no deck
       translation is used at all. That is what stops a word being a
       distractor on card 1 and the correct answer on card 7, and what stops
       a ten-card session recycling the same ten options ten times.
    2. The other words' translations in the same deck — the original
       behaviour, and still the whole story for a target language whose
       `translation_cache` is too cold to fill a pool. Free, and
       level-appropriate by construction since the deck shares a CEFR band.

    `avoid` holds normalized keys already used as distractors earlier in the
    same session. It is a preference, not a filter: candidates are split into
    unused and already-used, unused is drawn from first, and already-used only
    tops up a shortfall. A hard exclusion would starve the last cards of a
    session, which is a worse failure than an option appearing twice.

    Distractors are deduped case-insensitively against the correct answer and
    each other, so two words sharing a translation can't produce a grid with
    two "right" tiles, and near-forms of the correct answer are dropped as
    well (see `is_near_form`). Returns None when the word has no translation
    or fewer than `n_choices - 1` usable distractors remain — quiz then falls
    back to a self_rate card, SRS drops the word from the session, so keep the
    filter cheap on candidates.
    """
    correct = translations.get(word)
    if not correct:
        return None
    r = rng or random.Random()
    n_distractors = n_choices - 1

    seen = {normalize_choice(correct)}

    def usable(candidates: Iterable[str]) -> List[str]:
        """Dedupe against the answer and anything already taken, drop
        near-forms. Mutates `seen`, so calling it twice can't hand back the
        same translation from two different sources."""
        out: List[str] = []
        for t in candidates:
            if not t:
                continue
            key = normalize_choice(t)
            if key in seen:
                continue
            if is_near_form(t, correct):
                continue
            seen.add(key)
            out.append(t)
        return out

    distractors = _sample_preferring_unused(
        usable(pool or ()), avoid, n_distractors, r,
    )
    if len(distractors) < n_distractors:
        deck = usable(t for other, t in translations.items() if other != word)
        distractors += _sample_preferring_unused(
            deck, avoid, n_distractors - len(distractors), r,
        )

    if len(distractors) < n_distractors:
        return None
    choices = [{"word": correct, "is_correct": True}] + [
        {"word": d, "is_correct": False} for d in distractors
    ]
    r.shuffle(choices)
    return choices


def _sample_preferring_unused(
    candidates: List[str],
    avoid: Optional[Set[str]],
    n: int,
    r: random.Random,
) -> List[str]:
    """Up to `n` candidates, drawn from the ones not in `avoid` first.

    Split rather than filter: `avoid` grows with every card in a session, so
    filtering on it would leave the last cards of a long session with nothing
    to choose from. Repeating an option late in a session is a mild flaw;
    dropping the card entirely (which is what an empty pool causes) is not.
    """
    if n <= 0 or not candidates:
        return []
    if not avoid:
        return r.sample(candidates, min(n, len(candidates)))
    fresh = [t for t in candidates if normalize_choice(t) not in avoid]
    reused = [t for t in candidates if normalize_choice(t) in avoid]
    picked = r.sample(fresh, min(n, len(fresh)))
    if len(picked) < n and reused:
        picked += r.sample(reused, min(n - len(picked), len(reused)))
    return picked


def compute_stars(correct_count: int, total_scored: int) -> int:
    """
    Stars are derived only from MCQ cards (total_scored). Self-rate cards
    are excluded from the denominator because they have no "correct"
    answer. A session with zero MCQ cards scores 1 star for completion —
    prevents zero-star frustration on an honest self-rate-only session.
    """
    if total_scored == 0:
        return 1
    accuracy = correct_count / total_scored
    if accuracy >= 0.90:
        return 3
    if accuracy >= 0.70:
        return 2
    if accuracy >= 0.50:
        return 1
    return 0


def compute_xp(correct_count: int, self_rate_count: int, stars: int) -> int:
    """
    XP for a single session. Round numbers, easy to tune. Self-rating earns
    half the points of a correct MCQ card — rewards honest engagement
    without letting users farm XP by tapping "know" on everything.
    """
    xp = correct_count * XP_PER_CORRECT + self_rate_count * XP_PER_SELF_RATE
    if stars == 3:
        xp += XP_THREE_STAR_BONUS
    elif stars == 2:
        xp += XP_TWO_STAR_BONUS
    return xp


def srs_outcome_for_card(
    card_type: str,
    is_correct: Optional[bool],
    self_rating: Optional[str],
) -> str:
    """Translate a quiz-card result into the SRS box-advancement signal.

    Returns one of:
      • "correct"   — bump the user's box for this word
      • "incorrect" — reset the box to 1
      • "skip"      — don't touch the SRS state (kinda / no signal)

    Self-rate cards: `know` → correct, `dont` → incorrect, `kinda` → skip.
    MCQ cards: `is_correct` is the signal; missing → skip. Unknown card
    types skip rather than mis-attribute.
    """
    # "type" (typed-translation) and "synonym_mcq" are retired formats —
    # historical rows still carry them, scored the same as today's MCQs.
    if card_type in ("type", "mcq", "synonym_mcq"):
        if is_correct is True:
            return "correct"
        if is_correct is False:
            return "incorrect"
        return "skip"
    if card_type == "self_rate":
        if self_rating == "know":
            return "correct"
        if self_rating == "dont":
            return "incorrect"
        return "skip"  # kinda or missing
    return "skip"


def is_unit_unlocked(
    level: str,
    level_order: List[str],
    attempted_levels: set[str],
) -> bool:
    """
    Free-play gating: level N is unlocked iff level N-1 has been attempted
    (not mastered). First level is always unlocked.
    """
    if level not in level_order:
        return False
    idx = level_order.index(level)
    if idx == 0:
        return True
    return level_order[idx - 1] in attempted_levels
