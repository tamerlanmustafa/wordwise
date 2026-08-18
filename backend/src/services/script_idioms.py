"""
A script's phrasal verbs and idioms, parsed once instead of once per request.

`detect_phrasal_verbs_and_idioms` is a pure function of the script text, and
that text never changes after ingestion — but four request paths recomputed it
from scratch on every call (`movies.py` preview + full, `cefr.py` cached +
fresh classification). Measured in production (issue #106): 2.4s for a 5 KB
script, 21.0s for a 414 KB one, against a 0.16s baseline, and repeat calls to
the same movie cost exactly the same because nothing was stored.

Opening a movie paid it twice — `classify-script` and `vocabulary/full` both
parsed the same unchanged text (issue #122).

Where the result lives: `movie_scripts.idioms` (JSONB). NULL means "never
computed" and `[]` means "computed, this script has none", so a script without
idioms is not reparsed forever. Writes happen in two places:

  • at ingestion, next to the text itself (`script_ingestion_service`), so
    newly ingested scripts arrive already computed;
  • on first read here, which heals the ~4.3k scripts ingested before this
    column existed without needing a migration window.

The parse still goes through `run_nlp` on the cache miss — it is the same
GIL-holding spaCy call as before (issue #117), it just happens once.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional, Protocol

from src.utils.nlp_executor import nlp_slot

logger = logging.getLogger(__name__)

# One detected expression as it appears in API responses and in the column.
Idiom = Dict[str, Any]


class _SupportsScriptUpdate(Protocol):
    @property
    def moviescript(self) -> Any: ...


def _as_idiom_list(stored: Any) -> Optional[List[Idiom]]:
    """
    Normalize whatever the column holds into a list of idiom dicts.

    Returns None for "nothing usable stored" (NULL, or a legacy/garbled value),
    which the caller treats as a cache miss. An empty list is a real answer and
    is returned as such.
    """
    if stored is None:
        return None
    # Prisma hands back Json columns already deserialized, but rows written
    # through other paths (raw SQL, older code) can still surface as a string.
    if isinstance(stored, str):
        try:
            stored = json.loads(stored)
        except ValueError:
            return None
    if not isinstance(stored, list):
        return None
    return [i for i in stored if isinstance(i, dict) and "phrase" in i]


_spacy_ok: Optional[bool] = None


async def spacy_available() -> bool:
    """
    Whether the spaCy model actually loads in this process.

    This gates *writing*, not reading. `detect_phrasal_verbs_and_idioms` has a
    deliberate fallback: with no model it drops the in-context dependency parse
    and matches phrasal verbs by substring, which is the path that produces
    "her makeup" → "make up". That degradation is acceptable for one response
    and unacceptable in the column, where it would be served forever without
    anything looking broken. So a process that cannot load spaCy still answers
    requests — it just never freezes its answer.

    The check is the real model load, cached after the first success, so it
    costs a thread hop once and nothing after.
    """
    global _spacy_ok
    if _spacy_ok:
        return True

    from src.utils.nlp_executor import run_nlp

    def _load() -> bool:
        try:
            from src.services.lemmatization_service import get_nlp

            return get_nlp() is not None
        except Exception:
            return False

    _spacy_ok = await run_nlp(_load)
    return _spacy_ok


async def compute_idioms(text: str) -> List[Idiom]:
    """
    Run the detector on the NLP worker thread and shape the result for storage.

    The stored shape is the API shape (`phrase`/`type`/`cefr_level`/`words`) so
    the read path is a plain column read with no per-request transformation.
    """
    from src.services.cefr_classifier import detect_phrasal_verbs_and_idioms_async

    results = await detect_phrasal_verbs_and_idioms_async(text)
    return [
        {
            "phrase": phrase,
            "type": expr_type,
            "cefr_level": level,
            "words": phrase.split(),
        }
        for phrase, expr_type, level in results
    ]


async def get_script_idioms(
    db: _SupportsScriptUpdate,
    script: Any,
    *,
    max_pending: Optional[int] = None,
) -> List[Idiom]:
    """
    The idioms for `script`, computing and storing them if this is the first ask.

    `script` is a Prisma MovieScript row (needs `id`, `cleanedScriptText`,
    `idioms`). The hot path is a field read — no spaCy, no thread hop.

    `max_pending`, when given, reserves a slot in the NLP worker queue for the
    cache-miss parse and raises `NLPOverloaded` if the queue is already full.
    Public endpoints pass it so a burst of first-time movies sheds instead of
    queueing; the cached path never touches the queue at all.
    """
    stored = _as_idiom_list(getattr(script, "idioms", None))
    if stored is not None:
        return stored

    text = getattr(script, "cleanedScriptText", None)
    if not text:
        return []

    if max_pending is not None:
        with nlp_slot(max_pending):
            idioms = await compute_idioms(text)
            storable = await spacy_available()
    else:
        idioms = await compute_idioms(text)
        storable = await spacy_available()

    if storable:
        await store_script_idioms(db, script.id, idioms)
    else:
        logger.warning(
            "script %s: spaCy unavailable, serving substring-only idioms without "
            "storing them — a degraded parse must not become the permanent answer",
            script.id,
        )
    return idioms


async def store_script_idioms(
    db: _SupportsScriptUpdate, script_id: int, idioms: List[Idiom]
) -> None:
    """
    Persist a computed idiom list, best-effort.

    A failed write costs the next reader one reparse; failing the request the
    user is waiting on would cost more, so this never raises.
    """
    from prisma import Json

    try:
        await db.moviescript.update(
            where={"id": script_id},
            data={"idioms": Json(idioms)},
        )
    except Exception:
        logger.warning(
            "script %s: could not persist %d idioms — will recompute on next read",
            script_id,
            len(idioms),
            exc_info=True,
        )
