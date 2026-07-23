"""
Profanity filter: keeps swear words and slurs out of the vocabulary we teach.

WordWise builds vocabulary from film subtitles and scripts, which are full of
strong language. Those tokens are perfectly well-formed English, so the lemma
purity guard (src/services/lemma_guard.py) happily keeps them — several are
even in our curated wordlists (INFORMAL_SIMPLE_VOCAB has "bitch"/"bastard",
comprehensive_cefr.json has "whore"). This module is the separate content
judgement: is this a word we want to put on a flashcard?

Policy (chosen deliberately, see "kept on purpose" below):
  - BLOCKED: strong profanity (the f-word/s-word families, sexual crudity,
    aggressive personal insults) and slurs (racial, ethnic, homophobic,
    transphobic, ableist). Slurs are blocked at any strength because they have
    no learning value in any register.
  - KEPT: mild swears that are ordinary vocabulary with non-profane senses —
    damn, hell, crap, bloody, screw, jerk, ass, piss, suck, freaking, bugger,
    turd. They're common in film dialogue, several sit in our CEFR wordlists,
    and dropping them would cost real learning content.

Matching is EXACT, against a precomputed set of full forms. It is never a
substring scan, so the Scunthorpe family of false positives ("classic",
"cockpit", "assume", "assassin", "bass") is structurally impossible.
Hyphen/space-joined compounds are matched part by part, so "fucked-up" is
caught without "shell-shocked" being caught.

Known, accepted collateral: a handful of blocked bases also have innocent
senses — cock (rooster), prick (to pierce), tit (bird), dyke (embankment,
though that sense is normally spelled "dike"). Blocking the lemma removes
both senses. That trade is deliberate: the vulgar reading dominates in film
dialogue, and a learner card can't disambiguate.
"""

from __future__ import annotations

import re

from .word_forms import build_forms, inflect, pluralize

# ---------------------------------------------------------------------------
# Base terms. Inflections (-s/-es/-ed/-ing) are generated below; irregular or
# risky derivations (agentive -er, adjectival -y) are spelled out instead,
# because blind expansion invents real words: cock+er = "cocker" (spaniel),
# dick+er = "dicker" (to haggle), tit+er = "titer" (chemistry).
# ---------------------------------------------------------------------------

_STRONG_BASES = {
    # f-word family
    "fuck", "fuckup", "motherfuck", "clusterfuck", "mindfuck", "buttfuck",
    # s-word family
    "shit", "shite", "bullshit", "horseshit", "dogshit", "batshit",
    "chickenshit", "apeshit", "dipshit", "shithead", "shithole", "shitload",
    "shitshow", "shitbag", "shitstorm",
    # sexual crudity
    "cunt", "cock", "cocksucker", "cockhead", "dick", "dickhead", "dickwad",
    "prick", "pussy", "tit", "titty", "jizz", "blowjob", "handjob", "rimjob",
    "whore", "manwhore", "slut", "skank", "twat", "wank", "wanker",
    # Compounds found in prod vocabulary (word_classifications).
    "fuckhead", "whorehouse", "whoremaster", "whoremonger", "whoreson",
    # aggressive personal insults
    "bitch", "sonofabitch", "bastard", "asshole", "arsehole", "asshat",
    "asswipe", "jackass", "dumbass", "smartass", "hardass", "fatass",
    "douchebag", "douche", "arse", "bollocks", "goddamn", "goddamnit",
}

# Explicit derivations that the -s/-ed/-ing expander must not be asked to guess.
_STRONG_EXTRA = {
    "fucker", "fuckers", "fuckin", "fucken", "fuckwit", "fuckboy",
    "motherfucker", "motherfuckers", "motherfucking", "fuckery",
    "shitty", "shittier", "shittiest", "shitter", "shitters",
    "cocksucking",
    "bitchy", "bitchier", "bitchiest", "son-of-a-bitch", "sonuvabitch",
    "sluttier", "slutty", "skanky", "douchey", "wanky",
    "titties", "tittie", "bollock",
    "goddamned", "goddammit", "godammit", "goddam", "goddams",
}

# Slurs: racial, ethnic, religious, homophobic, transphobic, ableist.
# Terms whose non-slur sense dominates ordinary English are deliberately
# excluded so they stay teachable: cracker, spook, slope, gypsy, oreo.
_SLUR_BASES = {
    # racial / ethnic
    "nigger", "nigga", "coon", "chink", "gook", "spic", "spick", "wetback", "kike",
    "wop", "dago", "paki", "jap", "raghead", "towelhead", "sandnigger",
    "beaner", "redskin", "injun", "honky", "squaw", "jigaboo", "darkie",
    "golliwog", "tarbaby", "mulatto", "halfbreed", "heeb", "zipperhead",
    "negro", "negress",
    # homophobic / transphobic
    "faggot", "fag", "dyke", "tranny", "shemale", "homo", "poof", "poofter",
    # ableist
    "retard", "tard", "spaz", "spazz", "mongoloid", "midget", "cretin",
}

# Derived slur forms the noun-plural expander can't produce.
_SLUR_EXTRA = {"retarded", "faggy", "spazzy", "chinky"}

# Blocked terms that ALSO have a common innocent sense. Standalone, they are
# still blocked (accepted collateral). Inside a multi-word phrase they must
# never condemn the phrase, because real idioms are built on the innocent
# reading: "a chink in the armor", "cock and bull story", "spick and span"
# are all C2 entries in our own MWE dictionary.
_AMBIGUOUS_BASES = {
    "cock", "prick", "tit", "titty", "dyke", "coon", "chink", "spic", "spick",
    "jap", "homo", "negro", "midget", "fag", "poof", "cretin", "douche",
    "gook", "wop", "tard",
}

# Mild swears we explicitly DO teach. Listed (not just omitted) so the policy
# is reviewable and so a test can assert they never regress into the blocklist.
KEPT_MILD = frozenset({
    "damn", "hell", "crap", "crappy", "bloody", "screw", "screwed", "jerk",
    "ass", "piss", "pissed", "suck", "sucks", "freaking", "frigging", "friggin",
    "bugger", "turd", "darn", "heck", "sod", "git", "bum", "fart", "butt",
})


# Slurs are pluralized only, never given verb endings: they are nouns, and
# -ed/-ing expansion invents real English words that must stay teachable
# (spic -> "spiced", jap -> "japed", poof -> "poofed", dyke -> "dyking").
BLOCKED_WORDS: frozenset = frozenset(
    build_forms(_STRONG_BASES, inflect, _STRONG_EXTRA)
    | build_forms(_SLUR_BASES, pluralize, _SLUR_EXTRA)
) - KEPT_MILD

# Forms that may appear inside an idiom without making it profane.
_AMBIGUOUS_FORMS: frozenset = frozenset(
    build_forms(_AMBIGUOUS_BASES, inflect) & BLOCKED_WORDS
)
# Terms with no innocent reading: a single one condemns any phrase it's in.
_UNAMBIGUOUS_FORMS: frozenset = frozenset(BLOCKED_WORDS - _AMBIGUOUS_FORMS)

_SPLIT_RE = re.compile(r"[\s'’_-]+")


def is_profane(term: str) -> bool:
    """
    True when `term` is strong profanity or a slur we refuse to teach.

    Accepts a lemma or a surface form; matching is exact per whole term and
    per hyphen/space-separated part, never substring.
    """
    if not term:
        return False
    t = term.strip().lower()
    if not t:
        return False
    if t in BLOCKED_WORDS:
        return True

    parts = [p for p in _SPLIT_RE.split(t) if p]
    if len(parts) > 1:
        # Written solid in the blocklist ("son-of-a-bitch" vs "sonofabitch").
        if "".join(parts) in BLOCKED_WORDS:
            return True
        # Only an unambiguously profane part condemns a phrase. Terms with an
        # innocent sense must not, or we lose real idioms built on that sense.
        if any(p in _UNAMBIGUOUS_FORMS for p in parts):
            return True
    return False


def is_profane_entry(word: str, lemma: str | None = None) -> bool:
    """
    True when either the stored surface form or its lemma is profane.

    Vocabulary rows carry both ("fucking" with lemma "fuck"), and either side
    can be the one that matches, so read paths should check the pair.
    """
    return is_profane(word) or (lemma is not None and is_profane(lemma))
