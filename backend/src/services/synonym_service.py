"""
v0.6 W4 — synonym MCQ generator.

Source: NLTK WordNet (already a project dep — see semantic_analyzer.py
and cefr_classifier.py). For each target lemma we pull single-token
synonyms from its synsets, then construct a 4-choice MCQ with one
correct synonym and three CEFR-matched distractors drawn from the
`lemmas` table.

Synonym selection is filtered three ways so we don't surface nonsense
synonyms (the "coldness is a synonym of cold", "wander is a synonym of
betray" class of bug):

  1. POS scoping — only synsets matching the target's part of speech
     are considered, so the noun sense of "cold" (whose synset lists
     "coldness") can't leak into the adjective card. Falls back to
     all-POS when the POS is unknown or WordNet lacks that POS, so we
     never empty the pool on a surprise tag.
  2. Dominant-sense restriction — only the first `MAX_SENSES` synsets
     (WordNet orders them most-frequent-sense first) are used. This
     drops the long tail of rare senses that link, e.g., "betray" to
     "wander" (a marriage-infidelity sense ranked 5th of 6) or "make"
     to "draw" (a low-frequency "derive in the mind" sense).
  3. Morphological-derivative filter — synonyms that stem to the same
     root as the target (cold/coldness, quick/quickly) are dropped;
     they're inflections, not synonyms.

Falls back to None (caller uses recall flow instead) when:
  • WordNet has no synonyms for the target after filtering.
  • No CEFR data to seed distractors.
  • Fewer than 3 valid distractors can be found at the target's CEFR.
"""
from __future__ import annotations

import os
import random
from typing import Optional

from prisma import Prisma

_wordnet = None
_stemmer = None

# How many of a word's WordNet senses (synsets), in WordNet's
# frequency-sorted order, to draw synonyms from. Cutting the rare-sense
# tail is what removes far-fetched synonyms; 3 keeps common synonyms
# (e.g. "glad" for "happy") while dropping tail-sense noise. Tunable
# without redeploy.
MAX_SENSES = int(os.environ.get("SRS_SYNONYM_MAX_SENSES", "3"))

# Friendly / spaCy POS label → WordNet POS tag(s). Adjectives map to
# both head ('a') and satellite ('s') synsets — WordNet splits descriptive
# adjectives into satellites, and pos='a' alone misses them. Anything not
# in this map yields None (no POS filter) so an unexpected tag degrades to
# the old all-POS behavior rather than emptying the synonym pool.
_WN_POS: dict[str, set[str]] = {
    "noun": {"n"}, "propn": {"n"}, "n": {"n"},
    "verb": {"v"}, "aux": {"v"}, "v": {"v"},
    "adj": {"a", "s"}, "adjective": {"a", "s"}, "a": {"a", "s"}, "s": {"a", "s"},
    "adv": {"r"}, "adverb": {"r"}, "r": {"r"},
}


def _get_wordnet():
    """Lazy WordNet import — same pattern semantic_analyzer.py uses so
    we don't pay the NLTK load on cold start when synonym MCQs aren't
    needed (e.g. all cards are box 1)."""
    global _wordnet
    if _wordnet is None:
        from nltk.corpus import wordnet
        _wordnet = wordnet
    return _wordnet


def _get_stemmer():
    """Lazy Porter stemmer — used to drop morphological derivatives
    (cold/coldness) from a word's synonym set. Pure-Python, no corpus
    download, but kept lazy to match the WordNet import pattern."""
    global _stemmer
    if _stemmer is None:
        from nltk.stem import PorterStemmer
        _stemmer = PorterStemmer()
    return _stemmer


def _wn_pos_tags(pos: Optional[str]) -> Optional[set[str]]:
    """Map a friendly/spaCy POS label to WordNet POS tag(s), or None when
    the label is missing/unrecognized (caller treats None as 'no filter')."""
    if not pos:
        return None
    return _WN_POS.get(pos.strip().lower())


# ── Pure helper ─────────────────────────────────────────────────────────────

def get_synonyms(target: str, pos: Optional[str] = None, *,
                 max_senses: Optional[int] = None) -> set[str]:
    """Single-token WordNet synonyms for `target`, lowercased, excluding
    the target itself, multi-word forms, and morphological derivatives.

    `pos` (friendly/spaCy label, e.g. "noun"/"verb"/"adj") scopes the
    lookup to matching synsets; an unknown POS or one WordNet lacks for
    this word falls back to all senses. Only the first `max_senses`
    synsets (WordNet's most-frequent-first order) contribute, dropping
    the rare-sense tail.

    Returns an empty set when WordNet has no usable synonyms.
    """
    wn = _get_wordnet()
    stemmer = _get_stemmer()
    lower = target.strip().lower()
    limit = MAX_SENSES if max_senses is None else max_senses

    all_synsets = wn.synsets(lower)
    tags = _wn_pos_tags(pos)
    synsets = [s for s in all_synsets if s.pos() in tags] if tags else all_synsets
    if not synsets:
        # POS mismatch (e.g. tagged a verb, WordNet only has the noun) —
        # don't lose the word; fall back to all senses.
        synsets = all_synsets

    target_stem = stemmer.stem(lower)
    out: set[str] = set()
    for synset in synsets[:limit]:
        for lemma in synset.lemmas():
            name = lemma.name().replace('_', ' ').strip().lower()
            if not name or name == lower:
                continue
            if ' ' in name:
                continue  # multi-word — skip for MCQ simplicity
            if stemmer.stem(name) == target_stem:
                continue  # inflection of the target, not a synonym
            out.add(name)
    return out


# ── Async card builder ──────────────────────────────────────────────────────

async def build_synonym_mcq(
    db: Prisma,
    *,
    target_word: str,
    target_cefr: Optional[str],
    target_pos: Optional[str] = None,
    rng: Optional[random.Random] = None,
) -> Optional[dict]:
    """Compose a 4-choice synonym MCQ for `target_word`.

    `target_pos` (friendly/spaCy label) scopes synonym lookup to the
    right part of speech — see get_synonyms.

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
    synonyms = get_synonyms(target_word, target_pos)
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
