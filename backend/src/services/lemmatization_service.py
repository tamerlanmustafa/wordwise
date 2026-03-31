"""
Lemmatization Service (V2 Context-Aware Translation Pipeline)

Uses spaCy for tokenization, lemmatization, and POS tagging.
Populates the global Lemma registry and MovieLemmaMapping table.
Works alongside the existing CEFR classifier (dual-write).
"""

import logging
import hashlib
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass, field
from functools import lru_cache

import spacy
from prisma import Prisma
from prisma import Json

from src.services.cefr_classifier import PHRASAL_VERBS, COMMON_IDIOMS

logger = logging.getLogger(__name__)

# Merge all known multi-word expressions with their CEFR levels
ALL_MULTI_WORD_EXPRESSIONS: Dict[str, str] = {**PHRASAL_VERBS, **COMMON_IDIOMS}

# spaCy model singleton
_nlp = None


def get_nlp():
    """Load spaCy model (singleton, ~12MB, loads once)."""
    global _nlp
    if _nlp is None:
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


# CEFR weight map for priority score computation
CEFR_WEIGHTS = {"A1": 0.1, "A2": 0.3, "B1": 0.5, "B2": 0.7, "C1": 0.9, "C2": 1.0}

# Priority score weights
FREQ_WEIGHT = 0.5
CEFR_WEIGHT = 0.3
USAGE_WEIGHT = 0.2

# Threshold for eager vs lazy translation
EAGER_THRESHOLD = 0.4


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


def lemmatize_script(text: str) -> LemmaResult:
    """
    Tokenize and lemmatize a full script using spaCy.

    Returns unique lemmas with POS tags and frequency counts.
    Also detects multi-word expressions (phrasal verbs, idioms).
    """
    nlp = get_nlp()

    # Process text in chunks if very long (spaCy max_length)
    nlp.max_length = max(len(text) + 1000, nlp.max_length)
    doc = nlp(text)

    tokens: List[LemmaToken] = []
    lemma_freq: Dict[str, int] = {}
    unique_lemmas: Dict[str, LemmaToken] = {}

    for token in doc:
        # Skip punctuation, spaces, and single characters
        if token.is_punct or token.is_space or len(token.text.strip()) <= 1:
            continue

        # Skip numbers
        if token.like_num or token.pos_ == "NUM":
            continue

        lemma = token.lemma_.lower().strip()
        pos = token.pos_

        # Skip if lemma is empty after normalization
        if not lemma:
            continue

        lt = LemmaToken(word=token.text, lemma=lemma, pos=pos)
        tokens.append(lt)

        lemma_freq[lemma] = lemma_freq.get(lemma, 0) + 1

        # Keep the first occurrence as representative
        if lemma not in unique_lemmas:
            unique_lemmas[lemma] = lt

    # Detect multi-word expressions
    mwes = _detect_multi_word_expressions(text)

    return LemmaResult(
        tokens=tokens,
        unique_lemmas=unique_lemmas,
        lemma_frequencies=lemma_freq,
        multi_word_expressions=mwes,
    )


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
        cefr_level = cls.get("cefr_level", "A2")
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


async def backfill_lemmas_from_classifications(db: Prisma) -> int:
    """
    Migration script: Backfill Lemma table from existing WordClassification entries.
    Run ONCE after Phase 1 deployment.

    Returns number of lemmas created.
    """
    logger.info("Starting Lemma backfill from WordClassification...")

    # Get all unique (lemma, cefrLevel) combos with highest confidence
    all_classifications = await db.wordclassification.find_many(
        order={"confidence": "desc"}
    )

    # Group by lemma, keep highest confidence
    best_by_lemma: Dict[str, Dict] = {}
    lemma_movie_map: Dict[str, set] = {}  # lemma -> set of script_ids

    for cls in all_classifications:
        lemma = cls.lemma.lower().strip()
        if not lemma:
            continue

        if lemma not in best_by_lemma or cls.confidence > best_by_lemma[lemma]["confidence"]:
            cefr = cls.cefrLevel if isinstance(cls.cefrLevel, str) else cls.cefrLevel.value
            source = cls.source if isinstance(cls.source, str) else cls.source.value
            best_by_lemma[lemma] = {
                "lemma": lemma,
                "pos": cls.pos,
                "cefr_level": cefr,
                "confidence": cls.confidence,
                "source": source,
                "frequency_rank": cls.frequencyRank,
            }

        if lemma not in lemma_movie_map:
            lemma_movie_map[lemma] = set()
        lemma_movie_map[lemma].add(cls.scriptId)

    created_count = 0
    total = len(best_by_lemma)

    for i, (lemma_str, data) in enumerate(best_by_lemma.items()):
        movie_count = len(lemma_movie_map.get(lemma_str, set()))
        priority = compute_priority_score(
            frequency_rank=data["frequency_rank"],
            total_lemmas=total,
            cefr_level=data["cefr_level"],
        )

        try:
            existing = await db.lemma.find_unique(where={"lemma": lemma_str})
            if existing:
                await db.lemma.update(
                    where={"id": existing.id},
                    data={
                        "totalMovieCount": movie_count,
                        "priorityScore": priority,
                    },
                )
            else:
                await db.lemma.create(
                    data={
                        "lemma": lemma_str,
                        "pos": data["pos"],
                        "cefrLevel": data["cefr_level"],
                        "confidence": data["confidence"],
                        "source": data["source"],
                        "frequencyRank": data["frequency_rank"],
                        "wordForms": Json([lemma_str]),
                        "isMultiWord": " " in lemma_str,
                        "priorityScore": priority,
                        "totalMovieCount": movie_count,
                    }
                )
            created_count += 1
        except Exception as e:
            logger.warning(f"Failed to upsert lemma '{lemma_str}': {e}")

        if (i + 1) % 500 == 0:
            logger.info(f"Backfill progress: {i + 1}/{total}")

    # Now backfill MovieLemmaMapping
    # Get script -> movie mapping
    scripts = await db.moviescript.find_many()
    script_to_movie = {s.id: s.movieId for s in scripts}

    mapping_count = 0
    for cls in all_classifications:
        lemma = cls.lemma.lower().strip()
        if not lemma:
            continue

        movie_id = script_to_movie.get(cls.scriptId)
        if not movie_id:
            continue

        lemma_record = await db.lemma.find_unique(where={"lemma": lemma})
        if not lemma_record:
            continue

        try:
            await db.movielemmamapping.create(
                data={
                    "movieId": movie_id,
                    "lemmaId": lemma_record.id,
                    "frequencyInMovie": 1,
                }
            )
            mapping_count += 1
        except Exception:
            pass  # Duplicate, skip

    logger.info(
        f"Backfill complete: {created_count} lemmas created, "
        f"{mapping_count} movie-lemma mappings created"
    )
    return created_count
