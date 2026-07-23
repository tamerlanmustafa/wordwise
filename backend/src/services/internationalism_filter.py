"""
Internationalism filter: keeps words a learner already understands out of the
vocabulary we teach (issue #89).

Some English words are recognisable to speakers of practically every language
we support, because the same term travels across all of them: SI units
(gram, kilometer), global brands (iphone, android), international sports
(football, tennis), and loanwords that entered dozens of languages together
(pizza, taxi, hotel, radio, robot). Putting them on a flashcard spends a
learner's card slot on something they can already read.

They are ordinary, well-formed, frequent English, so the lemma purity guard
(src/services/lemma_guard.py) keeps them and the CEFR wordlists list many of
them at A1/A2. Like src/services/profanity_filter.py, this is the separate
content judgement layered on top: not "is this English?" but "is this worth
teaching?".

Selection policy (deliberately conservative — see issue #89 discussion):
  - INCLUDED: terms whose form is recognisable across a WIDE set of major
    languages, spanning at minimum our supported native languages
    (es, pt, tr, ru, ar, plus fr/de/it). Spelling need not be identical —
    kilometer/kilometro/kilometre/kilometr are the same word to a learner.
  - EXCLUDED on purpose: the broader Greco-Latin technical layer (virus,
    vitamin, television, president) and common Latinate abstractions
    (problem, system, police, doctor). They are cognates for Romance
    speakers but not reliably across Turkish/Arabic/Russian, and cutting
    them would strip a large slice of genuine A1/A2 vocabulary.
  - EXCLUDED because the English homograph dominates: rock, pop, bar, zoom,
    app, computer, cricket, second, minute. Blocking the internationalist
    reading would silently delete a common English word.

Matching is EXACT against a precomputed set of full forms, never a substring
scan, so "grammar" survives "gram" and "programme" survives "gram" alike.
Hyphen/space-joined compounds are also tested joined, so "wi-fi" and "hot
dog" match "wifi"/"hotdog"; no single part ever condemns a phrase, which
keeps real idioms intact ("get the ball rolling" is not "football").
"""

from __future__ import annotations

import re
from typing import Set

from .word_forms import build_forms, inflect, pluralize

# ---------------------------------------------------------------------------
# Curated bases, grouped by why they are international. Nouns are pluralized
# only; the handful that are genuinely verbs in English get full -ed/-ing
# expansion via _VERBAL_BASES below.
# ---------------------------------------------------------------------------

# SI and other standardised units — identical measurement system worldwide.
_UNIT_BASES = {
    "gram", "kilogram", "milligram", "microgram",
    "meter", "metre", "kilometer", "kilometre", "centimeter", "centimetre",
    "millimeter", "millimetre", "nanometer", "nanometre",
    "liter", "litre", "milliliter", "millilitre",
    "ton", "tonne", "hectare",
    "volt", "kilovolt", "watt", "kilowatt", "megawatt", "ampere", "hertz",
    "megahertz", "gigahertz", "joule", "calorie", "kilocalorie",
    "celsius", "fahrenheit", "kelvin", "newton", "pascal", "decibel",
    "byte", "kilobyte", "megabyte", "gigabyte", "terabyte",
}

# Technology and the digital world — these entered every language together.
_TECH_BASES = {
    "internet", "wifi", "email", "online", "offline", "smartphone",
    "laptop", "tablet", "software", "hardware", "website", "blog",
    "podcast", "hashtag", "selfie", "emoji", "pixel", "bluetooth",
    "modem", "router", "robot", "laser", "radar", "microchip",
}

# Global brands and products. Proper nouns, but they leak into vocabulary as
# lowercase lemmas from subtitles ("iphone" was the example in issue #89).
# NB: "windows" is deliberately absent — it is the plural of "window".
_BRAND_BASES = {
    "iphone", "ipad", "ipod", "imac", "macbook", "android",
    "google", "facebook", "instagram", "twitter", "tiktok", "youtube",
    "whatsapp", "snapchat", "netflix", "spotify", "wikipedia", "paypal",
    "playstation", "xbox", "nintendo",
}

# Sports played and named the same way internationally.
_SPORT_BASES = {
    "football", "basketball", "volleyball", "tennis", "golf", "hockey",
    "rugby", "badminton", "judo", "karate", "taekwondo", "yoga",
    "marathon", "olympic", "olympics", "snowboard", "skateboard",
}

# Food and drink that travelled with the dish.
_FOOD_BASES = {
    "pizza", "spaghetti", "lasagna", "pasta", "hamburger", "sandwich",
    "hotdog", "ketchup", "mayonnaise", "chocolate", "banana", "mango",
    "avocado", "kiwi", "cocoa", "cola", "whisky", "whiskey", "vodka",
    "brandy", "cognac", "champagne", "cocktail", "sushi", "taco",
    "burrito", "kebab", "yogurt", "yoghurt", "croissant", "omelette",
    "barbecue", "picnic", "menu", "restaurant", "cafe", "alcohol",
}

# Travel, transport and the places attached to them.
_TRAVEL_BASES = {
    "taxi", "bus", "metro", "tram", "hotel", "motel", "hostel",
    "helicopter", "garage", "motor",
}

# Music, instruments and screen culture.
_CULTURE_BASES = {
    "piano", "guitar", "violin", "saxophone", "trumpet", "jazz", "disco",
    "karaoke", "reggae", "cinema", "film",
}

# Remaining loanwords that are unmistakably the same word everywhere.
_MISC_BASES = {
    "aspirin", "shampoo", "deodorant", "plastic", "nylon", "diesel",
    "tsunami", "panda", "koala", "safari", "kimono", "origami",
    "bikini", "jeans", "pajamas", "pyjamas", "tattoo",
}

# Terms that are also ordinary English verbs and so need -ed/-ing forms.
# Kept tiny and explicit: expanding the noun bases this way would invent
# unrelated words (ton -> "toned", meter -> "metered" is fine but "metering"
# collides with the measuring sense we do not want to over-reach on).
_VERBAL_BASES = {"google", "film", "barbecue", "tattoo", "picnic", "snowboard", "skateboard"}

# Irregular or derived forms the regular -s/-ed/-ing expander cannot produce.
_EXTRA_FORMS = {
    "wi-fi", "e-mail", "hot-dog", "t-shirt", "tshirt",
    "footballer", "footballers", "basketballer", "basketballers",
    "picnicked", "picnicking",  # picnic + k, not producible by the -ed/-ing rule
    "olympiad", "olympiads",
    "graffiti",
    "pyjama", "pajama",
}

_NOUN_BASES: Set[str] = (
    _UNIT_BASES
    | _TECH_BASES
    | _BRAND_BASES
    | _SPORT_BASES
    | _FOOD_BASES
    | _TRAVEL_BASES
    | _CULTURE_BASES
    | _MISC_BASES
) - _VERBAL_BASES

# Words we considered and deliberately kept teachable. Listed (not merely
# omitted) so the policy is reviewable and a test can assert they never
# regress into the blocklist via some future expander change.
KEPT_TEACHABLE = frozenset({
    # Common English homograph dominates the international sense.
    "rock", "pop", "bar", "zoom", "app", "cricket", "second", "minute",
    "star", "click", "block", "post", "match", "set", "table", "note",
    # Not reliably international across tr/ru/ar — real vocabulary to teach.
    "computer", "problem", "system", "police", "doctor", "student",
    "university", "professor", "program", "information", "situation",
    "family", "national", "social", "special", "normal", "natural",
    "virus", "vitamin", "television", "telephone", "president", "camera",
    "photo", "video", "studio", "festival", "concert", "museum", "energy",
})

BLOCKED_WORDS: frozenset = frozenset(
    build_forms(_NOUN_BASES, pluralize)
    | build_forms(_VERBAL_BASES, inflect)
    | _EXTRA_FORMS
) - KEPT_TEACHABLE

_SPLIT_RE = re.compile(r"[\s'’_-]+")


def is_internationalism(term: str) -> bool:
    """
    True when `term` is a word learners of any background already recognise.

    Accepts a lemma or a surface form. Matching is exact against the whole
    term, plus one retry with hyphens/spaces removed so written-apart variants
    ("wi-fi", "hot dog") reach the solid entry. Individual parts are never
    matched on their own, so a phrase is only blocked if the phrase itself is
    an internationalism.
    """
    if not term:
        return False
    t = term.strip().lower()
    if not t:
        return False
    if t in BLOCKED_WORDS:
        return True

    parts = [p for p in _SPLIT_RE.split(t) if p]
    if len(parts) > 1 and "".join(parts) in BLOCKED_WORDS:
        return True
    return False


def is_internationalism_entry(word: str, lemma: str | None = None) -> bool:
    """
    True when either the stored surface form or its lemma is an
    internationalism.

    Vocabulary rows carry both ("kilometers" with lemma "kilometer") and
    either side can be the one that matches, so read paths check the pair.
    """
    return is_internationalism(word) or (
        lemma is not None and is_internationalism(lemma)
    )
