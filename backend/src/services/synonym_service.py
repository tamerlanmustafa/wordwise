"""
v0.6 W4 — synonym MCQ generator.

Source: NLTK WordNet (already a project dep — see semantic_analyzer.py
and cefr_classifier.py). For each target lemma we pull single-token
synonyms from across its synsets, then construct a 4-choice MCQ with
one correct synonym and three CEFR-matched distractors drawn from the
`lemmas` table.

Falls back to None (caller uses recall flow instead) when:
  • WordNet has no synonyms for the target.
  • The target IS the synonym (single-word synonyms set is {target}).
  • Fewer than 3 valid distractors can be found at the target's CEFR.

POS filtering is intentionally loose for v1 — synsets are pulled across
all parts of speech because common words usually dominate the right POS
and stricter filtering shrinks the synonym pool below useful. If we see
cross-POS confusion in practice, tighten via wn.synsets(target, pos=...).
"""
from __future__ import annotations

import random
from typing import Optional

from prisma import Prisma

_wordnet = None


def _get_wordnet():
    """Lazy WordNet import — same pattern semantic_analyzer.py uses so
    we don't pay the NLTK load on cold start when synonym MCQs aren't
    needed (e.g. all cards are box 1)."""
    global _wordnet
    if _wordnet is None:
        from nltk.corpus import wordnet
        _wordnet = wordnet
    return _wordnet


# ── Pure helper ─────────────────────────────────────────────────────────────

def get_synonyms(target: str) -> set[str]:
    """Single-token WordNet synonyms for `target`, lowercased, excluding
    the target itself and any multi-word forms (which don't render well
    as a single MCQ choice).

    Returns an empty set when WordNet has no synsets for the input.
    """
    wn = _get_wordnet()
    lower = target.strip().lower()
    out: set[str] = set()
    for synset in wn.synsets(lower):
        for lemma in synset.lemmas():
            name = lemma.name().replace('_', ' ').strip().lower()
            if not name or name == lower:
                continue
            if ' ' in name:
                continue  # multi-word — skip for MCQ simplicity
            out.add(name)
    return out


# ── Async card builder ──────────────────────────────────────────────────────

async def build_synonym_mcq(
    db: Prisma,
    *,
    target_word: str,
    target_cefr: Optional[str],
    rng: Optional[random.Random] = None,
) -> Optional[dict]:
    """Compose a 4-choice synonym MCQ for `target_word`.

    Returns a dict shaped for the SRS ReviewCard:
      {
        "card_type": "synonym_mcq",
        "correct_word": "<the synonym>",
        "choices": [{"word": "...", "is_correct": bool}, ...]
      }

    Returns None — falling back to the existing recall flow — when:
      • no synonyms in WordNet, or
      • no CEFR data to seed distractors, or
      • fewer than 3 usable distractors found.
    """
    if not target_cefr:
        return None
    synonyms = get_synonyms(target_word)
    if not synonyms:
        return None

    r = rng or random.Random()
    target_lower = target_word.strip().lower()

    # Pick one synonym as the correct answer. Sort for determinism inside
    # the seeded RNG path; production calls use a fresh Random per session.
    correct = r.choice(sorted(synonyms))

    # Distractor pool: lemmas at the same CEFR, alpha-only, not the
    # target, not any of its synonyms. Over-fetch so the filter has room.
    rows = await db.query_raw(
        """
        SELECT lemma
        FROM lemmas
        WHERE cefr_level::text = $1
          AND lemma ~ '^[a-zA-Z]+$'
          AND length(lemma) >= 3
        ORDER BY random()
        LIMIT 80
        """,
        target_cefr,
    )

    forbidden = synonyms | {target_lower, correct}
    distractors: list[str] = []
    for row in rows:
        cand = row["lemma"].strip().lower()
        if cand in forbidden or cand in distractors:
            continue
        distractors.append(cand)
        if len(distractors) >= 3:
            break

    if len(distractors) < 3:
        return None

    choices = [{"word": correct, "is_correct": True}] + [
        {"word": d, "is_correct": False} for d in distractors
    ]
    r.shuffle(choices)
    return {
        "card_type": "synonym_mcq",
        "correct_word": correct,
        "choices": choices,
    }
