"""
Sense Clustering Service (V2 Context-Aware Translation Pipeline — Phase 3)

Clusters sentences for each lemma into distinct senses using TF-IDF.
Uses MiniLM for cross-movie sense reuse validation.
Provides runtime sense selection for word clicks.
"""

import logging
from typing import Dict, List, Optional, Tuple

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.cluster import AgglomerativeClustering
from sklearn.metrics.pairwise import cosine_similarity

from prisma import Prisma
from prisma import Json

logger = logging.getLogger(__name__)

# MiniLM model singleton (lazy-loaded, ~80MB)
_minilm_model = None


def get_minilm():
    """Load MiniLM model (singleton, loads once on first call)."""
    global _minilm_model
    if _minilm_model is None:
        logger.info("Loading MiniLM (all-MiniLM-L6-v2) model...")
        from sentence_transformers import SentenceTransformer
        _minilm_model = SentenceTransformer("all-MiniLM-L6-v2")
        logger.info("MiniLM model loaded")
    return _minilm_model


# ============================================================
# Core Clustering
# ============================================================

def cluster_sentences(sentences: List[str], threshold: float = 0.6) -> List[int]:
    """
    Cluster sentences by meaning using TF-IDF + Agglomerative Clustering.

    Args:
        sentences: List of sentence strings (all containing the same lemma)
        threshold: Distance threshold for clustering (0.6 = v3 tightened)

    Returns:
        List of cluster labels (0, 1, 2, ...) for each sentence
    """
    if len(sentences) <= 2:
        return [0] * len(sentences)

    try:
        vectorizer = TfidfVectorizer(stop_words="english", max_features=1000)
        tfidf_matrix = vectorizer.fit_transform(sentences)

        clustering = AgglomerativeClustering(
            n_clusters=None,
            distance_threshold=threshold,
            metric="cosine",
            linkage="average",
        )
        labels = clustering.fit_predict(tfidf_matrix.toarray())
        return labels.tolist()
    except Exception as e:
        logger.warning(f"Clustering failed, defaulting to single sense: {e}")
        return [0] * len(sentences)


def label_sense(sentences: List[str], n_keywords: int = 3) -> str:
    """Generate a human-readable label from top TF-IDF keywords in a cluster."""
    if not sentences:
        return ""
    try:
        vectorizer = TfidfVectorizer(stop_words="english", max_features=100)
        tfidf = vectorizer.fit_transform(sentences)
        feature_names = vectorizer.get_feature_names_out()
        avg_tfidf = tfidf.mean(axis=0).A1
        top_indices = avg_tfidf.argsort()[-n_keywords:][::-1]
        return ", ".join(feature_names[i] for i in top_indices)
    except Exception:
        return ""


def select_representative(
    sentences: List[Dict],
) -> Dict:
    """
    Pick the best representative sentence from a sense cluster.
    Prefers: high quality score, shorter length.
    """
    if len(sentences) == 1:
        return sentences[0]

    for s in sentences:
        word_count = len(s["sentence"].split())
        length_penalty = max(0, (word_count - 12) * 0.05)
        s["rep_score"] = s.get("score", 1.0) - length_penalty

    return max(sentences, key=lambda s: s["rep_score"])


# ============================================================
# Runtime Sense Selection
# ============================================================

def select_sense_at_runtime(
    clicked_sentence: str,
    sense_representatives: List[Tuple[int, str]],
) -> int:
    """
    Given the sentence the user clicked in, pick the closest sense.

    Args:
        clicked_sentence: The sentence context where the user clicked the word
        sense_representatives: List of (sense_id, representative_sentence)

    Returns:
        sense_id of the best-matching sense
    """
    if len(sense_representatives) <= 1:
        return sense_representatives[0][0] if sense_representatives else 0

    rep_sentences = [rep for _, rep in sense_representatives]
    all_sentences = rep_sentences + [clicked_sentence]

    try:
        vectorizer = TfidfVectorizer(stop_words="english", max_features=500)
        tfidf_matrix = vectorizer.fit_transform(all_sentences)

        clicked_vector = tfidf_matrix[-1]
        rep_vectors = tfidf_matrix[:-1]
        similarities = cosine_similarity(clicked_vector, rep_vectors)[0]

        best_idx = int(similarities.argmax())
        return sense_representatives[best_idx][0]
    except Exception:
        return sense_representatives[0][0]


# ============================================================
# MiniLM Reuse Validation
# ============================================================

def compute_minilm_similarity(sentence_a: str, sentence_b: str) -> float:
    """Compute cosine similarity between two sentences using MiniLM."""
    model = get_minilm()
    embeddings = model.encode([sentence_a, sentence_b])
    sim = cosine_similarity([embeddings[0]], [embeddings[1]])[0][0]
    return float(sim)


def find_reusable_sense(
    new_representative: str,
    existing_senses: List[Tuple[int, str]],
    threshold: float = 0.85,
) -> Optional[int]:
    """
    Check if a new cluster can reuse an existing sense from another movie.

    Args:
        new_representative: Representative sentence of the new cluster
        existing_senses: List of (sense_id, representative_sentence) for this lemma
        threshold: MiniLM cosine similarity threshold for reuse

    Returns:
        sense_id to reuse, or None if no match
    """
    if not existing_senses:
        return None

    model = get_minilm()
    new_emb = model.encode([new_representative])

    existing_reps = [rep for _, rep in existing_senses]
    existing_embs = model.encode(existing_reps)

    similarities = cosine_similarity(new_emb, existing_embs)[0]
    best_idx = int(similarities.argmax())
    best_sim = float(similarities[best_idx])

    if best_sim >= threshold:
        logger.debug(
            f"Reusing sense {existing_senses[best_idx][0]} "
            f"(similarity={best_sim:.3f})"
        )
        return existing_senses[best_idx][0]

    return None


# ============================================================
# Main Pipeline: Cluster + Store Senses
# ============================================================

async def cluster_and_store_senses(
    db: Prisma,
    movie_id: int,
    lemma_id_map: Dict[str, int],
) -> int:
    """
    Run sense clustering for all lemmas in a movie.

    For each lemma with 3+ sentences in SentenceBank:
    1. Fetch all sentences linked to this lemma
    2. Cluster by TF-IDF
    3. Check for reusable senses via MiniLM
    4. Create/reuse WordSense entries
    5. Update SentenceLemmaLink with sense assignments
    6. Select representative sentence per sense

    Args:
        db: Prisma client
        movie_id: Movie ID being processed
        lemma_id_map: Dict of lemma_str -> lemma_id

    Returns:
        Number of senses created/updated
    """
    senses_processed = 0

    for lemma_str, lemma_id in lemma_id_map.items():
        # Fetch all sentence links for this lemma (across all movies)
        links = await db.sentencelemmalink.find_many(
            where={"lemmaId": lemma_id},
            include={"sentence": True},
        )

        if not links:
            continue

        # Get the lemma record for POS
        lemma_record = await db.lemma.find_unique(where={"id": lemma_id})
        if not lemma_record:
            continue

        sentences_data = [
            {
                "link_id": link.id,
                "sentence_id": link.sentenceId,
                "sentence": link.sentence.sentence,
                "score": link.score,
            }
            for link in links
            if link.sentence
        ]

        if not sentences_data:
            continue

        sentence_texts = [s["sentence"] for s in sentences_data]

        # Cluster
        if len(sentence_texts) >= 3:
            labels = cluster_sentences(sentence_texts)
        else:
            labels = [0] * len(sentence_texts)

        # Group sentences by cluster
        clusters: Dict[int, List[Dict]] = {}
        for sent_data, label in zip(sentences_data, labels):
            if label not in clusters:
                clusters[label] = []
            clusters[label].append(sent_data)

        # Get existing senses for this lemma (for reuse check)
        existing_senses = await db.wordsense.find_many(
            where={"lemmaId": lemma_id}
        )
        existing_sense_reps = [
            (s.id, s.representativeSentence)
            for s in existing_senses
            if s.representativeSentence
        ]

        # Track the next available senseIndex
        max_existing_index = max(
            (s.senseIndex for s in existing_senses), default=-1
        )
        next_sense_index = max_existing_index + 1

        for cluster_label, cluster_sents in clusters.items():
            # Select representative
            rep = select_representative(cluster_sents)
            rep_sentence = rep["sentence"]

            # Generate label
            cluster_texts = [s["sentence"] for s in cluster_sents]
            sense_label = label_sense(cluster_texts)

            # Try to reuse existing sense via MiniLM
            reused_sense_id = None
            if existing_sense_reps:
                reused_sense_id = find_reusable_sense(
                    rep_sentence, existing_sense_reps
                )

            if reused_sense_id is not None:
                # Reuse: update sentence count
                sense = await db.wordsense.find_unique(
                    where={"id": reused_sense_id}
                )
                if sense:
                    await db.wordsense.update(
                        where={"id": reused_sense_id},
                        data={
                            "sentenceCount": sense.sentenceCount
                            + len(cluster_sents),
                        },
                    )
                    sense_id = reused_sense_id
            else:
                # Create new sense
                # Compute TF-IDF centroid for future reuse comparison
                try:
                    vec = TfidfVectorizer(
                        stop_words="english", max_features=200
                    )
                    tfidf = vec.fit_transform(cluster_texts)
                    centroid = tfidf.mean(axis=0).A1.tolist()
                except Exception:
                    centroid = []

                # Check if this (lemmaId, senseIndex) already exists
                existing_sense = await db.wordsense.find_first(
                    where={
                        "lemmaId": lemma_id,
                        "senseIndex": next_sense_index,
                    }
                )

                if existing_sense:
                    await db.wordsense.update(
                        where={"id": existing_sense.id},
                        data={
                            "label": sense_label[:200] if sense_label else None,
                            "representativeSentence": rep_sentence,
                            "clusterCentroid": Json(centroid) if centroid else None,
                            "sentenceCount": len(cluster_sents),
                            "pos": lemma_record.pos,
                        },
                    )
                    sense_id = existing_sense.id
                else:
                    new_sense = await db.wordsense.create(
                        data={
                            "lemmaId": lemma_id,
                            "senseIndex": next_sense_index,
                            "pos": lemma_record.pos,
                            "label": sense_label[:200] if sense_label else None,
                            "representativeSentence": rep_sentence,
                            "keywords": Json(
                                sense_label.split(", ") if sense_label else []
                            ),
                            "clusterCentroid": Json(centroid) if centroid else None,
                            "sentenceCount": len(cluster_sents),
                        }
                    )
                    sense_id = new_sense.id

                # Add to existing reps for next cluster's reuse check
                existing_sense_reps.append((sense_id, rep_sentence))
                next_sense_index += 1

            # Update SentenceLemmaLink with sense assignment
            for sent_data in cluster_sents:
                is_rep = sent_data["sentence"] == rep_sentence
                await db.sentencelemmalink.update(
                    where={"id": sent_data["link_id"]},
                    data={
                        "senseId": sense_id,
                        "isRepresentative": is_rep,
                    },
                )

            senses_processed += 1

    logger.info(
        f"Sense clustering: {senses_processed} senses processed for movie {movie_id}"
    )
    return senses_processed
