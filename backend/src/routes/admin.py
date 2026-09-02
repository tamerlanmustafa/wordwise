from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from prisma import Prisma
from datetime import datetime, timedelta, timezone
from typing import Optional
from src.database import get_db
from src.middleware.auth import get_admin_user
from src.services.cefr_classifier import get_shared_classifier
from src.services.cefr_registry import apply_registry_levels
from src.services.client_ip_health import build_report as build_client_ip_report
from src.services.difficulty_scorer import compute_difficulty
from src.services.event_loop_lag import compute_event_loop_report
from src.services.latency_stats import compute_latency_report
from src.services.movie_cefr import (
    CEFR_LEVELS,
    CEFR_SCORE_RANGES,
    cefr_from_score,
    normalize_level,
)
from src.services.vocab_coverage import compute_vocab_coverage
from src.utils.offload import run_nlp
from src.utils.rate_limit import client_ip_observation, rate_limit
from src.utils.subscription import entitlements_payload
from pathlib import Path
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["admin"])

# Admin health reads are cheap but run several COUNT/EXISTS queries; throttle so
# a stuck dashboard poll can't hammer them.
_vocab_health_throttle = rate_limit(30, 60.0, scope="admin-vocab-health")
_translation_health_throttle = rate_limit(30, 60.0, scope="admin-translation-health")
# The latency read touches no database, but it does sort every route's sample
# window under a lock — its own budget so it can't starve the vocab read.
_latency_health_throttle = rate_limit(30, 60.0, scope="admin-latency-health")
# Same shape as the latency read: no database, one sort of the probe window.
_event_loop_health_throttle = rate_limit(30, 60.0, scope="admin-event-loop-health")
# Reads headers off the current request and nothing else, but it is the report
# you hit repeatedly while wiring up a CDN rule, so it gets a wider budget.
_client_ip_health_throttle = rate_limit(60, 60.0, scope="admin-client-ip-health")


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

    # Distribution across CEFR buckets. Any movie with a non-null
    # difficulty_score has been fully scored by our classifier, so this doubles
    # as "how many are actually usable". Since #103 the bucket is banded off
    # the score in Python rather than read from a stored enum, so the admin
    # dashboard and the learner-facing shelves can no longer drift apart.
    score_rows = await db.query_raw(
        "SELECT difficulty_score AS score, COUNT(*)::int AS n "
        "FROM movies WHERE difficulty_score IS NOT NULL "
        "GROUP BY difficulty_score"
    )
    movies_by_level = {lvl: 0 for lvl in CEFR_LEVELS}
    for r in score_rows:
        level = cefr_from_score(r["score"])
        if level is not None:
            movies_by_level[level] += r["n"]

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


@router.get("/health/vocab-coverage")
async def vocab_coverage_health(
    admin_user=Depends(get_admin_user),
    _: None = Depends(_vocab_health_throttle),
    db: Prisma = Depends(get_db),
):
    """Health/coverage of the vocabulary data pipeline (words → sentences →
    senses → translations). Each metric carries a value, threshold and
    ok/warn/fail status; trend/regression metrics are diffed against the most
    recent daily snapshot written by the sentence worker. See
    src/services/vocab_coverage.py for the metric definitions and thresholds."""
    return await compute_vocab_coverage(db)


@router.get("/health/translation-cache")
async def translation_cache_health(
    admin_user=Depends(get_admin_user),
    _: None = Depends(_translation_health_throttle),
    db: Prisma = Depends(get_db),
):
    """Translation-cache coverage and provider mix (issue #124).

    Coverage is what decides whether a user's first Explore card is instant or
    waits on a live provider round trip, and it moves only when the warm worker
    runs — so a number that stops climbing means the worker is wedged, not that
    the job is done. The provider metrics carry the other half: warming falls
    back to Google once DeepL's monthly characters are spent, and Google is the
    weaker translator on every language DeepL supports, so a high Google share
    is quality debt to be re-warmed rather than an error.

    Reads DeepL's live /usage; an unreachable provider degrades the report by
    one metric instead of failing it."""
    from ..services.translation_coverage import compute_translation_coverage
    from ..utils.deepl_client import DeepLClient
    from ..workers.translation_warm_worker import LANGS

    return await compute_translation_coverage(
        db, LANGS, deepl_client=DeepLClient()
    )


@router.get("/health/latency")
async def latency_health(
    admin_user=Depends(get_admin_user),
    _: None = Depends(_latency_health_throttle),
):
    """Per-endpoint request latency (issue #130): p50/p95/p99 per route template
    plus app-wide percentiles and the 5xx rate, in the same metric shape as
    /admin/health/vocab-coverage.

    Read from the in-process registry the access middleware writes to, so the
    window covers this API instance since its last restart — a deploy resets
    it. The per-request `duration_ms` / `route` fields in the structured logs
    are the durable record. No database access, so this stays honest even when
    the thing that is slow *is* Postgres."""
    return compute_latency_report()


@router.get("/health/event-loop")
async def event_loop_health(
    admin_user=Depends(get_admin_user),
    _: None = Depends(_event_loop_health_throttle),
):
    """Event-loop lag (issue #146): how late a fixed-interval probe comes back,
    which is exactly how long the API spent blocked and unable to serve anyone.

    The API is one uvicorn process by design, so a synchronous call inside an
    `async def` stalls every concurrent request. That bug class is invisible to
    ruff, to a single-user test and to reading one function in isolation — this
    is the runtime layer that catches it.

    Known limitation: lag says *that* the loop stalled and *when*, never *which
    handler did it* — every coroutine is stalled equally. Attribution means
    taking a stall's timestamp to /admin/health/latency and the access logs and
    looking for the #117 signature: one endpoint slow **and** every unrelated
    endpoint slow in the same window."""
    return compute_event_loop_report()


@router.get("/health/client-ip")
async def client_ip_health(
    request: Request,
    admin_user=Depends(get_admin_user),
    _: None = Depends(_client_ip_health_throttle),
):
    """Whether IP-keyed rate limiting binds per caller (issue #139).

    Anonymous throttles — login, registration, forgot/reset password, and the
    app-wide ceiling — have nothing but the caller's address to key on. When
    that address is really a proxy shared by everyone, the limits still return
    429s and still look enforced while an attacker's brute-force budget is
    multiplied across the addresses the platform rotates through.

    Unlike the other health reports this one describes **the request that
    called it**, because the question is about network topology and one real
    request settles it. Call it from outside the network: from inside Railway
    the answer describes Railway. Reports which CDN client-IP headers survived
    to the app, whether the origin secret proved the CDN set them, and the next
    step to take — never the secret's value."""
    return build_client_ip_report(client_ip_observation(request))


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
    CEFR level (A1..C2).
    """
    where_sql = "WHERE EXISTS (SELECT 1 FROM movie_scripts s WHERE s.movie_id = m.id AND s.is_preprocessed = true)"
    args: list = []
    if level:
        # #103: the level is a band of `difficulty_score`, so this filters on a
        # range. Legacy enum names still resolve for older admin clients.
        key = normalize_level(level)
        if key is None:
            raise HTTPException(status_code=400, detail=f"Invalid level: {level}")
        lo, hi = CEFR_SCORE_RANGES[key]
        where_sql += " AND m.difficulty_score >= $1 AND m.difficulty_score <= $2"
        args.extend([lo, hi])
    args.append(min(max(limit, 1), 1000))
    limit_pos = len(args)

    rows = await db.query_raw(
        f"""
        SELECT m.id                AS movie_id,
               m.tmdb_id           AS tmdb_id,
               m.title             AS title,
               m.year              AS year,
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
        "level": normalize_level(level) if level else None,
        "total": len(rows),
        "movies": [
            {
                "movie_id": r["movie_id"],
                "tmdb_id": r["tmdb_id"],
                "title": r["title"],
                "year": r["year"],
                "difficulty_level": cefr_from_score(r["difficulty_score"]),
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


def get_classifier():
    # Same process-wide instance the classification routes and the purity
    # guard's wordlist lookup use (#96) - this used to be a second copy.
    return get_shared_classifier()


@router.post("/reprocess-script/{script_id}")
async def reprocess_script(
    script_id: int,
    admin_user=Depends(get_admin_user),
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
    # No `nlp_slot` here, unlike the user-facing paths: an admin reprocess
    # should wait its turn behind live traffic, not be shed. Offloading is
    # still required — being an admin does not make 2.9s of spaCy any less
    # of a freeze for everyone else's requests.
    script_text = script.cleanedScriptText
    classifications = await run_nlp(lambda: classifier.classify_text(script_text))

    # Keep words the registry can place out of the UNKNOWN bucket (#119).
    await apply_registry_levels(db, classifications)

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

    # #103: only the score is stored. The level is banded off it on read, so
    # there is nothing here that can fall out of step with what a learner sees.
    score, dist = compute_difficulty(statistics['level_distribution'])
    level = cefr_from_score(score)

    await db.movie.update(
        where={'id': script.movieId},
        data={
            'difficultyScore': score,
            'cefrDistribution': dist
        }
    )

    await db.moviescript.update(
        where={'id': script_id},
        data={'isPreprocessed': True}
    )

    logger.info(f"✓ Reprocessed script {script_id}, difficulty: {level}, score: {score}")

    return {
        "status": "success",
        "script_id": script_id,
        "movie_id": script.movieId,
        "difficulty_level": level,
        "difficulty_score": score,
        "distribution": dist
    }


@router.post("/reprocess-all-scripts")
async def reprocess_all_scripts(
    admin_user=Depends(get_admin_user),
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

            # Reclassify. One hop per script is right here even though the
            # module rule says "batch, then offload once" — the unit of work
            # already *is* a whole script, so this is N large jobs, not N
            # small ones. Between them the loop is free to serve requests,
            # which is the entire point: this endpoint walks every script in
            # the database and inline it would freeze the API for minutes.
            script_text = script.cleanedScriptText
            classifications = await run_nlp(
                lambda: classifier.classify_text(script_text)
            )

            # Keep words the registry can place out of the UNKNOWN bucket (#119).
            await apply_registry_levels(db, classifications)

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

            # Update movie difficulty. Score only — see #103.
            score, dist = compute_difficulty(statistics['level_distribution'])

            await db.movie.update(
                where={'id': script.movieId},
                data={
                    'difficultyScore': score,
                    'cefrDistribution': dist
                }
            )

            await db.moviescript.update(
                where={'id': script.id},
                data={'isPreprocessed': True}
            )

            processed += 1
            logger.info(
                f"✓ Reprocessed script {script.id}, "
                f"difficulty: {cefr_from_score(score)}, score: {score}"
            )

        except Exception as e:
            logger.error(f"Error reprocessing script {script.id}: {e}")
            errors.append({"script_id": script.id, "error": str(e)})

    return {
        "status": "success",
        "processed": processed,
        "total": len(scripts),
        "errors": errors
    }


class HideWordRequest(BaseModel):
    word: str
    reason: Optional[str] = None


@router.get("/hidden-words")
async def list_hidden_words(
    admin_user=Depends(get_admin_user),
    db: Prisma = Depends(get_db),
):
    rows = await db.hiddenword.find_many(
        include={"hiddenBy": True},
        order={"createdAt": "desc"},
    )
    return {
        "hidden_words": [
            {
                "id": r.id,
                "word": r.word,
                "reason": r.reason,
                "hidden_by": r.hiddenBy.email if r.hiddenBy else None,
                "created_at": r.createdAt.isoformat() if r.createdAt else None,
            }
            for r in rows
        ]
    }


@router.post("/hidden-words")
async def hide_word(
    body: HideWordRequest,
    admin_user=Depends(get_admin_user),
    db: Prisma = Depends(get_db),
):
    # Stored lowercased; vocabulary filters compare against the lowercase form
    # so uppercase variants in source material still get hidden.
    normalized = body.word.strip().lower()
    if not normalized:
        raise HTTPException(status_code=400, detail="word is required")

    existing = await db.hiddenword.find_unique(where={"word": normalized})
    if existing:
        return {"success": True, "id": existing.id, "already_hidden": True}

    created = await db.hiddenword.create(
        data={
            "word": normalized,
            "reason": body.reason,
            "hiddenById": admin_user.id,
        }
    )
    return {"success": True, "id": created.id, "word": created.word}


@router.delete("/hidden-words/{word}")
async def unhide_word(
    word: str,
    admin_user=Depends(get_admin_user),
    db: Prisma = Depends(get_db),
):
    normalized = word.strip().lower()
    existing = await db.hiddenword.find_unique(where={"word": normalized})
    if not existing:
        raise HTTPException(status_code=404, detail="Word is not hidden")
    await db.hiddenword.delete(where={"id": existing.id})
    return {"success": True, "word": normalized}
