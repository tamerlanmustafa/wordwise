"""
Lemmatization Service (V2 Context-Aware Translation Pipeline)

Uses spaCy for tokenization, lemmatization, and POS tagging.
Populates the global Lemma registry and MovieLemmaMapping table.
Works alongside the existing CEFR classifier (dual-write).
"""

import json
import logging
import hashlib
import threading
from typing import Any, List, Dict, Optional, Tuple
from dataclasses import dataclass, field
from functools import lru_cache

from prisma import Prisma
from prisma import Json

from src.services.cefr_classifier import (
    PHRASAL_VERBS,
    COMMON_IDIOMS,
    is_curated_vocabulary,
)
from src.services.lemma_guard import evaluate_lemma, is_wellformed
from src.services.lemma_normalizer import correct_lemma

logger = logging.getLogger(__name__)

# Merge all known multi-word expressions with their CEFR levels
ALL_MULTI_WORD_EXPRESSIONS: Dict[str, str] = {**PHRASAL_VERBS, **COMMON_IDIOMS}

# spaCy model singleton
_nlp = None
# Parses now run on the NLP worker thread (see utils/nlp_executor), so the
# first caller to reach here may not be the main thread. Guard the load so a
# race can't spend a second model's worth of memory building a throwaway.
_nlp_lock = threading.Lock()


def get_nlp():
    """Load spaCy model (singleton, ~12MB, loads once)."""
    global _nlp
    if _nlp is None:
        with _nlp_lock:
            if _nlp is None:
                # Lazy import, same as the other analyzers: spacy is a heavy ML
                # dep that isn't installed in the CI test env, and route modules
                # import this module transitively — an eager import would make
                # the whole test suite uncollectable there.
                import spacy

                logger.info("Loading spaCy en_core_web_sm model...")
                _nlp = spacy.load("en_core_web_sm", disable=["ner"])  # NER not needed
                logger.info("spaCy model loaded")
    return _nlp


@dataclass
class LemmaToken:
    """A single lemmatized token from a script."""
    word: str
    lemma: str
    pos: str  # NOUN, VERB, ADJ, ADV, etc.
    is_multi_word: bool = False


@dataclass
class LemmaResult:
    """Result of lemmatizing a full script."""
    tokens: List[LemmaToken]
    unique_lemmas: Dict[str, LemmaToken]  # lemma -> representative token
    lemma_frequencies: Dict[str, int]  # lemma -> count in script
    multi_word_expressions: List[LemmaToken]


# CEFR weight map for priority score computation. UNKNOWN (#91) scores 0 so
# unclassifiable words sink to the bottom of every priority-ordered queue
# instead of taking the `.get(..., 0.5)` default and outranking real B1
# vocabulary — the sentence worker reads this order.
CEFR_WEIGHTS = {
    "A1": 0.1, "A2": 0.3, "B1": 0.5, "B2": 0.7, "C1": 0.9, "C2": 1.0,
    "UNKNOWN": 0.0,
}

# Priority score weights
FREQ_WEIGHT = 0.5
CEFR_WEIGHT = 0.3
USAGE_WEIGHT = 0.2

# Threshold for eager vs lazy translation
EAGER_THRESHOLD = 0.4


def registry_wordlist_known(form: str) -> bool:
    """Curated-list rescue for the registry, minus the orthographic override.

    evaluate_lemma lets a wordlist hit short-circuit *every* other check. That
    is right for word_classifications, which is keyed by the surface word and
    wants entries like "hmm" and "tv". The `lemmas` registry stores canonical
    vocabulary, and the curated lists carry 176 forms that are not vocabulary:
    contractions ("'s", "'m", "'re"), abbreviations ("mr.", "etc.", "no."),
    ordinals and decades ("3rd", "1970s"), unit symbols ("km", "kg", "mph"),
    and British/American slash pairs ("paralyze/paralyse"). spaCy emits several
    of those as lemmas on every script, and they are precisely the debris
    purge_impure_lemmas.py had to clean back out.

    So here the rescue applies to the dictionary/frequency gate only —
    well-formedness still has the last word. The cost is that "hmm" and "tv"
    (rejected as no_vowel) no longer register, which is the trade the guard's
    stated operating point asks for: prefer dropping to teaching junk.
    """
    return is_wellformed(form).keep and is_curated_vocabulary(form)


def compute_priority_score(
    frequency_rank: Optional[int],
    total_lemmas: int,
    cefr_level: str,
    click_rate: float = 0.0,
) -> float:
    """
    Compute hybrid priority score (0.0-1.0).

    Args:
        frequency_rank: Rank within the movie (0 = most frequent)
        total_lemmas: Total unique lemmas in the movie
        cefr_level: CEFR level string (A1-C2)
        click_rate: Historical click rate (0.0 until data exists)
    """
    # Frequency: normalized rank (0=rarest, 1=most frequent)
    if frequency_rank is not None and total_lemmas > 0:
        freq_norm = 1.0 - (frequency_rank / total_lemmas)
        freq_norm = max(0.0, min(1.0, freq_norm))
    else:
        freq_norm = 0.0

    difficulty = CEFR_WEIGHTS.get(cefr_level, 0.5)
    usage = min(1.0, click_rate)

    return FREQ_WEIGHT * freq_norm + CEFR_WEIGHT * difficulty + USAGE_WEIGHT * usage


def lemmatize_script(text: str, doc=None) -> LemmaResult:
    """
    Tokenize and lemmatize a full script using spaCy.

    Returns unique lemmas with POS tags and frequency counts.
    Also detects multi-word expressions (phrasal verbs, idioms).

    `doc`, when given, is an already-parsed `Doc` of the same text — one script
    parse shared with the other consumers in the request (issue #140). Only
    `lemma_`/`pos_`/`text` are read, so any parse of this text will do.
    """
    if doc is None:
        nlp = get_nlp()

        # Process text in chunks if very long (spaCy max_length)
        nlp.max_length = max(len(text) + 1000, nlp.max_length)
        doc = nlp(text)

    tokens: List[LemmaToken] = []
    lemma_freq: Dict[str, int] = {}
    unique_lemmas: Dict[str, LemmaToken] = {}
    # Purity decisions are per-lemma and this loop sees each lemma many
    # times, so memoize locally instead of re-running the guard.
    guard_cache: Dict[str, bool] = {}
    guard_dropped = 0

    for token in doc:
        # Skip punctuation, spaces, and single characters
        if token.is_punct or token.is_space or len(token.text.strip()) <= 1:
            continue

        # Skip numbers, symbols, and unclassifiable tokens (subtitle/OCR debris)
        if token.like_num or token.pos_ in ("NUM", "SYM", "X"):
            continue

        lemma = token.lemma_.lower().strip()
        pos = token.pos_

        # Skip if lemma is empty after normalization
        if not lemma:
            continue

        # spaCy strips the final "s" off -ss words and folds -ies to the
        # archaic -y, so "fiberglass" arrives as "fiberglas" and "cookies" as
        # "cooky". Both are real dictionary words, so the guard below cannot
        # see anything wrong with them (#158). Correct before the guard runs,
        # and before the lemma is used as a dict key anywhere in this loop.
        lemma = correct_lemma(token.text, lemma)

        # Purity guard: gibberish, typos, and foreign words never enter the
        # global Lemma registry.
        #
        # The curated wordlists are passed in for the same reason classify_text
        # passes them (#96): a hand-graded CEFR entry is teachable vocabulary by
        # definition, and without them the registry drops 559 forms the
        # classifier happily stores. Only the lemma is offered, not the surface
        # form - classify_text checks both because word_classifications is keyed
        # by surface word, whereas this table stores the lemma, and checking one
        # form keeps the memo cache keyed by one thing.
        keep = guard_cache.get(lemma)
        if keep is None:
            keep = evaluate_lemma(lemma, is_wordlist_known=registry_wordlist_known).keep
            guard_cache[lemma] = keep
        if not keep:
            guard_dropped += 1
            continue

        lt = LemmaToken(word=token.text, lemma=lemma, pos=pos)
        tokens.append(lt)

        lemma_freq[lemma] = lemma_freq.get(lemma, 0) + 1

        # Keep the first occurrence as representative
        if lemma not in unique_lemmas:
            unique_lemmas[lemma] = lt

    if guard_dropped:
        logger.info(
            f"Lemma guard dropped {guard_dropped} tokens "
            f"({sum(1 for k in guard_cache.values() if not k)} unique lemmas)"
        )

    # Detect multi-word expressions
    mwes = _detect_multi_word_expressions(text)

    return LemmaResult(
        tokens=tokens,
        unique_lemmas=unique_lemmas,
        lemma_frequencies=lemma_freq,
        multi_word_expressions=mwes,
    )


async def lemmatize_script_async(text: str, doc=None) -> LemmaResult:
    """
    Await `lemmatize_script` on the NLP worker thread.

    Use this from `async def` handlers — parsing a full script directly on the
    event loop blocks every other request in the process (issue #117). Pass
    `doc` when the caller already parsed this script (issue #140); the hop is
    still needed, since the token loop below is itself CPU-bound.
    """
    from src.utils.nlp_executor import run_nlp

    return await run_nlp(lemmatize_script, text, doc=doc)


def _detect_multi_word_expressions(text: str) -> List[LemmaToken]:
    """Detect phrasal verbs and idioms from the text."""
    text_lower = text.lower()
    mwes = []
    seen = set()

    # Check longest expressions first
    for expr, level in sorted(ALL_MULTI_WORD_EXPRESSIONS.items(), key=lambda x: -len(x[0])):
        if expr in text_lower and expr not in seen:
            # Determine type based on which dict it came from
            pos = "VERB" if expr in PHRASAL_VERBS else "ADJ"  # idioms mapped to ADJ as convention
            mwes.append(LemmaToken(
                word=expr,
                lemma=expr,
                pos=pos,
                is_multi_word=True,
            ))
            seen.add(expr)

    return mwes


async def populate_lemma_registry(
    db: Prisma,
    movie_id: int,
    lemma_result: LemmaResult,
    classifications: Dict[str, Dict],
) -> Dict[str, int]:
    """
    Upsert lemmas into the global Lemma registry and create MovieLemmaMapping entries.

    Args:
        db: Prisma client
        movie_id: Movie ID
        lemma_result: Output from lemmatize_script()
        classifications: Dict of lemma -> {cefr_level, confidence, source, frequency_rank, pos}
                        from the CEFR classifier results

    Returns:
        Dict of lemma -> lemma_id for downstream use
    """
    lemma_id_map: Dict[str, int] = {}
    total_lemmas = len(lemma_result.unique_lemmas)

    # Process single-word lemmas
    for lemma_str, token in lemma_result.unique_lemmas.items():
        cls = classifications.get(lemma_str, {})
        # spaCy's lemma set and the classifier's don't match exactly, so some
        # lemmas arrive with no classification at all. Defaulting those to A2
        # was #91's mistake in miniature — it is how "adumbrate" and "asse"
        # became beginner vocabulary in the registry (83 such lemmas in prod,
        # all at confidence 0). They belong in the same holding pen as
        # everything else the classifier could not place (#119).
        cefr_level = cls.get("cefr_level") or "UNKNOWN"
        confidence = cls.get("confidence", 0.0)
        source = cls.get("source", "fallback")
        frequency_rank = cls.get("frequency_rank")
        freq_in_movie = lemma_result.lemma_frequencies.get(lemma_str, 1)

        priority = compute_priority_score(
            frequency_rank=frequency_rank,
            total_lemmas=total_lemmas,
            cefr_level=cefr_level,
        )

        # Upsert into Lemma table
        existing = await db.lemma.find_unique(where={"lemma": lemma_str})

        if existing:
            # Update: increment movie count, keep higher confidence, update priority
            new_priority = max(existing.priorityScore, priority)
            new_confidence = max(existing.confidence, confidence)
            update_data = {
                "totalMovieCount": existing.totalMovieCount + 1,
                "priorityScore": new_priority,
            }
            if new_confidence > existing.confidence:
                update_data["confidence"] = new_confidence
                update_data["source"] = source
                update_data["cefrLevel"] = cefr_level

            await db.lemma.update(where={"id": existing.id}, data=update_data)
            lemma_id_map[lemma_str] = existing.id
        else:
            # Create new lemma
            # Collect word forms from tokens
            word_forms = list(set(
                t.word.lower() for t in lemma_result.tokens if t.lemma == lemma_str
            ))

            created = await db.lemma.create(
                data={
                    "lemma": lemma_str,
                    "pos": token.pos,
                    "cefrLevel": cefr_level,
                    "confidence": confidence,
                    "source": source,
                    "frequencyRank": frequency_rank,
                    "wordForms": Json(word_forms),
                    "isMultiWord": False,
                    "priorityScore": priority,
                    "totalMovieCount": 1,
                }
            )
            lemma_id_map[lemma_str] = created.id

        # Create MovieLemmaMapping
        try:
            await db.movielemmamapping.create(
                data={
                    "movieId": movie_id,
                    "lemmaId": lemma_id_map[lemma_str],
                    "frequencyInMovie": freq_in_movie,
                }
            )
        except Exception:
            # Unique constraint violation — mapping already exists, update frequency
            existing_mapping = await db.movielemmamapping.find_first(
                where={"movieId": movie_id, "lemmaId": lemma_id_map[lemma_str]}
            )
            if existing_mapping:
                await db.movielemmamapping.update(
                    where={"id": existing_mapping.id},
                    data={"frequencyInMovie": freq_in_movie},
                )

    # Process multi-word expressions
    for mwe in lemma_result.multi_word_expressions:
        cls = classifications.get(mwe.lemma, {})
        cefr_level = cls.get("cefr_level")
        if not cefr_level:
            # Fall back to the known MWE CEFR level
            cefr_level = ALL_MULTI_WORD_EXPRESSIONS.get(mwe.lemma, "B1")
        confidence = cls.get("confidence", 0.8)
        source = cls.get("source", "fallback")

        priority = compute_priority_score(
            frequency_rank=None,
            total_lemmas=total_lemmas,
            cefr_level=cefr_level,
        )

        existing = await db.lemma.find_unique(where={"lemma": mwe.lemma})

        if existing:
            await db.lemma.update(
                where={"id": existing.id},
                data={
                    "totalMovieCount": existing.totalMovieCount + 1,
                    "priorityScore": max(existing.priorityScore, priority),
                },
            )
            lemma_id_map[mwe.lemma] = existing.id
        else:
            # Generate word forms for MWE
            words = mwe.lemma.split()
            word_forms = [mwe.lemma]  # MWEs store the base form

            created = await db.lemma.create(
                data={
                    "lemma": mwe.lemma,
                    "pos": mwe.pos,
                    "cefrLevel": cefr_level,
                    "confidence": confidence,
                    "source": source,
                    "frequencyRank": None,
                    "wordForms": Json(word_forms),
                    "isMultiWord": True,
                    "priorityScore": priority,
                    "totalMovieCount": 1,
                }
            )
            lemma_id_map[mwe.lemma] = created.id

        # Create MovieLemmaMapping for MWE
        try:
            await db.movielemmamapping.create(
                data={
                    "movieId": movie_id,
                    "lemmaId": lemma_id_map[mwe.lemma],
                    "frequencyInMovie": 1,
                }
            )
        except Exception:
            pass  # Already exists

    logger.info(
        f"Lemma registry: {len(lemma_id_map)} lemmas processed for movie {movie_id} "
        f"({len(lemma_result.multi_word_expressions)} MWEs)"
    )

    return lemma_id_map


# --- Lemma registry backfill (issue #145) -----------------------------------
#
# This runs as a background task on the API's event loop (see
# routes/cefr.py::backfill_lemmas), so nothing in it may hold the loop or the
# process's memory for long. The original version did both: it read every
# word_classifications row (4.83M in prod, 471 MB on disk) into Prisma model
# objects to group them in Python, then read every movie_scripts row —
# including cleaned_script_text, ~178 MB of it — only to build an int->int map,
# then issued two queries per classification row (~9.6M round trips) to write
# the mappings. All three are set operations Postgres can do itself, so the API
# process now never holds more than the ~35.6k aggregated rows.

# One row per distinct lemma: its highest-confidence classification. DISTINCT
# ON is Postgres' "keep the first row of each group", and the ORDER BY decides
# which row that is — the same rule as the old `if confidence > best` loop.
_BEST_CLASSIFICATION_SQL = """
    SELECT DISTINCT ON (LOWER(BTRIM(lemma)))
           LOWER(BTRIM(lemma)) AS lemma,
           pos,
           cefr_level::text AS cefr_level,
           confidence,
           source::text AS source,
           frequency_rank
    FROM word_classifications
    WHERE BTRIM(lemma) <> ''
    ORDER BY LOWER(BTRIM(lemma)), confidence DESC
"""

# movie_scripts.movie_id is UNIQUE, so distinct script_id is distinct movie —
# the same number the old code got from a set of script ids per lemma.
_LEMMA_MOVIE_COUNT_SQL = """
    SELECT LOWER(BTRIM(lemma)) AS lemma,
           COUNT(DISTINCT script_id)::int AS movie_count
    FROM word_classifications
    WHERE BTRIM(lemma) <> ''
    GROUP BY 1
"""

# Rows arrive as one jsonb parameter rather than one placeholder per column per
# row: 8 columns x 1,000 rows would be 8,000 bind parameters, past what a
# single statement can carry. jsonb also carries SQL NULL for a missing pos or
# frequency_rank without a per-column type dance.
#
# DO UPDATE deliberately touches only the two derived columns. pos, cefr_level,
# confidence and source are left alone on a lemma that already exists, because
# the registry is also written by register_lemmas_for_movie and by the admin
# re-grading paths — a migration re-run must not roll those back. This is the
# same split the old find_unique/update/create branch made.
_LEMMA_UPSERT_SQL = """
    INSERT INTO lemmas (
        lemma, pos, cefr_level, confidence, source, frequency_rank,
        word_forms, is_multi_word, priority_score, total_movie_count,
        updated_at
    )
    SELECT r.lemma,
           r.pos,
           r.cefr_level::proficiencylevel,
           r.confidence,
           r.source::classificationsource,
           r.frequency_rank,
           TO_JSONB(ARRAY[r.lemma]),
           POSITION(' ' IN r.lemma) > 0,
           r.priority_score,
           r.movie_count,
           NOW()
    FROM JSONB_TO_RECORDSET($1::jsonb) AS r(
        lemma text,
        pos text,
        cefr_level text,
        confidence double precision,
        source text,
        frequency_rank int,
        priority_score double precision,
        movie_count int
    )
    ON CONFLICT (lemma) DO UPDATE
    SET total_movie_count = EXCLUDED.total_movie_count,
        priority_score = EXCLUDED.priority_score,
        updated_at = NOW()
"""

# The script -> movie dict the old code built in Python is this JOIN. As a join
# Postgres reads only movie_scripts' id and movie_id; cleaned_script_text sits
# in TOAST storage and is never decompressed, let alone shipped to the API.
_MAPPING_INSERT_SQL = """
    INSERT INTO movie_lemma_mappings (movie_id, lemma_id, frequency_in_movie)
    SELECT DISTINCT ms.movie_id, l.id, 1
    FROM word_classifications wc
    JOIN movie_scripts ms ON ms.id = wc.script_id
    JOIN lemmas l ON l.lemma = LOWER(BTRIM(wc.lemma))
    WHERE wc.script_id = ANY($1::int[])
    ON CONFLICT (movie_id, lemma_id) DO NOTHING
"""

_SCRIPT_IDS_SQL = "SELECT id FROM movie_scripts ORDER BY id"

# Lemmas per upsert statement: 35.6k lemmas is ~36 statements of ~180 KB of
# JSON each.
LEMMA_UPSERT_CHUNK = 1000

# Scripts per mapping statement. Prod averages ~1,100 classifications per
# script, so 100 scripts is ~110k candidate pairs — bounded work and a bounded
# transaction, rather than one INSERT spanning all 4.83M rows.
MAPPING_SCRIPT_CHUNK = 100


def _build_lemma_upsert_payloads(
    best_rows: List[Dict[str, Any]],
    count_rows: List[Dict[str, Any]],
    chunk_size: int = LEMMA_UPSERT_CHUNK,
) -> List[Tuple[str, int]]:
    """
    Join the two aggregates, score every lemma, and serialize the upsert chunks.

    Pure CPU and no I/O, which is why the caller hands it to `run_cpu` instead
    of running it inline: scoring 35.6k lemmas measures ~17ms and serializing
    them ~33ms, both past the ~10ms the event loop can absorb. One hop for the
    whole batch, never one per lemma — see utils/offload.

    Returns (json payload, rows in it) per chunk.
    """
    movie_counts = {r["lemma"]: r["movie_count"] for r in count_rows}
    total = len(best_rows)

    scored = [
        {
            "lemma": r["lemma"],
            "pos": r["pos"],
            "cefr_level": r["cefr_level"],
            "confidence": r["confidence"],
            "source": r["source"],
            "frequency_rank": r["frequency_rank"],
            "movie_count": movie_counts.get(r["lemma"], 0),
            "priority_score": compute_priority_score(
                frequency_rank=r["frequency_rank"],
                total_lemmas=total,
                cefr_level=r["cefr_level"],
            ),
        }
        for r in best_rows
    ]

    chunks = [scored[i : i + chunk_size] for i in range(0, len(scored), chunk_size)]
    return [(json.dumps(chunk), len(chunk)) for chunk in chunks]


async def backfill_lemmas_from_classifications(db: Prisma) -> int:
    """
    Migration script: Backfill Lemma table from existing WordClassification entries.
    Run ONCE after Phase 1 deployment.

    Returns number of lemmas upserted.
    """
    from src.utils.offload import run_cpu

    logger.info("Starting Lemma backfill from WordClassification...")

    best_rows = await db.query_raw(_BEST_CLASSIFICATION_SQL)
    count_rows = await db.query_raw(_LEMMA_MOVIE_COUNT_SQL)

    # No cpu_slot around the hop: there is exactly one caller, it is admin-only,
    # and shedding it would abort a migration rather than protect anything.
    chunks = await run_cpu(_build_lemma_upsert_payloads, best_rows, count_rows)
    total = sum(rows for _, rows in chunks)

    created_count = 0
    for chunk_no, (payload, rows) in enumerate(chunks, start=1):
        try:
            await db.execute_raw(_LEMMA_UPSERT_SQL, payload)
        except Exception as e:
            logger.warning(f"Failed to upsert lemma chunk {chunk_no}: {e}")
            continue
        created_count += rows
        logger.info(f"Backfill progress: {created_count}/{total}")

    # Now backfill MovieLemmaMapping. Only the script ids come back here; the
    # script -> movie resolution happens inside _MAPPING_INSERT_SQL's JOIN.
    script_rows = await db.query_raw(_SCRIPT_IDS_SQL)
    script_ids = [r["id"] for r in script_rows]

    mapping_count = 0
    for i in range(0, len(script_ids), MAPPING_SCRIPT_CHUNK):
        chunk = script_ids[i : i + MAPPING_SCRIPT_CHUNK]
        mapping_count += await db.execute_raw(_MAPPING_INSERT_SQL, chunk)

    logger.info(
        f"Backfill complete: {created_count} lemmas upserted, "
        f"{mapping_count} movie-lemma mappings created"
    )
    return created_count
