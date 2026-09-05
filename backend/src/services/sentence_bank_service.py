"""
Sentence Bank Service (V2 Context-Aware Translation Pipeline — Phase 2)

Deduplicates sentences across movies using SHA256 hashing.
Creates SentenceLemmaLink entries to connect sentences to lemmas.
Works alongside existing WordSentenceExample (dual-write).
"""

import hashlib
import logging
from functools import partial
from typing import Dict, List, Optional, Set, Tuple

from prisma import Prisma
from prisma.errors import UniqueViolationError

from src.utils.nlp_executor import nlp_slot, run_nlp

logger = logging.getLogger(__name__)


def hash_sentence(sentence: str) -> str:
    """
    Normalize and hash a sentence for deduplication.
    Same sentence from different movies produces same hash.
    """
    normalized = sentence.lower().strip()
    # Collapse whitespace
    normalized = " ".join(normalized.split())
    # Strip trailing punctuation variance ("Hello." == "Hello!" for dedup)
    normalized = normalized.rstrip(".!?;:,")
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


async def persist_sentence_with_links(
    db: Prisma,
    *,
    sentence: str,
    links: List[dict],
    movie_id: Optional[int] = None,
    source: Optional[str] = None,
    label: str = "",
) -> Optional[int]:
    """Write a sentence and every lemma link it needs, or write nothing.

    The one place either pipeline is allowed to create a `sentence_bank` row,
    because a sentence without a `sentence_lemma_links` row is unreachable.
    Every study surface finds a sentence *through* its link, so an unlinked one
    is an **orphan**: text that has been extracted or paid for and that nobody
    can ever be shown. Nothing looks broken on screen — the only trace is
    `orphan_sentences` climbing on /admin/health/vocab-coverage.

    Both pipelines used to write the two rows independently, and both made
    orphans the same two ways:

    * **the process died between the writes.** A Railway deploy restarts the
      workers, and main was pushed six times on 2026-09-05 alone;
    * **the link insert caught `Exception` and did nothing with it.** That
      handler was written for the duplicate-key case, where a no-op is exactly
      right, but it also swallowed connection resets, foreign-key failures and
      timeouts — and left the sentence behind, in silence.

    Orphans do not self-heal, which is why this is worth a transaction. The
    lemma stays in the backlog because it still has no link, so it is retried —
    and the retry produces a *different* sentence, which hashes differently and
    becomes a *different* row. The first one is stranded for good.

    `links` are dicts without `sentenceId`; this fills that in. Returns the
    sentence id, or None when nothing could be written.

    Note `isGlobal` must never appear in a link: a trigger derives it from the
    sentence row (#120), and setting it here would create a second source of
    truth for the flag every study surface filters on.
    """
    if not links:
        # Refusing to write an unlinkable sentence is half the fix. The
        # subtitle path used to write every sentence it had extracted and then
        # skip the link for any word whose lemma was not in the registry —
        # manufacturing orphans on every ingestion, by design.
        return None

    sent_hash = hash_sentence(sentence)
    where = {"sentenceHash": sent_hash, "movieId": movie_id}
    data = {"sentenceHash": sent_hash, "sentence": sentence, "movieId": movie_id}
    if source is not None:
        data["source"] = source

    try:
        existing = await db.sentencebank.find_first(where=where)
        if existing is not None:
            return existing.id if await _create_links(db, existing.id, links, label) else None

        # A new sentence and its links go together. Nothing inside may catch an
        # error and carry on: a failed statement aborts the whole transaction
        # in Postgres, so the retry for a lost race has to happen out here,
        # after the rollback.
        async with db.tx() as tx:
            row = await tx.sentencebank.create(data=data)
            for link in links:
                await tx.sentencelemmalink.create(data={"sentenceId": row.id, **link})
        return row.id

    except UniqueViolationError:
        # Another writer created the same sentence between the lookup and the
        # insert. The transaction rolled back, so there is no orphan to clean
        # up — link to the winner's row instead.
        existing = await db.sentencebank.find_first(where=where)
        if existing is None:
            logger.warning(
                "[sentence-bank] lost the insert race for %s but the winning row "
                "is not there either; skipping", label or sent_hash[:8]
            )
            return None
        return existing.id if await _create_links(db, existing.id, links, label) else None

    except Exception as e:
        logger.warning("[sentence-bank] persist failed for %s: %s", label or sent_hash[:8], e)
        return None


async def _create_links(db: Prisma, sentence_id: int, links: List[dict], label: str) -> bool:
    """Attach an existing sentence to its lemmas. Each insert is one statement,
    so each is atomic on its own; the sentence is already durable."""
    ok = True
    for link in links:
        try:
            await db.sentencelemmalink.create(data={"sentenceId": sentence_id, **link})
        except UniqueViolationError:
            # (sentence_id, lemma_id) is unique and already present — the row we
            # wanted exists, from an earlier run or a concurrent writer. The one
            # failure that is really the desired end state.
            continue
        except Exception as e:
            logger.warning("[sentence-bank] link failed for %s: %s", label or sentence_id, e)
            ok = False
    return ok


async def populate_sentence_bank(
    db: Prisma,
    movie_id: int,
    word_sentences: Dict[str, List[Tuple[str, int]]],
    lemma_id_map: Dict[str, int],
    word_to_lemma: Dict[str, str],
) -> Dict[str, int]:
    """
    Store extracted sentences in SentenceBank and create SentenceLemmaLink entries.

    Args:
        db: Prisma client
        movie_id: Movie ID
        word_sentences: Dict of word -> [(sentence, word_position)] from SentenceExampleService
        lemma_id_map: Dict of lemma_str -> lemma_id from the Lemma registry
        word_to_lemma: Dict of word -> lemma_str (from classifications)

    Returns:
        Dict of sentence_hash -> sentence_bank_id
    """
    sentence_id_map: Dict[str, int] = {}

    # Plan every link BEFORE writing a single sentence.
    #
    # This ordering is the fix. The old shape wrote all the sentences in one
    # loop and linked them in a second, so a word whose lemma was missing from
    # the registry (`if not lemma_id: continue`) left its sentence written and
    # unreachable — an orphan manufactured on every ingestion, by design, on
    # top of the ones a mid-write crash left behind. A sentence nothing will
    # link to is now simply never written.
    #
    # Sentences are scoped per movie: two films that share a line ("I love
    # you") each get their own row, so the per-movie batch endpoint query stays
    # simple.
    planned: Dict[str, Tuple[str, List[dict]]] = {}   # hash -> (sentence, links)
    unlinkable: Set[str] = set()
    for word, sent_list in word_sentences.items():
        lemma_str = word_to_lemma.get(word.lower(), word.lower())
        lemma_id = lemma_id_map.get(lemma_str)
        for sentence, position in sent_list:
            h = hash_sentence(sentence)
            if not lemma_id:
                unlinkable.add(h)
                continue
            entry = planned.setdefault(h, (sentence, []))
            # One row per (sentence, lemma) — the pair is unique, and the same
            # lemma can legitimately reach one sentence through two surface
            # forms.
            if any(link["lemmaId"] == lemma_id for link in entry[1]):
                continue
            entry[1].append({
                "lemmaId": lemma_id,
                "wordPosition": position,
                # Stored so /sentences can highlight the token without
                # re-running spaCy on every cached sentence per request.
                # extract_word_sentences matches by literal token equality,
                # so the dict key (`word`) IS the surface form in the sentence.
                "matchedForm": word.lower(),
                "score": 1.0,          # Default score; Phase 3 will refine
                "isRepresentative": False,  # Phase 3 sets representatives
            })

    links_planned = 0
    for sent_hash, (sentence, links) in planned.items():
        sentence_id = await persist_sentence_with_links(
            db,
            sentence=sentence,
            links=links,
            movie_id=movie_id,
            label=f"movie={movie_id}",
        )
        if sentence_id is not None:
            sentence_id_map[sent_hash] = sentence_id
            links_planned += len(links)

    skipped = len(unlinkable - set(planned))
    logger.info(
        "SentenceBank: movie %s — %s sentences stored, %s links, "
        "%s sentences skipped (no lemma in the registry to link them to)",
        movie_id, len(sentence_id_map), links_planned, skipped,
    )

    return sentence_id_map


async def fill_movie_sentence_bank_gaps(
    db: Prisma,
    movie_id: int,
) -> Dict[str, int]:
    """
    Cheap incremental pass for already-indexed movies. Finds classified
    words that have NO link in sentence_lemma_links for this movie, runs a
    literal whole-word regex fallback against the script, and writes a link
    for any match. Skips the spaCy pass entirely.

    Use this when you've already backfilled with an older/less thorough
    indexer and want to fill in the gaps without re-indexing from scratch.
    Idempotent: re-running adds nothing once gaps are closed.
    """
    import re as _re
    from src.services.sentence_example_service import SentenceExampleService

    movie = await db.movie.find_unique(
        where={"id": movie_id},
        include={"movieScripts": True},
    )
    if not movie or not movie.movieScripts or not movie.movieScripts[0].cleanedScriptText:
        return {"status": "no_script", "movie_id": movie_id}
    script_text = movie.movieScripts[0].cleanedScriptText

    classifications = await db.wordclassification.find_many(
        where={"scriptId": movie.movieScripts[0].id}
    )
    if not classifications:
        return {"status": "no_classifications", "movie_id": movie_id}

    unique_lemmas = list({wc.lemma.lower() for wc in classifications})
    lemma_records = await db.lemma.find_many(where={"lemma": {"in": unique_lemmas}})
    lemma_id_map = {lr.lemma: lr.id for lr in lemma_records}
    if not lemma_id_map:
        return {"status": "no_lemma_records", "movie_id": movie_id}

    # Find lemmas that already have at least one link for this movie.
    rows = await db.query_raw(
        """
        SELECT DISTINCT sll.lemma_id
        FROM sentence_lemma_links sll
        JOIN sentence_bank sb ON sb.id = sll.sentence_id
        WHERE sb.movie_id = $1
        """,
        movie_id,
    )
    lemma_ids_with_links = {int(r["lemma_id"]) for r in rows}
    lemmas_with_links = {l for l, lid in lemma_id_map.items() if lid in lemma_ids_with_links}

    sentence_service = SentenceExampleService()
    sentences_split = sentence_service.split_into_sentences(script_text)

    sentences_created = 0
    sentences_reused = 0
    links_created = 0

    seen_classifications: Set[str] = set()
    for wc in classifications:
        word = wc.word.lower()
        lemma = wc.lemma.lower()
        if word in seen_classifications:
            continue
        seen_classifications.add(word)
        if lemma not in lemma_id_map or lemma in lemmas_with_links:
            continue

        pat = _re.compile(rf"\b{_re.escape(word)}\b", _re.IGNORECASE)
        best = None
        for sent in sentences_split:
            if not pat.search(sent):
                continue
            tokens = sentence_service.tokenize_sentence(sent)
            if sentence_service.MIN_SENTENCE_WORDS <= len(tokens) <= sentence_service.MAX_SENTENCE_WORDS:
                best = sent
                break
            if best is None:
                best = sent
        if best is None:
            continue

        # Write SentenceBank row (or reuse) + link together, scoped per-movie.
        tokens = sentence_service.tokenize_sentence(best)
        pos = next((i for i, t in enumerate(tokens) if t == word), 0)
        sentence_id = await persist_sentence_with_links(
            db,
            sentence=best,
            movie_id=movie_id,
            label=f"movie={movie_id} lemma={lemma}",
            links=[{
                "lemmaId": lemma_id_map[lemma],
                "wordPosition": pos,
                "matchedForm": word,
                "score": 0.5,  # lower than spaCy-matched (1.0) so prefer those
                "isRepresentative": False,
            }],
        )
        if sentence_id is None:
            continue
        sentences_created += 1
        links_created += 1
        lemmas_with_links.add(lemma)

    return {
        "status": "filled",
        "movie_id": movie_id,
        "sentences_created": sentences_created,
        "sentences_reused": sentences_reused,
        "links_created": links_created,
    }


def extract_lemma_sentences(
    script_text: str,
    target_lemmas: Set[str],
    word_to_lemma: Dict[str, str],
    max_per_lemma: int,
) -> Dict[str, List[Tuple[str, int, str]]]:
    """
    Every example sentence a script can supply, as one blocking call.

    Two passes over the same text, deliberately kept in one function: the
    spaCy pass that catches inflected forms ("ran" for "run"), and the
    literal whole-word regex fallback that covers whatever the parse missed.
    Both are CPU-bound and script-sized — on a 126k-char script, 1.6-2.9s for
    the parse (#140) and a measured ~0.2s of fallback per 1,000 words it
    missed — so both belong on the NLP worker thread, and on the *same* trip
    to it. Two hops would take two queue slots and let another caller's parse
    interleave between them for no gain (`utils/offload.py`).

    Pure by construction: no DB, no `await`, `nlp` resolved here rather than
    passed in, so the caller has nothing left to run on the event loop.

    Returns lemma → [(sentence, word_position, matched_form)]; lemmas with no
    sentence at all are absent.
    """
    import re as _re

    from src.services.lemmatization_service import get_nlp
    from src.services.sentence_example_service import SentenceExampleService

    sentence_service = SentenceExampleService()
    lemma_sentences = sentence_service.extract_sentences_for_lemmas(
        script_text,
        target_lemmas,
        get_nlp(),
        max_per_lemma=max_per_lemma,
    )

    # Gap-filler. Any classified (word, lemma) that didn't pick up a
    # sentence from the spaCy pass — usually because of a lemma-matching
    # disagreement or a sentence-quality filter — gets a literal whole-word
    # regex fallback so every classified word that appears as a standalone
    # token in the script gets at least one example. This is what the user
    # actually expects: "the word is in the script, just find a sentence."
    sentences_split = sentence_service.split_into_sentences(script_text)
    for word, lemma in word_to_lemma.items():
        if lemma not in target_lemmas:
            continue
        if lemma_sentences.get(lemma):
            continue
        # Literal whole-word search — first hit wins.
        pat = _re.compile(rf"\b{_re.escape(word)}\b", _re.IGNORECASE)
        best = None
        for sent in sentences_split:
            if pat.search(sent):
                # Use the matcher's standard length filters; fall back to
                # accepting any length if nothing matches in range.
                tokens = sentence_service.tokenize_sentence(sent)
                if sentence_service.MIN_SENTENCE_WORDS <= len(tokens) <= sentence_service.MAX_SENTENCE_WORDS:
                    best = sent
                    break
                if best is None:  # remember first match as last-resort
                    best = sent
        if best is not None:
            tokens = sentence_service.tokenize_sentence(best)
            pos = next((i for i, t in enumerate(tokens) if t == word), 0)
            lemma_sentences.setdefault(lemma, []).append((best, pos, word))

    return lemma_sentences


async def populate_movie_sentence_bank(
    db: Prisma,
    movie_id: int,
    *,
    skip_if_exists: bool = True,
    max_per_lemma: int = 3,
    max_pending: Optional[int] = None,
) -> Dict[str, int]:
    """
    Translation-free SentenceBank population for one movie. Stores up to
    `max_per_lemma` sentences per classified lemma so the For You row + the
    expanded view can pull straight from the DB without ever running spaCy
    at request time.

    Uses lemma-based matching (one spaCy pass over the full script) so
    inflected forms — "ran" for "run", "aborted" for "abort" — are caught
    at index time. Falls back to short-line padding when the script is
    mostly screenplay dialogue.

    Idempotent: skips if the movie already has SentenceBank rows when
    skip_if_exists is True (default).

    Every CPU-bound step runs on the NLP worker thread (issue #142). This is
    reached from a FastAPI `BackgroundTask`, which is not offloading — it runs
    on the event loop, just after the response is sent — so an inline parse
    here stalled every other request in the process.

    `max_pending`, when given, reserves a slot in that worker's queue and
    raises `NLPOverloaded` if it is already full. The API path passes it so a
    burst of first-time movie opens sheds instead of piling multi-second
    parses in front of user-facing ones; population is idempotent and refires
    on the next classification, so a shed costs nothing but a delay. Offline
    callers (the backfill script, the movie worker) leave it unset.

    Used by:
      • the background task that fires after classify-script
      • the backfill_sentence_bank.py script

    Returns a small stats dict so callers can log what happened.
    """
    if skip_if_exists:
        existing = await db.sentencebank.find_first(where={"movieId": movie_id})
        if existing:
            return {"status": "already_populated", "movie_id": movie_id}

    movie = await db.movie.find_unique(
        where={"id": movie_id},
        include={"movieScripts": True},
    )
    if not movie or not movie.movieScripts:
        return {"status": "no_script", "movie_id": movie_id}
    script = movie.movieScripts[0]
    if not script.cleanedScriptText:
        return {"status": "empty_script", "movie_id": movie_id}

    classifications = await db.wordclassification.find_many(where={"scriptId": script.id})
    if not classifications:
        return {"status": "no_classifications", "movie_id": movie_id}

    # Resolve lemma → id in a single batched query.
    unique_lemmas = list({wc.lemma.lower() for wc in classifications})
    lemma_records = await db.lemma.find_many(where={"lemma": {"in": unique_lemmas}})
    lemma_id_map = {lr.lemma: lr.id for lr in lemma_records}

    if not lemma_id_map:
        return {
            "status": "no_lemma_records",
            "movie_id": movie_id,
            "missing_lemmas": len(unique_lemmas),
        }

    # One spaCy pass over the script catches every inflected form for every
    # target lemma, and the regex gap-filler mops up the rest — both on the
    # worker thread, in a single hop, because this whole function runs on the
    # event loop otherwise (issue #142).
    word_to_lemma_lower: Dict[str, str] = {wc.word.lower(): wc.lemma.lower() for wc in classifications}
    extract = partial(
        extract_lemma_sentences,
        script.cleanedScriptText,
        set(lemma_id_map.keys()),
        word_to_lemma_lower,
        max_per_lemma,
    )
    if max_pending is not None:
        with nlp_slot(max_pending):
            lemma_sentences = await run_nlp(extract)
    else:
        lemma_sentences = await run_nlp(extract)

    # Write SentenceBank rows (deduped by hash), then SentenceLemmaLink rows.
    sentence_id_by_hash: Dict[str, int] = {}
    sentences_created = 0
    sentences_reused = 0

    # Plan the links first, then write each sentence together with its own —
    # same ordering, and for the same reason, as populate_sentence_bank above.
    # A sentence whose lemma is not in the registry is not written at all,
    # rather than written and left unreachable.
    planned: Dict[str, Tuple[str, List[dict]]] = {}   # hash -> (sentence, links)
    for lemma, sents in lemma_sentences.items():
        lemma_id = lemma_id_map.get(lemma)
        if lemma_id is None:
            continue
        for sent_text, pos, matched_form in sents:
            h = hash_sentence(sent_text)
            entry = planned.setdefault(h, (sent_text, []))
            if any(link["lemmaId"] == lemma_id for link in entry[1]):
                continue
            entry[1].append({
                "lemmaId": lemma_id,
                "wordPosition": pos,
                "matchedForm": matched_form,
                "score": 1.0,
                "isRepresentative": False,
            })

    links_created = 0
    for h, (sent_text, links) in planned.items():
        sentence_id = await persist_sentence_with_links(
            db,
            sentence=sent_text,
            links=links,
            movie_id=movie_id,
            label=f"movie={movie_id}",
        )
        if sentence_id is not None:
            sentence_id_by_hash[h] = sentence_id
            sentences_created += 1
            links_created += len(links)

    logger.info(
        "SentenceBank: movie %s — %s sentences stored, %s lemma links",
        movie_id, len(sentence_id_by_hash), links_created,
    )

    return {
        "status": "populated",
        "movie_id": movie_id,
        "vocabulary_lemmas": len(unique_lemmas),
        "lemmas_resolved": len(lemma_id_map),
        "lemmas_with_sentences": len(lemma_sentences),
        "sentences_created": sentences_created,
        "sentences_reused": sentences_reused,
        "links_created": links_created,
    }


async def get_llm_examples_for_lemmas(
    db: Prisma, lemmas: List[str]
) -> Dict[str, str]:
    """Best global LLM-authored example sentence per lemma.

    Only rows with movie_id IS NULL AND source = 'llm' qualify — the
    Haiku-generated pedagogical sentences (same filter Today's Word uses).
    Subtitle-extracted rows are never returned: raw dialogue lines make
    poor study examples (fragments, character names, missing context).
    Within a lemma we prefer the representative link, then the highest
    score, then the oldest row for stability.

    That filter is spelled `sll.is_global` (#120) — the same predicate,
    denormalized onto the link and kept true by trigger, so it reads a 2 MB
    partial index instead of the 1.0 GB link relation. `sll.sentence_id` is
    `sb.id`, stated on the link side so the ORDER BY matches the index key.
    """
    if not lemmas:
        return {}
    rows = await db.query_raw(
        """
        SELECT DISTINCT ON (l.lemma)
               l.lemma,
               sb.sentence
        FROM lemmas l
        JOIN sentence_lemma_links sll ON sll.lemma_id = l.id
        JOIN sentence_bank sb ON sb.id = sll.sentence_id
        WHERE l.lemma = ANY($1::text[])
          AND sll.is_global
        ORDER BY
          l.lemma,
          sll.is_representative DESC,
          sll.score DESC NULLS LAST,
          sll.sentence_id ASC
        """,
        lemmas,
    )
    return {r["lemma"]: r["sentence"] for r in rows}
