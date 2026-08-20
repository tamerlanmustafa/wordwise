"""
One spaCy parse per script, shared by every consumer that needs it.

Classifying a new movie used to build **five independent `Doc`s over the same
unchanged script text**, inside a single request (issue #140):

    1. lemmatize_script                        1.66s
    2. analyze_morphosyntax                    1.62s   ┐ all three fan out from
    3. analyze_semantics                       1.62s   │ one compute_difficulty_
    4. analyze_discourse (loads NER every call)3.00s   ┘ advanced(text=...) call
    5. detect_phrasal_verbs_and_idioms         1.63s
                                              ------
                                               9.52s   (125 KB script, sm model)

None of the five shared anything. They are all pure functions of the same
immutable text, and spaCy `Doc`s are read-only for every one of these uses, so
the fix is the obvious one: parse once, pass the `Doc` around.

Why the shared parse pays for NER
---------------------------------
The other analyzers load `en_core_web_sm` with `disable=["ner"]` because they
only read `dep_`/`pos_`/`lemma_`. `discourse_analyzer` is the exception — its
cultural-reference signal counts named entities — so a doc that serves all five
must carry entities. NER costs ~1.3s on top of a 1.6s parse, which is a bad
trade for one consumer but a good one against four redundant parses: ~2.9s for
everything instead of 9.5s.

That also means **a doc handed to `analyze_discourse` must come from here**. A
no-NER doc has an empty `doc.ents` and would silently score every script as
having no cultural references at all, rather than falling back.

Why a second model object
-------------------------
`lemmatization_service.get_nlp()` stays NER-free: it serves the sentence bank,
`/vocabulary/preview` and the SRS paths, which parse constantly and never look
at entities. Making *that* singleton pay for NER would slow every one of them
to speed up script classification. Two `Language` objects for `en_core_web_sm`
cost ~12 MB of model each — the `Doc`s are what's expensive, not the pipelines.

This is still strictly less memory than before: `discourse_analyzer` called
`spacy.load("en_core_web_sm")` on *every* invocation, building (and orphaning) a
fresh NER-enabled model each time.
"""
from __future__ import annotations

import logging
import threading
from typing import Any, Optional

logger = logging.getLogger(__name__)

# The NER-enabled model, loaded once. Parses now run on the NLP worker thread
# (utils/offload), so the first caller here may not be the main thread — guard
# the load the same way `lemmatization_service.get_nlp` does, or a race spends a
# second model's worth of memory building a throwaway.
_nlp = None
_nlp_lock = threading.Lock()


def get_nlp_with_ner():
    """
    The shared `en_core_web_sm` **with** NER enabled (singleton).

    Distinct from `lemmatization_service.get_nlp()`, which disables NER for the
    hot paths that never read `doc.ents`. Anything needing entities uses this
    one, and there is exactly one of it.
    """
    global _nlp
    if _nlp is None:
        with _nlp_lock:
            if _nlp is None:
                # Lazy import, same as the other analyzers: spacy is a heavy ML
                # dep that isn't installed in the test env, and service modules
                # import this one transitively.
                import spacy

                logger.info("Loading spaCy en_core_web_sm (NER enabled)...")
                nlp = spacy.load("en_core_web_sm")  # NER stays on — see module docstring
                nlp.max_length = 2_000_000  # Allow long movie scripts
                _nlp = nlp
                logger.info("spaCy model (NER) loaded")
    return _nlp


def parse_script(text: str) -> Optional[Any]:
    """
    Parse a script once, for every consumer of it.

    Returns the `Doc`, or `None` if spaCy is unavailable or the parse fails —
    callers treat `None` as "no shared parse" and fall back to whatever they did
    before, so a missing model degrades exactly as it used to instead of taking
    the whole classification down.

    Blocking and CPU-bound: seconds on a full script. Call `parse_script_async`
    from anything `async`.
    """
    if not text or not text.strip():
        return None

    try:
        nlp = get_nlp_with_ner()
    except Exception as e:
        logger.warning(f"Shared script parse unavailable, consumers will fall back: {e}")
        return None

    try:
        nlp.max_length = max(len(text) + 1000, nlp.max_length)
        return nlp(text)
    except Exception as e:
        logger.warning(f"Shared script parse failed, consumers will fall back: {e}")
        return None


async def parse_script_async(text: str) -> Optional[Any]:
    """
    Await `parse_script` on the NLP worker thread.

    Every consumer of the returned `Doc` runs on that same single worker
    (`max_workers=1`), so the doc is only ever *touched* by one thread; the
    event loop just carries the reference between hops.
    """
    from src.utils.offload import run_nlp

    return await run_nlp(parse_script, text)


def capped(doc: Any, max_chars: int) -> Any:
    """
    The first `max_chars` characters of an already-parsed doc.

    The analyzers truncate their input (500k, 300k, 200k) to bound a parse they
    each paid for. The shared doc is the whole script, so the caps have to be
    reapplied to the *doc* or long scripts would silently start scoring on more
    text than before — a behaviour change smuggled in with a performance fix.

    Returns a `Span`, which reads the same as a `Doc` for `.sents`, `.ents` and
    token iteration, or the doc unchanged when it already fits.
    """
    if doc is None or not len(doc):
        return doc

    last = doc[-1]
    # Cheaper than len(doc.text), which rebuilds the whole string.
    if last.idx + len(last.text) <= max_chars:
        return doc

    span = doc.char_span(0, max_chars, alignment_mode="contract")
    return doc if span is None else span
