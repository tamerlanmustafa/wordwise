"""
Regular English inflection expansion for curated vocabulary blocklists.

Both content filters keep a hand-curated set of BASE forms and need the
surface forms a learner actually meets in subtitles ("bitches", "kilometers",
"googling"). Expanding at import time lets both filters stay exact-match sets
— never substring scans — which is what makes them Scunthorpe-safe.

Extracted from src/services/profanity_filter.py when
src/services/internationalism_filter.py needed the same expansion.

Expansion is deliberately conservative: only regular -s/-es/-ies plurals and
regular -ed/-ing verb forms. Agentive -er and adjectival -y are NEVER
generated, because blind expansion invents unrelated real words (cock+er =
"cocker" spaniel, tit+er = "titer"). Callers spell those out explicitly.
"""

from __future__ import annotations

from typing import Callable, Iterable, Set


def pluralize(base: str) -> Set[str]:
    """Noun forms only: the base and its regular plural."""
    forms = {base}
    if base.endswith(("s", "x", "z", "ch", "sh")):
        forms.add(base + "es")
    elif base.endswith("y") and len(base) > 1 and base[-2] not in "aeiou":
        forms.add(base[:-1] + "ies")
    else:
        forms.add(base + "s")
    return forms


def inflect(base: str) -> Set[str]:
    """Regular -s/-es/-ed/-ing forms of one base (verb-capable terms)."""
    forms = pluralize(base)

    if base.endswith("e"):
        forms.add(base + "d")
        forms.add(base[:-1] + "ing")
    else:
        forms.add(base + "ed")
        forms.add(base + "ing")
        # Doubled final consonant: shit -> shitted/shitting, wank -> wanked.
        if (
            len(base) >= 3
            and base[-1] not in "aeiouwxy"
            and base[-2] in "aeiou"
            and base[-3] not in "aeiou"
        ):
            forms.add(base + base[-1] + "ed")
            forms.add(base + base[-1] + "ing")
    return forms


def build_forms(
    bases: Iterable[str],
    expand: Callable[[str], Set[str]],
    extra: Iterable[str] = (),
) -> Set[str]:
    """Expand every base with `expand`, then union in literal `extra` forms."""
    out: Set[str] = set()
    for base in bases:
        out |= expand(base)
    out |= set(extra)
    return out
