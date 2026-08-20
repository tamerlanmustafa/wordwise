"""
Tests for the shared script parse (issue #140).

Classifying one new movie built **five independent spaCy `Doc`s over the same
unchanged script text**, inside a single request: lemmatization, the three
analyzers that `compute_difficulty_advanced(text=...)` fans out to, and idiom
detection. Measured at 9.52s of spaCy for a 125 KB script, all of it on the
single NLP worker thread (#117), so every other NLP consumer — including
`/movies/{id}/vocabulary/preview` — queued behind the whole 9.5s.

Two defects, one issue. The second: `discourse_analyzer` called
`spacy.load("en_core_web_sm")` on *every* invocation, ignoring the singleton
directly above it, so it both paid the load each time and held a second model.

What matters and is asserted here:
1. `compute_difficulty_advanced(text=...)` parses once, not three times — the
   headline regression, and the one no call site hints at.
2. Every consumer handed a `doc` reads it instead of parsing: morphosyntax,
   semantics, discourse, lemmatization, phrasal verbs.
3. The NER model is loaded once per process, not once per call.
4. The shared parse keeps NER enabled — `analyze_discourse` counts entities, and
   a doc without them would score every script as culturally flat rather than
   falling back.
5. The per-analyzer character caps still apply, to the doc instead of the text,
   so a long script doesn't silently start scoring on more of itself.
6. `run_script_classification` parses once and shares that doc with all three
   of its consumers — a static guard, since the fan-out is invisible locally.
7. spaCy is only ever loaded inside a cached singleton, anywhere in services/.

spaCy is never imported: it isn't installed in CI, and none of this needs a
real model.
"""
from __future__ import annotations

import ast
import sys
import types
from pathlib import Path

import pytest

from src.services import script_doc
from src.services.script_doc import capped

SERVICES_DIR = Path(__file__).resolve().parents[1] / "src" / "services"

TEXT = "The detective explained the alibi to the inspector at the station."


# ---------------------------------------------------------------------------
# The read-only surface the five consumers actually touch
# ---------------------------------------------------------------------------

class FakeToken:
    def __init__(self, text, idx=0, *, pos="NOUN", dep="", tag="", lemma=None):
        self.text = text
        self.idx = idx
        self.pos_ = pos
        self.dep_ = dep
        self.tag_ = tag
        self.lemma_ = lemma if lemma is not None else text.lower()
        self.is_punct = False
        self.is_space = False
        self.like_num = False
        self.head = self


class FakeEnt:
    def __init__(self, label):
        self.label_ = label


class FakeDoc:
    def __init__(self, text=TEXT, tokens=None, ents=()):
        self.text = text
        self._tokens = []
        idx = 0
        for item in (tokens if tokens is not None else text.replace(".", "").split()):
            if isinstance(item, FakeToken):
                self._tokens.append(item)
                idx = item.idx + len(item.text) + 1
            else:
                self._tokens.append(FakeToken(item, idx))
                idx += len(item) + 1
        self.ents = [FakeEnt(label) for label in ents]

    def __iter__(self):
        return iter(self._tokens)

    def __len__(self):
        return len(self._tokens)

    def __getitem__(self, i):
        return self._tokens[i]

    @property
    def sents(self):
        return [self]

    def char_span(self, start, end, alignment_mode="strict"):
        kept = [t for t in self._tokens if t.idx >= start and t.idx + len(t.text) <= end]
        return FakeDoc(self.text[start:end], tokens=kept, ents=[e.label_ for e in self.ents])


def fake_spacy(loads: list):
    """A stand-in `spacy` module that records how it was asked to load."""
    class FakeNLP:
        max_length = 1_000_000

        def __call__(self, text):
            return FakeDoc(text, ents=["PERSON", "ORG"])

    module = types.ModuleType("spacy")

    def load(name, disable=None):
        loads.append(disable)
        return FakeNLP()

    module.load = load
    return module


@pytest.fixture
def nothing_may_parse(monkeypatch):
    """Blow up if any consumer reaches for a model of its own."""
    from src.services import lemmatization_service, semantic_analyzer, syntactic_analyzer

    def boom(*_args, **_kwargs):
        raise AssertionError("built its own parse instead of using the shared doc")

    monkeypatch.setattr(syntactic_analyzer, "_get_nlp", boom)
    monkeypatch.setattr(semantic_analyzer, "_get_nlp", boom)
    monkeypatch.setattr(lemmatization_service, "get_nlp", boom)
    monkeypatch.setattr(script_doc, "get_nlp_with_ner", boom)


@pytest.fixture
def no_wordnet(monkeypatch):
    """WordNet's corpus data isn't guaranteed in CI, and none of this needs it."""
    from src.services import semantic_analyzer

    monkeypatch.setattr(
        semantic_analyzer, "_get_wordnet", lambda: types.SimpleNamespace(synsets=lambda _w: [])
    )


# ---------------------------------------------------------------------------
# 1. The headline: one text= argument, one parse
# ---------------------------------------------------------------------------

def test_difficulty_parses_the_script_once_not_three_times(monkeypatch, nothing_may_parse, no_wordnet):
    """`compute_difficulty_advanced(text=...)` fans out to three analyzers that
    each used to run their own full dependency parse of the same script."""
    from src.services.difficulty_scorer import WordData, compute_difficulty_advanced

    parsed = []
    doc = FakeDoc(ents=["PERSON", "GPE"])
    monkeypatch.setattr(script_doc, "parse_script", lambda text: parsed.append(text) or doc)

    words = [
        WordData(cefr_level="B2", confidence=0.9, frequency_rank=4000, word="alibi"),
        WordData(cefr_level="A2", confidence=0.9, frequency_rank=200, word="station"),
    ]
    compute_difficulty_advanced(words, genres=["Drama"], text=TEXT)

    assert parsed == [TEXT], f"expected exactly one parse, got {len(parsed)}"


def test_difficulty_reuses_a_doc_the_caller_already_has(monkeypatch, nothing_may_parse, no_wordnet):
    """The classification route parses for the lemma registry first — that same
    doc must serve the difficulty scorer rather than buying a sixth parse."""
    from src.services.difficulty_scorer import WordData, compute_difficulty_advanced

    monkeypatch.setattr(
        script_doc, "parse_script", lambda text: pytest.fail("parsed despite being handed a doc")
    )

    words = [WordData(cefr_level="B1", confidence=0.9, frequency_rank=900, word="detective")]
    score, _breakdown = compute_difficulty_advanced(
        words, genres=[], text=TEXT, doc=FakeDoc(ents=["PERSON"])
    )

    assert score >= 0


def test_a_failed_parse_leaves_the_analyzers_to_their_own_fallbacks(monkeypatch, no_wordnet):
    """`parse_script` returns None when spaCy is missing. That must degrade the
    way it always did, not take the whole difficulty computation down."""
    from src.services.difficulty_scorer import WordData, compute_difficulty_advanced

    monkeypatch.setattr(script_doc, "parse_script", lambda text: None)
    from src.services import semantic_analyzer, syntactic_analyzer

    for module in (syntactic_analyzer, semantic_analyzer):
        monkeypatch.setattr(module, "_get_nlp", lambda: (_ for _ in ()).throw(OSError("no model")))
    monkeypatch.setattr(
        script_doc, "get_nlp_with_ner", lambda: (_ for _ in ()).throw(OSError("no model"))
    )

    words = [WordData(cefr_level="B1", confidence=0.9, frequency_rank=900, word="detective")]
    score, _breakdown = compute_difficulty_advanced(words, genres=[], text=TEXT)

    assert 0 <= score <= 100


# ---------------------------------------------------------------------------
# 2. Every consumer reads a doc it is handed
# ---------------------------------------------------------------------------

def test_morphosyntax_reads_the_shared_doc(nothing_may_parse):
    from src.services.syntactic_analyzer import analyze_morphosyntax

    result = analyze_morphosyntax(TEXT, doc=FakeDoc())

    assert result.raw["num_sentences"] == 1


def test_semantics_reads_the_shared_doc(nothing_may_parse, no_wordnet):
    from src.services.semantic_analyzer import analyze_semantics

    result = analyze_semantics(text=TEXT, word_list=["alibi", "detective"], doc=FakeDoc())

    assert result.raw["sentences_analyzed"] == 1


def test_discourse_reads_the_shared_doc(nothing_may_parse):
    from src.services.discourse_analyzer import analyze_discourse

    result = analyze_discourse(text=TEXT, doc=FakeDoc(ents=["PERSON", "ORG", "GPE"]))

    assert result.raw["cultural_references"]["entity_count"] == 3
    assert result.cultural_ref_density > 0


def test_lemmatization_reads_the_shared_doc(nothing_may_parse):
    from src.services.lemmatization_service import lemmatize_script

    result = lemmatize_script(TEXT, doc=FakeDoc())

    assert result.tokens
    assert "detective" in result.lemma_frequencies


def test_phrasal_verb_detection_reads_the_shared_doc(nothing_may_parse):
    from src.services.cefr_classifier import detect_phrasal_verbs_and_idioms

    verb = FakeToken("gave", 0, pos="VERB", lemma="give")
    particle = FakeToken("up", 5, pos="ADP", dep="prt")
    particle.head = verb

    detected = detect_phrasal_verbs_and_idioms(
        "he gave up", doc=FakeDoc("he gave up", tokens=[verb, particle])
    )

    assert [d for d in detected if d[0] == "give up" and d[1] == "phrasal_verb"]


async def test_idiom_detection_passes_the_shared_doc_through(monkeypatch):
    """`get_script_idioms` is the fifth consumer. On the cache miss a new movie
    always takes, a supplied doc means the miss costs no parse at all."""
    from types import SimpleNamespace

    from src.services import script_idioms

    seen = {}

    async def fake_detect(text, doc=None):
        seen["doc"] = doc
        return [("give up", "phrasal_verb", "A2")]

    monkeypatch.setattr(
        script_idioms,
        "spacy_available",
        lambda: pytest.fail("probed for a model while holding a real parse"),
    )
    monkeypatch.setitem(
        sys.modules,
        "src.services.cefr_classifier",
        types.SimpleNamespace(detect_phrasal_verbs_and_idioms_async=fake_detect),
    )

    doc = FakeDoc("he gave up")
    updates = _Updates()
    db = SimpleNamespace(moviescript=SimpleNamespace(update=updates))
    script = SimpleNamespace(id=7, cleanedScriptText="he gave up", idioms=None)

    idioms = await script_idioms.get_script_idioms(db, script, doc=doc)

    assert seen["doc"] is doc
    assert idioms == [
        {"phrase": "give up", "type": "phrasal_verb", "cefr_level": "A2", "words": ["give", "up"]}
    ]
    assert updates.calls, "a real parse should still be stored"


class _Updates:
    def __init__(self):
        self.calls = []

    async def __call__(self, where, data):
        self.calls.append((where, data))


# ---------------------------------------------------------------------------
# 3-4. The NER model: loaded once, and NER actually enabled
# ---------------------------------------------------------------------------

def test_cultural_reference_density_loads_the_model_once(monkeypatch):
    """The second defect: this used to `spacy.load` on every call, orphaning a
    whole model each time and paying the load again."""
    from src.services.discourse_analyzer import _compute_cultural_reference_density

    loads: list = []
    monkeypatch.setitem(sys.modules, "spacy", fake_spacy(loads))
    monkeypatch.setattr(script_doc, "_nlp", None)

    for _ in range(3):
        score, raw = _compute_cultural_reference_density(TEXT)

    assert len(loads) == 1, f"model loaded {len(loads)} times for 3 calls"
    assert raw["entity_count"] == 2


def test_the_shared_parse_keeps_ner_enabled(monkeypatch):
    """Every other loader passes `disable=["ner"]`. This one must not: the doc
    it produces is the one `analyze_discourse` counts entities in, and an empty
    `doc.ents` reads as "no cultural references" rather than as a failure."""
    loads: list = []
    monkeypatch.setitem(sys.modules, "spacy", fake_spacy(loads))
    monkeypatch.setattr(script_doc, "_nlp", None)

    doc = script_doc.parse_script(TEXT)

    assert doc is not None
    assert loads == [None]


def test_parse_script_returns_none_when_spacy_is_unavailable(monkeypatch):
    monkeypatch.setattr(
        script_doc, "get_nlp_with_ner", lambda: (_ for _ in ()).throw(OSError("no model"))
    )

    assert script_doc.parse_script(TEXT) is None


def test_parse_script_ignores_empty_text(monkeypatch):
    monkeypatch.setattr(
        script_doc, "get_nlp_with_ner", lambda: pytest.fail("loaded a model for empty text")
    )

    assert script_doc.parse_script("   ") is None


# ---------------------------------------------------------------------------
# 5. The caps survive the move from text to doc
# ---------------------------------------------------------------------------

def test_capped_truncates_a_doc_that_exceeds_the_cap():
    doc = FakeDoc("alpha bravo charlie delta")

    trimmed = capped(doc, 11)  # "alpha bravo"

    assert [t.text for t in trimmed] == ["alpha", "bravo"]


def test_capped_returns_the_doc_untouched_when_it_fits():
    doc = FakeDoc("alpha bravo")

    assert capped(doc, 500_000) is doc


def test_capped_tolerates_an_empty_doc():
    doc = FakeDoc("", tokens=[])

    assert capped(doc, 10) is doc


# ---------------------------------------------------------------------------
# 6-7. Static guards
# ---------------------------------------------------------------------------

def _call_name(node) -> str | None:
    if not isinstance(node, ast.Call):
        return None
    return getattr(node.func, "id", None) or getattr(node.func, "attr", None)


def test_classification_parses_once_and_shares_it_with_every_consumer():
    """The five parses were only visible by reading five files at once. This
    pins the shape that fixed it: one `parse_script_async`, and every consumer
    handed the result."""
    from src.routes import cefr

    tree = ast.parse(Path(cefr.__file__).read_text())
    fn = next(
        n for n in ast.walk(tree)
        if isinstance(n, ast.AsyncFunctionDef) and n.name == "run_script_classification"
    )

    parses = [n for n in ast.walk(fn) if _call_name(n) == "parse_script_async"]
    assert len(parses) == 1, f"{len(parses)} shared parses — there should be exactly one"

    shared = {
        _call_name(n)
        for n in ast.walk(fn)
        if isinstance(n, ast.Call) and any(kw.arg == "doc" for kw in n.keywords)
    }
    assert {
        "lemmatize_script_async",
        "compute_difficulty_advanced_async",
        "get_script_idioms",
    } <= shared, f"consumers not sharing the parse: {shared}"


@pytest.mark.parametrize(
    "service_file", sorted(SERVICES_DIR.glob("*.py")), ids=lambda p: p.name
)
def test_spacy_is_only_loaded_inside_a_cached_singleton(service_file):
    """`discourse_analyzer` loaded a model inline, in a function called per
    request, three lines below a singleton that existed for exactly that."""
    tree = ast.parse(service_file.read_text())

    loaders = [
        (n.lineno, n.end_lineno)
        for n in ast.walk(tree)
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and "get_nlp" in n.name
    ]

    for node in ast.walk(tree):
        if _call_name(node) != "load":
            continue
        if getattr(getattr(node, "func", None), "value", None) is None:
            continue
        if getattr(node.func.value, "id", None) != "spacy":
            continue
        assert any(start <= node.lineno <= end for start, end in loaders), (
            f"{service_file.name}:{node.lineno} calls spacy.load outside a cached "
            "loader — it will run again on every call (#140)."
        )
