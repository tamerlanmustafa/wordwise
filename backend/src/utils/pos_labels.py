"""
Learner-facing part-of-speech labels.

`lemmas.pos` (and spaCy, which wrote it) holds UPOS tags — NOUN, PROPN, VERB,
AUX, ADJ, ADV, plus a long tail of function-word tags. Nothing a learner should
read. Every surface that tells a user what kind of word this is — the quiz
hint chip, the Explore card, the movie-detail card deck — maps through here, so
"noun" means the same thing and looks the same wherever it appears.

Anything outside the map returns None and the caller drops the label rather
than printing a raw tag: "PART" or "X" on a card is worse than no label at all.

The function words are named rather than swallowed. This map began life on the
quiz hint chip, where only content words ever appear, so four tags covered it;
the Explore feed teaches whatever sits at a CEFR band, and A1 is full of `she`,
`once` and `into`. A definition with no label beside it reads as broken — the
reader cannot tell "we don't know" from "this word has no type" — so every tag
with an honest one-word answer gets one.

Two collapses on purpose:
  * PROPN → "noun". Not a distinction a learner needs, and a good share of the
    corpus's PROPN lemmas are ordinary words the parser mis-tagged from a
    capitalised line of dialogue (see issue #91), so "proper noun" would
    advertise the parse error.
  * SCONJ + CCONJ → "conjunction". Subordinating versus coordinating is a
    grammar lesson, not a label.

Still unmapped, deliberately: PART (in English mostly infinitival "to" and
possessive "'s" — "particle" tells a learner nothing), plus X, SYM, PUNCT,
SPACE and NUM, which on a vocabulary card mean the tagger went wrong rather
than that the word is a symbol.
"""
from __future__ import annotations

from typing import Optional

POS_FRIENDLY: dict[str, str] = {
    "NOUN": "noun",
    "PROPN": "noun",
    "VERB": "verb",
    "AUX": "verb",
    "ADJ": "adj",
    "ADV": "adv",
    "PRON": "pronoun",
    "ADP": "preposition",
    "DET": "determiner",
    "SCONJ": "conjunction",
    "CCONJ": "conjunction",
    "INTJ": "interjection",
}


def friendly_pos(raw: Optional[str]) -> Optional[str]:
    """Map a UPOS tag to its learner label, or None if it has no label.

    Tolerates None, blanks, and casing so callers can pass a nullable column
    straight through (`lemmas.pos` is NULL on ~14% of rows).
    """
    return POS_FRIENDLY.get((raw or "").strip().upper())
