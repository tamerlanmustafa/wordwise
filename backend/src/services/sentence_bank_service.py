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

    # Batch upsert sentences into SentenceBank
    for sent_hash, (sentence, word, position) in all_sentences.items():
        existing = await db.sentencebank.find_unique(where={"sentenceHash": sent_hash})

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
                # Race condition: another process created it
                existing = await db.sentencebank.find_unique(where={"sentenceHash": sent_hash})
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
