from fastapi import APIRouter, Depends, HTTPException
from prisma import Prisma
from src.database import get_db
from src.middleware.auth import get_current_active_user
from src.services.cefr_classifier import HybridCEFRClassifier
from src.services.difficulty_scorer import compute_difficulty
from pathlib import Path
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["admin"])

_classifier = None


def get_classifier():
    global _classifier
    if _classifier is None:
        backend_dir = Path(__file__).parent.parent.parent
        data_dir = backend_dir / "data" / "cefr"
        _classifier = HybridCEFRClassifier(data_dir=data_dir, use_embedding_classifier=False)
    return _classifier


@router.post("/reprocess-script/{script_id}")
async def reprocess_script(
    script_id: int,
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db)
):
    script = await db.moviescript.find_unique(
        where={"id": script_id},
        include={"movie": True}
    )

    if not script:
        raise HTTPException(status_code=404, detail="Script not found")

    if not script.cleanedScriptText:
        raise HTTPException(status_code=400, detail="No cleaned text available")

    logger.info(f"Reprocessing script {script_id}...")

    await db.wordclassification.delete_many(where={"scriptId": script_id})

    classifier = get_classifier()
    classifications = classifier.classify_text(script.cleanedScriptText)

    statistics = classifier.get_statistics(classifications)

    unique = {}
    for cls in classifications:
        key = (cls.lemma, cls.cefr_level.value)
        if key not in unique:
            unique[key] = cls

    cls_list = list(unique.values())

    batch_size = 200
    num_batches = (len(cls_list) + batch_size - 1) // batch_size

    for batch_idx in range(num_batches):
        start = batch_idx * batch_size
        end = min(start + batch_size, len(cls_list))
        batch = cls_list[start:end]

        await db.wordclassification.create_many(
            data=[
                {
                    'scriptId': script.id,
                    'word': cls.word,
                    'lemma': cls.lemma,
                    'pos': cls.pos or None,
                    'cefrLevel': cls.cefr_level.value,
                    'confidence': cls.confidence,
                    'source': cls.source.value,
                    'frequencyRank': cls.frequency_rank,
                }
                for cls in batch
            ],
            skip_duplicates=True
        )

    level, score, dist = compute_difficulty(statistics['level_distribution'])

    await db.movie.update(
        where={'id': script.movieId},
        data={
            'difficultyLevel': level,
            'difficultyScore': score,
            'cefrDistribution': dist
        }
    )

    await db.moviescript.update(
        where={'id': script_id},
        data={'isPreprocessed': True}
    )

    logger.info(f"✓ Reprocessed script {script_id}, difficulty: {level.value}, score: {score}")

    return {
        "status": "success",
        "script_id": script_id,
        "movie_id": script.movieId,
        "difficulty_level": level.value,
        "difficulty_score": score,
        "distribution": dist
    }
