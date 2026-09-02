"""
Premium-only feature endpoints (WordWise Plus Phase 4).

Cross-movie sentences, audio pronunciation, and export.
All endpoints require an active premium subscription.
"""

from __future__ import annotations

import csv
import io
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from prisma import Prisma

from ..database import get_db
from ..middleware.auth import get_current_active_user
from ..services.tts_service import MAX_WORD_LEN, TTSUnavailable, synthesize
from ..utils.offload import CPUOverloaded
from ..utils.subscription import is_premium

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/premium", tags=["premium"])


def _require_premium(user):
    if not is_premium(user):
        raise HTTPException(
            status_code=402,
            detail={
                "paywall": "premium_required",
                "message": "This feature requires WordWise Plus.",
            },
        )


# ── Cross-movie example sentences ────────────────────────────────────────────

class CrossMovieSentence(BaseModel):
    movie_id: int
    movie_title: str
    sentence: str
    cefr_level: Optional[str]


class CrossMovieResponse(BaseModel):
    word: str
    sentences: list[CrossMovieSentence]
    total: int


@router.get("/sentences/{word}", response_model=CrossMovieResponse)
async def cross_movie_sentences(
    word: str,
    limit: int = 10,
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """
    Return example sentences for a word across all movies in the catalog.
    Premium-gated because DeepL translation has real marginal cost.
    """
    _require_premium(current_user)

    rows = await db.query_raw(
        '''
        SELECT wse.sentence, wse.cefr_level, wse.movie_id,
               m.title AS movie_title
        FROM word_sentence_examples wse
        JOIN movies m ON wse.movie_id = m.id
        WHERE LOWER(wse.word) = LOWER($1)
        GROUP BY wse.sentence, wse.cefr_level, wse.movie_id, m.title
        ORDER BY m.tmdb_popularity DESC NULLS LAST
        LIMIT $2
        ''',
        word.lower().strip(),
        min(limit, 25),
    )

    sentences = [
        CrossMovieSentence(
            movie_id=r["movie_id"],
            movie_title=r["movie_title"],
            sentence=r["sentence"],
            cefr_level=r["cefr_level"],
        )
        for r in rows
    ]

    return CrossMovieResponse(word=word, sentences=sentences, total=len(sentences))


# ── Audio pronunciation (TTS) ────────────────────────────────────────────────

@router.get("/pronounce/{word}")
async def pronounce_word(
    word: str,
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """
    Return an audio pronunciation for a word using Google TTS.
    Premium-gated due to TTS cost.

    The synthesis itself is `services/tts_service`'s: it is a synchronous
    network round trip, so it runs on the CPU worker pool rather than on the
    event loop this single-process API shares with every other request, and
    its result is cached per word.

    A fresh `BytesIO` per response, wrapping cached bytes — a stream is
    consumed by the response that sends it, so handing the same buffer to a
    second request would send an empty body.
    """
    _require_premium(current_user)

    clean = word.strip()[:MAX_WORD_LEN]
    if not clean:
        raise HTTPException(400, detail="Empty word")

    try:
        audio = await synthesize(clean)
    except TTSUnavailable:
        # No speech backend in this image. A deployment fact, not a transient
        # failure — this is what every request hit before `gtts` was declared
        # in requirements.txt (prod, 2026-09-01).
        logger.error("TTS unavailable: gtts is not installed in this image")
        raise HTTPException(
            501,
            detail="TTS not available — install gtts: pip install gtts",
        )
    except CPUOverloaded:
        # Shed rather than queue behind a round trip the caller has stopped
        # waiting for. The client treats any failure as silent and the reader
        # can tap again.
        raise HTTPException(
            503,
            detail="Pronunciation busy, try again",
            headers={"Retry-After": "1"},
        )
    except Exception as e:
        logger.error(f"TTS failed for '{clean}': {e}")
        raise HTTPException(500, detail="Pronunciation unavailable")

    return StreamingResponse(
        io.BytesIO(audio),
        media_type="audio/mpeg",
        headers={"Content-Disposition": f'inline; filename="{clean}.mp3"'},
    )


# ── Export to Anki / CSV ─────────────────────────────────────────────────────

class ExportStatsResponse(BaseModel):
    total_words: int
    format: str


@router.get("/export/csv")
async def export_csv(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """
    Export all saved words as a CSV file (Anki-compatible).
    Columns: word, definition, example_sentence, movie, srs_box, cefr_level.
    """
    _require_premium(current_user)

    words = await db.userword.find_many(
        where={"userId": current_user.id},
        include={"movie": True},
        order=[{"createdAt": "asc"}],
    )

    if not words:
        raise HTTPException(404, detail="No saved words to export")

    # Bulk-fetch definitions from the words table
    word_texts = list({w.word for w in words})
    defs = await db.word.find_many(
        where={"word": {"in": word_texts}},
    )
    def_map = {}
    for d in defs:
        if d.word not in def_map and d.definition:
            def_map[d.word] = (d.definition, d.example_sentence)

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["word", "definition", "example_sentence", "movie", "srs_box", "created_at"])

    for w in words:
        defn, example = def_map.get(w.word, (None, None))
        movie_title = w.movie.title if w.movie else ""
        writer.writerow([
            w.word,
            defn or "",
            example or "",
            movie_title,
            w.srsBox,
            w.createdAt.isoformat() if w.createdAt else "",
        ])

    buf.seek(0)
    return StreamingResponse(
        io.BytesIO(buf.getvalue().encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="wordwise_export.csv"'},
    )


@router.get("/export/anki")
async def export_anki(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """
    Export saved words as a tab-separated file for Anki import.
    Front: word, Back: definition + example sentence.
    """
    _require_premium(current_user)

    words = await db.userword.find_many(
        where={"userId": current_user.id},
        include={"movie": True},
        order=[{"createdAt": "asc"}],
    )

    if not words:
        raise HTTPException(404, detail="No saved words to export")

    word_texts = list({w.word for w in words})
    defs = await db.word.find_many(
        where={"word": {"in": word_texts}},
    )
    def_map = {}
    for d in defs:
        if d.word not in def_map and d.definition:
            def_map[d.word] = (d.definition, d.example_sentence)

    lines = []
    for w in words:
        defn, example = def_map.get(w.word, (None, None))
        front = w.word
        back_parts = []
        if defn:
            back_parts.append(defn)
        if example:
            back_parts.append(f"<i>{example}</i>")
        if w.movie:
            back_parts.append(f"<small>({w.movie.title})</small>")
        back = "<br>".join(back_parts) if back_parts else w.word
        lines.append(f"{front}\t{back}")

    content = "\n".join(lines)
    return StreamingResponse(
        io.BytesIO(content.encode("utf-8")),
        media_type="text/tab-separated-values",
        headers={"Content-Disposition": 'attachment; filename="wordwise_anki.txt"'},
    )
