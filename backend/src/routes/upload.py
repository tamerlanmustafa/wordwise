"""
File Upload API Endpoint

Handles user-uploaded files (SRT, VTT, TXT, EPUB, PDF) for vocabulary analysis.
Creates movie entries with MANUAL_UPLOAD source and processes through CEFR pipeline.
"""

import json
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from prisma import Prisma
from prisma.enums import scriptsource

from ..database import get_db
from ..middleware.auth import get_current_active_user
from ..schemas.upload import FileUploadResponse
from ..utils.subtitle_parser import SubtitleParser
from ..utils.pdf_extractor import PDFExtractor
from ..utils.epub_extractor import EPUBExtractor, EPUBExtractionError
from .cefr import get_classifier

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/upload", tags=["upload"])

# Supported file extensions and their handlers
SUPPORTED_EXTENSIONS = {'.srt', '.vtt', '.txt', '.epub', '.pdf'}
MAX_FILE_SIZE_MB = 10
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024


@router.post("/file", response_model=FileUploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db)
):
    """
    Upload a text file for vocabulary analysis.

    Supported formats: SRT, VTT, TXT, EPUB, PDF
    Max file size: 10MB

    The file is processed through the CEFR classification pipeline
    and stored as a movie entry with MANUAL_UPLOAD source.

    Args:
        file: The uploaded file
        title: Optional custom title (defaults to filename)

    Returns:
        FileUploadResponse with movie_id and word statistics
    """
    logger.info(f"[Upload] Received file upload: {file.filename} from user {current_user.id}")

    # Validate file extension
    filename = file.filename or "unknown"
    extension = _get_file_extension(filename)

    if extension not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{extension}'. Supported: {', '.join(SUPPORTED_EXTENSIONS)}"
        )

    # Read file content
    try:
        content = await file.read()

        # Check file size
        if len(content) > MAX_FILE_SIZE_BYTES:
            raise HTTPException(
                status_code=400,
                detail=f"File too large. Maximum size is {MAX_FILE_SIZE_MB}MB"
            )

        if len(content) == 0:
            raise HTTPException(
                status_code=400,
                detail="File is empty"
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Upload] Failed to read file: {e}")
        raise HTTPException(status_code=500, detail="Failed to read uploaded file")

    # Extract text based on file type
    try:
        extracted = await _extract_text(content, extension, filename)
    except Exception as e:
        logger.error(f"[Upload] Text extraction failed: {e}")
        raise HTTPException(
            status_code=400,
            detail=f"Failed to extract text from file: {str(e)}"
        )

    if not extracted["cleaned_text"] or extracted["word_count"] < 50:
        raise HTTPException(
            status_code=400,
            detail="File contains too little text. Minimum 50 words required."
        )

    # Determine title
    content_title = title or _clean_filename(filename)

    logger.info(
        f"[Upload] Extracted {extracted['word_count']} words from {filename}. "
        f"Title: '{content_title}'"
    )

    # Create movie entry
    try:
        movie = await db.movie.create(
            data={
                "title": content_title,
                "actualTitle": content_title,
                "year": datetime.now().year,
                "description": f"Uploaded file: {filename}",
            }
        )
        logger.info(f"[Upload] Created movie entry with id={movie.id}")

        # Create movie script entry
        metadata = {
            "original_filename": filename,
            "file_extension": extension,
            "uploader_id": current_user.id,
            **extracted.get("metadata", {})
        }

        script = await db.moviescript.create(
            data={
                "movieId": movie.id,
                "sourceUsed": scriptsource.MANUAL_UPLOAD,
                "rawSubtitleText": extracted.get("raw_text", "")[:50000],  # Limit raw storage
                "cleanedScriptText": extracted["cleaned_text"],
                "cleanedWordCount": extracted["word_count"],
                "isComplete": True,
                "isTruncated": False,
                "processingMetadata": json.dumps(metadata)
            }
        )
        logger.info(f"[Upload] Created script entry with id={script.id}")

    except Exception as e:
        logger.error(f"[Upload] Failed to create database entries: {e}")
        raise HTTPException(
            status_code=500,
            detail="Failed to save uploaded content"
        )

    # Classify words with CEFR
    try:
        classifier = get_classifier()
        classifications = classifier.classify_text(extracted["cleaned_text"])

        # Compute statistics
        level_distribution = {"A1": 0, "A2": 0, "B1": 0, "B2": 0, "C1": 0, "C2": 0}
        unique_lemmas = set()

        for cls in classifications:
            level = cls.cefr_level.value
            level_distribution[level] = level_distribution.get(level, 0) + 1
            unique_lemmas.add(cls.lemma)

        unique_words = len(unique_lemmas)

        # Save classifications to database
        unique = {}
        for cls in classifications:
            key = (cls.lemma, cls.cefr_level.value)
            if key not in unique:
                unique[key] = cls

        cls_list = list(unique.values())

        # Batch inserts
        batch_size = 200
        for i in range(0, len(cls_list), batch_size):
            batch = cls_list[i:i + batch_size]
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

        logger.info(f"[Upload] Saved {len(cls_list)} word classifications")

        # Update movie with difficulty info
        from ..services.difficulty_scorer import compute_difficulty_advanced, WordData

        word_data_list = [
            WordData(
                cefr_level=cls.cefr_level.value,
                confidence=cls.confidence,
                frequency_rank=cls.frequency_rank,
                word=cls.word
            )
            for cls in classifications
        ]

        level, score, breakdown = compute_difficulty_advanced(word_data_list, genres=[])

        await db.movie.update(
            where={'id': movie.id},
            data={
                'difficultyLevel': level,
                'difficultyScore': score,
                'cefrDistribution': json.dumps(breakdown) if breakdown else None
            }
        )

        logger.info(
            f"[Upload] ✓ Processing complete for '{content_title}': "
            f"movie_id={movie.id}, words={extracted['word_count']}, unique={unique_words}"
        )

        return FileUploadResponse(
            movie_id=movie.id,
            title=content_title,
            word_count=extracted["word_count"],
            unique_words=unique_words,
            cefr_distribution=level_distribution
        )

    except Exception as e:
        logger.error(f"[Upload] CEFR classification failed: {e}", exc_info=True)
        # Still return success since the file was saved
        return FileUploadResponse(
            movie_id=movie.id,
            title=content_title,
            word_count=extracted["word_count"],
            unique_words=0,
            cefr_distribution={"A1": 0, "A2": 0, "B1": 0, "B2": 0, "C1": 0, "C2": 0}
        )


async def _extract_text(content: bytes, extension: str, filename: str) -> dict:
    """
    Extract text from file based on its extension.

    Returns dict with:
        - raw_text: Original extracted text
        - cleaned_text: Normalized text
        - word_count: Number of words
        - metadata: Extraction metadata
    """
    if extension in {'.srt', '.vtt'}:
        return _extract_from_subtitle(content, extension, filename)
    elif extension == '.txt':
        return _extract_from_txt(content, filename)
    elif extension == '.epub':
        return _extract_from_epub(content, filename)
    elif extension == '.pdf':
        return await _extract_from_pdf(content, filename)
    else:
        raise ValueError(f"Unsupported extension: {extension}")


def _extract_from_subtitle(content: bytes, extension: str, filename: str) -> dict:
    """Extract text from SRT/VTT subtitle files"""
    parser = SubtitleParser()

    # Decode content
    text = content.decode('utf-8', errors='ignore')

    if extension == '.vtt':
        result = parser.parse_vtt(text, filename)
    else:
        result = parser.parse_srt(text, filename)

    return {
        "raw_text": result.get("raw_text", text),
        "cleaned_text": result["cleaned_text"],
        "word_count": result["word_count"],
        "metadata": result.get("metadata", {})
    }


def _extract_from_txt(content: bytes, filename: str) -> dict:
    """Extract text from plain text files"""
    import re

    # Try to decode with common encodings
    text = None
    for encoding in ['utf-8', 'utf-16', 'latin-1', 'cp1252']:
        try:
            text = content.decode(encoding)
            break
        except UnicodeDecodeError:
            continue

    if text is None:
        text = content.decode('utf-8', errors='ignore')

    # Normalize whitespace
    cleaned = re.sub(r'\s+', ' ', text).strip()

    # Count words
    word_count = len(re.findall(r'\b\w+\b', cleaned))

    return {
        "raw_text": text,
        "cleaned_text": cleaned,
        "word_count": word_count,
        "metadata": {"format": "txt"}
    }


def _extract_from_epub(content: bytes, filename: str) -> dict:
    """Extract text from EPUB e-book files"""
    extractor = EPUBExtractor()
    result = extractor.extract_from_bytes(content, filename)

    return {
        "raw_text": result.get("raw_text", ""),
        "cleaned_text": result["cleaned_text"],
        "word_count": result["word_count"],
        "metadata": result.get("metadata", {})
    }


async def _extract_from_pdf(content: bytes, filename: str) -> dict:
    """Extract text from PDF files"""
    import io
    import re

    try:
        import pdfplumber

        pdf_file = io.BytesIO(content)
        text_parts = []

        with pdfplumber.open(pdf_file) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text_parts.append(page_text)

        raw_text = "\n\n".join(text_parts)

        # Normalize
        cleaned = re.sub(r'\s+', ' ', raw_text).strip()
        word_count = len(re.findall(r'\b\w+\b', cleaned))

        return {
            "raw_text": raw_text,
            "cleaned_text": cleaned,
            "word_count": word_count,
            "metadata": {"format": "pdf", "pages": len(text_parts)}
        }

    except Exception as e:
        # Try pypdf as fallback
        try:
            from pypdf import PdfReader

            pdf_file = io.BytesIO(content)
            reader = PdfReader(pdf_file)
            text_parts = []

            for page in reader.pages:
                page_text = page.extract_text()
                if page_text:
                    text_parts.append(page_text)

            raw_text = "\n\n".join(text_parts)
            cleaned = re.sub(r'\s+', ' ', raw_text).strip()
            word_count = len(re.findall(r'\b\w+\b', cleaned))

            return {
                "raw_text": raw_text,
                "cleaned_text": cleaned,
                "word_count": word_count,
                "metadata": {"format": "pdf", "pages": len(text_parts), "method": "pypdf"}
            }
        except Exception as fallback_error:
            raise ValueError(f"Failed to extract PDF: {e}, fallback also failed: {fallback_error}")


def _get_file_extension(filename: str) -> str:
    """Get lowercase file extension including the dot"""
    import os
    _, ext = os.path.splitext(filename)
    return ext.lower()


def _clean_filename(filename: str) -> str:
    """Remove extension and clean up filename for use as title"""
    import os
    import re

    # Remove extension
    name, _ = os.path.splitext(filename)

    # Replace underscores and dashes with spaces
    name = re.sub(r'[_-]+', ' ', name)

    # Remove extra whitespace
    name = re.sub(r'\s+', ' ', name).strip()

    # Capitalize first letter of each word
    name = name.title()

    return name if name else "Uploaded Content"
