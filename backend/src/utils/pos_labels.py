"""
Learner-facing part-of-speech labels.

`lemmas.pos` (and spaCy, which wrote it) holds UPOS tags — NOUN, PROPN, VERB,
AUX, ADJ, ADV, plus a long tail of function-word tags. Nothing a learner should
read. Every surface that tells a user what kind of word this is — the quiz
hint chip, the Explore card, the movie-detail card deck — maps through here, so
"noun" means the same thing and looks the same wherever it appears.

Anything outside the map returns None and the caller drops the label rather
than printing a raw tag: "PART" or "X" on a card is worse than no label at all.
That deliberately swallows the function-word tags (DET, ADP, PRON, SCONJ …),
which is right for the two study surfaces — those words are not taught as
vocabulary and their tag would only ever appear on a card by mistake.

PROPN collapses to "noun" on purpose. It is not a distinction a learner needs,
and a good share of the corpus's PROPN lemmas are ordinary words the parser
mis-tagged from a capitalised line of dialogue (see issue #91) — labelling
those "proper noun" would advertise the parse error.
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
}


def friendly_pos(raw: Optional[str]) -> Optional[str]:
    """Map a UPOS tag to its learner label, or None if it has no label.

    Tolerates None, blanks, and casing so callers can pass a nullable column
    straight through (`lemmas.pos` is NULL on ~14% of rows).
    """
    return POS_FRIENDLY.get((raw or "").strip().upper())
