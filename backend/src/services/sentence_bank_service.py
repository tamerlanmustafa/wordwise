"""
Sentence Bank Service (V2 Context-Aware Translation Pipeline — Phase 2)

Deduplicates sentences across movies using SHA256 hashing.
Creates SentenceLemmaLink entries to connect sentences to lemmas.
Works alongside existing WordSentenceExample (dual-write).
"""

import hashlib
import logging
from typing import Dict, List, Optional, Set, Tuple

from prisma import Prisma

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
    links_created = 0
    sentences_created = 0
    sentences_reused = 0

    # Collect all unique sentences first
    all_sentences: Dict[str, Tuple[str, str, int]] = {}  # hash -> (sentence, word, position)
    for word, sent_list in word_sentences.items():
        for sentence, position in sent_list:
            h = hash_sentence(sentence)
            if h not in all_sentences:
                all_sentences[h] = (sentence, word, position)

    # Batch upsert sentences into SentenceBank, scoped per-movie. Two
    # different movies that share a sentence ("I love you") each get their
    # own row so the per-movie batch endpoint query stays simple.
    for sent_hash, (sentence, word, position) in all_sentences.items():
        existing = await db.sentencebank.find_first(
            where={"sentenceHash": sent_hash, "movieId": movie_id}
        )

        if existing:
            sentence_id_map[sent_hash] = existing.id
            sentences_reused += 1
        else:
            try:
                created = await db.sentencebank.create(
                    data={
                        "sentenceHash": sent_hash,
                        "sentence": sentence,
                        "movieId": movie_id,
                    }
                )
                sentence_id_map[sent_hash] = created.id
                sentences_created += 1
            except Exception:
                # Race: another worker created (sentenceHash, movieId)
                existing = await db.sentencebank.find_first(
                    where={"sentenceHash": sent_hash, "movieId": movie_id}
                )
                if existing:
                    sentence_id_map[sent_hash] = existing.id
                    sentences_reused += 1

    # Create SentenceLemmaLink entries
    for word, sent_list in word_sentences.items():
        lemma_str = word_to_lemma.get(word.lower(), word.lower())
        lemma_id = lemma_id_map.get(lemma_str)

        if not lemma_id:
            continue

        for sentence, position in sent_list:
            sent_hash = hash_sentence(sentence)
            sentence_id = sentence_id_map.get(sent_hash)

            if not sentence_id:
                continue

            try:
                await db.sentencelemmalink.create(
                    data={
                        "sentenceId": sentence_id,
                        "lemmaId": lemma_id,
                        "wordPosition": position,
                        # Stored so /sentences can highlight the token without
                        # re-running spaCy on every cached sentence per request.
                        # extract_word_sentences matches by literal token equality,
                        # so the dict key (`word`) IS the surface form in the sentence.
                        "matchedForm": word.lower(),
                        "score": 1.0,  # Default score; Phase 3 will refine
                        "isRepresentative": False,  # Phase 3 sets representatives
                    }
                )
                links_created += 1
            except Exception:
                # Unique constraint (sentenceId, lemmaId) — already linked
                pass

    logger.info(
        f"SentenceBank: movie {movie_id} — "
        f"{sentences_created} new sentences, {sentences_reused} reused, "
        f"{links_created} lemma links created"
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

        # Write SentenceBank row (or reuse) + link, scoped per-movie.
        h = hash_sentence(best)
        existing = await db.sentencebank.find_first(
            where={"sentenceHash": h, "movieId": movie_id}
        )
        if existing:
            sentence_id = existing.id
            sentences_reused += 1
        else:
            try:
                created = await db.sentencebank.create(
                    data={"sentenceHash": h, "sentence": best, "movieId": movie_id}
                )
                sentence_id = created.id
                sentences_created += 1
            except Exception:
                existing = await db.sentencebank.find_first(
                    where={"sentenceHash": h, "movieId": movie_id}
                )
                if existing is None:
                    continue
                sentence_id = existing.id
                sentences_reused += 1

        tokens = sentence_service.tokenize_sentence(best)
        pos = next((i for i, t in enumerate(tokens) if t == word), 0)
        try:
            await db.sentencelemmalink.create(
                data={
                    "sentenceId": sentence_id,
                    "lemmaId": lemma_id_map[lemma],
                    "wordPosition": pos,
                    "matchedForm": word,
                    "score": 0.5,  # lower than spaCy-matched (1.0) so prefer those
                    "isRepresentative": False,
                }
            )
            links_created += 1
            lemmas_with_links.add(lemma)
        except Exception:
            pass

    return {
        "status": "filled",
        "movie_id": movie_id,
        "sentences_created": sentences_created,
        "sentences_reused": sentences_reused,
        "links_created": links_created,
    }


async def populate_movie_sentence_bank(
    db: Prisma,
    movie_id: int,
    *,
    skip_if_exists: bool = True,
    max_per_lemma: int = 3,
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

    Used by:
      • the background task that fires after classify-script
      • the backfill_sentence_bank.py script

    Returns a small stats dict so callers can log what happened.
    """
    from src.services.sentence_example_service import SentenceExampleService
    from src.services.lemmatization_service import get_nlp

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
    # target lemma. extract_sentences_for_lemmas also pads short dialogue
    # with the previous line so we don't drop one-token sentences.
    nlp = get_nlp()
    sentence_service = SentenceExampleService()
    lemma_sentences = sentence_service.extract_sentences_for_lemmas(
        script.cleanedScriptText,
        set(lemma_id_map.keys()),
        nlp,
        max_per_lemma=max_per_lemma,
    )

    # Gap-filler. Any classified (word, lemma) that didn't pick up a
    # sentence from the spaCy pass — usually because of a lemma-matching
    # disagreement or a sentence-quality filter — gets a literal whole-word
    # regex fallback so every classified word that appears as a standalone
    # token in the script gets at least one example. This is what the user
    # actually expects: "the word is in the script, just find a sentence."
    import re as _re
    word_to_lemma_lower: Dict[str, str] = {wc.word.lower(): wc.lemma.lower() for wc in classifications}
    sentences_split = sentence_service.split_into_sentences(script.cleanedScriptText)
    for word, lemma in word_to_lemma_lower.items():
        if lemma not in lemma_id_map:
            continue
        if lemma in lemma_sentences and lemma_sentences[lemma]:
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

    # Write SentenceBank rows (deduped by hash), then SentenceLemmaLink rows.
    sentence_id_by_hash: Dict[str, int] = {}
    sentences_created = 0
    sentences_reused = 0

    unique_sentences: Dict[str, str] = {}  # hash -> sentence text
    for sents in lemma_sentences.values():
        for sent_text, _pos, _form in sents:
            h = hash_sentence(sent_text)
            if h not in unique_sentences:
                unique_sentences[h] = sent_text

    for h, sent_text in unique_sentences.items():
        existing = await db.sentencebank.find_first(
            where={"sentenceHash": h, "movieId": movie_id}
        )
        if existing:
            sentence_id_by_hash[h] = existing.id
            sentences_reused += 1
            continue
        try:
            created = await db.sentencebank.create(
                data={"sentenceHash": h, "sentence": sent_text, "movieId": movie_id}
            )
            sentence_id_by_hash[h] = created.id
            sentences_created += 1
        except Exception:
            # Race: another worker created (sentenceHash, movieId) for this movie.
            existing = await db.sentencebank.find_first(
                where={"sentenceHash": h, "movieId": movie_id}
            )
            if existing:
                sentence_id_by_hash[h] = existing.id
                sentences_reused += 1

    links_created = 0
    for lemma, sents in lemma_sentences.items():
        lemma_id = lemma_id_map.get(lemma)
        if lemma_id is None:
            continue
        for sent_text, pos, matched_form in sents:
            sentence_id = sentence_id_by_hash.get(hash_sentence(sent_text))
            if sentence_id is None:
                continue
            try:
                await db.sentencelemmalink.create(
                    data={
                        "sentenceId": sentence_id,
                        "lemmaId": lemma_id,
                        "wordPosition": pos,
                        "matchedForm": matched_form,
                        "score": 1.0,
                        "isRepresentative": False,
                    }
                )
                links_created += 1
            except Exception:
                # Unique constraint (sentenceId, lemmaId) already exists
                pass

    logger.info(
        f"SentenceBank: movie {movie_id} — "
        f"{sentences_created} new sentences, {sentences_reused} reused, "
        f"{links_created} lemma links created"
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
          AND sb.movie_id IS NULL
          AND sb.source = 'llm'
        ORDER BY
          l.lemma,
          sll.is_representative DESC,
          sll.score DESC NULLS LAST,
          sb.id ASC
        """,
        lemmas,
    )
    return {r["lemma"]: r["sentence"] for r in rows}
