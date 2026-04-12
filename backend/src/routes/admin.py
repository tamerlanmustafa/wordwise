from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from prisma import Prisma
from datetime import datetime, timedelta, timezone
from typing import Optional
from src.database import get_db
from src.middleware.auth import get_current_active_user, get_admin_user
from src.services.cefr_classifier import HybridCEFRClassifier
from src.services.difficulty_scorer import compute_difficulty
from src.utils.subscription import entitlements_payload
from pathlib import Path
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/stats")
async def get_admin_stats(
    admin_user = Depends(get_admin_user),
    db: Prisma = Depends(get_db),
):
    """Aggregate counts for the admin dashboard."""
    # "Processed" means we have a script row tied to the movie. Movies that
    # exist but never got their script fetched don't count yet.
    movies_total = await db.movie.count()
    movies_processed = await db.moviescript.count(where={"isPreprocessed": True})
    users_total = await db.user.count()

    # Distribution across CEFR-ish difficulty buckets. Any movie with a
    # non-null difficulty_level has been fully scored by our classifier,
    # so this doubles as "how many are actually usable".
    level_rows = await db.query_raw(
        "SELECT difficulty_level::text AS level, COUNT(*)::int AS n "
        "FROM movies WHERE difficulty_level IS NOT NULL "
        "GROUP BY difficulty_level"
    )
    movies_by_level = {r["level"]: r["n"] for r in level_rows}

    # Worker queue progress (best-effort — table may not exist if the worker
    # subsystem hasn't been bootstrapped yet on this environment).
    queue_done = None
    queue_pending = None
    queue_running = None
    queue_dead = None
    try:
        rows = await db.query_raw(
            "SELECT status, COUNT(*)::int AS n FROM movie_jobs GROUP BY status"
        )
        counts = {r["status"]: r["n"] for r in rows}
        queue_done = counts.get("done", 0)
        queue_pending = counts.get("pending", 0)
        queue_running = counts.get("running", 0)
        queue_dead = counts.get("dead", 0)
    except Exception as e:
        logger.debug(f"movie_jobs not available: {e}")

    return {
        "movies_total": movies_total,
        "movies_processed": movies_processed,
        "users_total": users_total,
        "movies_by_level": movies_by_level,
        "queue": {
            "done": queue_done,
            "pending": queue_pending,
            "running": queue_running,
            "dead": queue_dead,
        },
    }


@router.get("/movies/processed")
async def list_processed_movies(
    level: str | None = None,
    limit: int = 500,
    admin_user = Depends(get_admin_user),
    db: Prisma = Depends(get_db),
):
    """
    Admin browser: every fully-processed movie (has a preprocessed script)
    with TMDB metadata, ordered by popularity desc. Optionally filtered by
    difficulty level (ELEMENTARY, INTERMEDIATE, ADVANCED, etc.).
    """
    where_sql = "WHERE EXISTS (SELECT 1 FROM movie_scripts s WHERE s.movie_id = m.id AND s.is_preprocessed = true)"
    args: list = []
    if level:
        where_sql += " AND m.difficulty_level::text = $1"
        args.append(level.upper())
    args.append(min(max(limit, 1), 1000))
    limit_pos = len(args)

    rows = await db.query_raw(
        f"""
        SELECT m.id                AS movie_id,
               m.tmdb_id           AS tmdb_id,
               m.title             AS title,
               m.year              AS year,
               m.difficulty_level::text AS difficulty_level,
               m.difficulty_score  AS difficulty_score,
               m.tmdb_popularity   AS popularity,
               m.tmdb_vote_average AS vote_average,
               m.tmdb_vote_count   AS vote_count
          FROM movies m
          {where_sql}
         ORDER BY m.tmdb_vote_count DESC NULLS LAST, m.id DESC
         LIMIT ${limit_pos}
        """,
        *args,
    )
    return {
        "level": level,
        "total": len(rows),
        "movies": [
            {
                "movie_id": r["movie_id"],
                "tmdb_id": r["tmdb_id"],
                "title": r["title"],
                "year": r["year"],
                "difficulty_level": r["difficulty_level"],
                "difficulty_score": r["difficulty_score"],
                "popularity": r["popularity"],
                "vote_average": r["vote_average"],
                "vote_count": r["vote_count"],
            }
            for r in rows
        ],
    }


@router.get("/queue/dead")
async def list_dead_jobs(
    admin_user = Depends(get_admin_user),
    db: Prisma = Depends(get_db),
):
    """Movies that exhausted all script sources or crashed too many times.
    Surfaced on the admin dashboard so we can eyeball what our ingestion
    coverage is missing.
    """
    try:
        rows = await db.query_raw(
            """
            SELECT id, tmdb_id, title, year, attempts, last_error,
                   EXTRACT(EPOCH FROM finished_at)::bigint AS finished_at
              FROM movie_jobs
             WHERE status = 'dead'
             ORDER BY finished_at DESC NULLS LAST, id DESC
             LIMIT 500
            """
        )
    except Exception as e:
        logger.debug(f"movie_jobs not available: {e}")
        return {"jobs": []}

    return {
        "jobs": [
            {
                "id": r["id"],
                "tmdb_id": r["tmdb_id"],
                "title": r["title"],
                "year": r["year"],
                "attempts": r["attempts"],
                "last_error": r["last_error"],
                "finished_at": r["finished_at"],
            }
            for r in rows
        ]
    }

class GrantPremiumBody(BaseModel):
    # Accept either user id or email so admin UI can skip a lookup step.
    user_id: Optional[int] = None
    email: Optional[str] = None
    tier: str = "comped"  # comped | premium | trial
    expires_in_days: Optional[int] = None  # None = never expires (comped default)


def _serialize_sub_user(u) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "username": u.username,
        "is_admin": bool(u.isAdmin),
        "entitlements": entitlements_payload(u),
    }


@router.get("/users/search")
async def search_users(
    q: str,
    admin_user = Depends(get_admin_user),
    db: Prisma = Depends(get_db),
):
    """Lightweight user search for the grant/revoke UI. Matches email or
    username with a case-insensitive prefix. Caps at 20 results — this is
    an admin typeahead, not an export tool."""
    q = q.strip()
    if not q:
        return {"users": []}
    rows = await db.user.find_many(
        where={
            "OR": [
                {"email": {"contains": q, "mode": "insensitive"}},
                {"username": {"contains": q, "mode": "insensitive"}},
            ]
        },
        take=20,
        order={"id": "desc"},
    )
    return {"users": [_serialize_sub_user(u) for u in rows]}


@router.post("/users/grant-premium")
async def grant_premium(
    body: GrantPremiumBody,
    admin_user = Depends(get_admin_user),
    db: Prisma = Depends(get_db),
):
    """Grant Plus to a user. `comped` is the default — no expiry, no billing.
    `trial` requires `expires_in_days`. Audit log = application log for now
    (see MONETIZATION_PLAN.md §6: no audit table at launch)."""
    if body.tier not in ("comped", "premium", "trial"):
        raise HTTPException(400, detail=f"invalid tier: {body.tier}")

    target = None
    if body.user_id is not None:
        target = await db.user.find_unique(where={"id": body.user_id})
    elif body.email:
        target = await db.user.find_unique(where={"email": body.email})
    if target is None:
        raise HTTPException(404, detail="user not found")

    expires_at = None
    if body.tier == "trial":
        days = body.expires_in_days or 7
        expires_at = datetime.now(timezone.utc) + timedelta(days=days)
    elif body.expires_in_days:
        expires_at = datetime.now(timezone.utc) + timedelta(days=body.expires_in_days)

    updated = await db.user.update(
        where={"id": target.id},
        data={
            "subscriptionTier": body.tier,
            "subscriptionExpiresAt": expires_at,
            "adsEligible": False,
        },
    )
    logger.info(
        "[admin] grant_premium admin=%s target=%s tier=%s expires=%s",
        admin_user.id,
        target.id,
        body.tier,
        expires_at,
    )
    return _serialize_sub_user(updated)


@router.post("/users/{user_id}/revoke-premium")
async def revoke_premium(
    user_id: int,
    admin_user = Depends(get_admin_user),
    db: Prisma = Depends(get_db),
):
    """Revoke Plus. Drops the user back to free + ads_eligible=true.
    Does NOT touch `isAdmin` — admins stay admins."""
    target = await db.user.find_unique(where={"id": user_id})
    if target is None:
        raise HTTPException(404, detail="user not found")
    updated = await db.user.update(
        where={"id": user_id},
        data={
            "subscriptionTier": "free",
            "subscriptionExpiresAt": None,
            "adsEligible": True,
        },
    )
    logger.info("[admin] revoke_premium admin=%s target=%s", admin_user.id, user_id)
    return _serialize_sub_user(updated)


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


@router.post("/reprocess-all-scripts")
async def reprocess_all_scripts(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db)
):
    """Reprocess all scripts with the latest CEFR wordlists"""
    scripts = await db.moviescript.find_many(
        where={"cleanedScriptText": {"not": None}},
        include={"movie": True}
    )

    if not scripts:
        return {"status": "success", "processed": 0, "message": "No scripts found"}

    classifier = get_classifier()
    processed = 0
    errors = []

    for script in scripts:
        try:
            logger.info(f"Reprocessing script {script.id} ({script.movie.title if script.movie else 'Unknown'})...")

            # Delete existing classifications
            await db.wordclassification.delete_many(where={"scriptId": script.id})

            # Reclassify
            classifications = classifier.classify_text(script.cleanedScriptText)
            statistics = classifier.get_statistics(classifications)

            # Deduplicate by lemma+level
            unique = {}
            for cls in classifications:
                key = (cls.lemma, cls.cefr_level.value)
                if key not in unique:
                    unique[key] = cls

            cls_list = list(unique.values())

            # Batch insert
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

            # Update movie difficulty
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
                where={'id': script.id},
                data={'isPreprocessed': True}
            )

            processed += 1
            logger.info(f"✓ Reprocessed script {script.id}, difficulty: {level.value}")

        except Exception as e:
            logger.error(f"Error reprocessing script {script.id}: {e}")
            errors.append({"script_id": script.id, "error": str(e)})

    return {
        "status": "success",
        "processed": processed,
        "total": len(scripts),
        "errors": errors
    }
