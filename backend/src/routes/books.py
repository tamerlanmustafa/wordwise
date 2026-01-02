"""
Books API Routes

Endpoints for searching, fetching, and analyzing public domain books.
Uses Open Library for metadata and Gutenberg for full text.
Books are stored separately from Movies with their own models.
"""

import json
import logging
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from prisma import Prisma
from prisma.enums import booksourcetype

from ..database import get_db
from fastapi.responses import PlainTextResponse

from ..middleware.auth import get_current_active_user, get_admin_user
from ..services.book_ingestion_service import get_book_ingestion_service
from ..services.gutendex_client import get_gutendex_client
from ..services.open_library_client import get_open_library_client
from .cefr import get_classifier

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/books", tags=["books"])


@router.get("/search")
async def search_books(
    q: str = Query(..., min_length=1, description="Search query"),
    limit: int = Query(20, ge=1, le=50, description="Maximum results"),
    page: int = Query(1, ge=1, description="Page number")
):
    """
    Search for public domain books.

    Searches both Open Library (metadata) and Gutenberg (text availability)
    to find books that have available public domain text.
    """
    logger.info(f"[Books] Searching: {q}")

    service = get_book_ingestion_service()
    results = await service.search_books(query=q, limit=limit)

    return {
        "query": q,
        "books": results.get("books", []),
        "total": results.get("total", 0),
        "has_text": results.get("has_text", False),
        "source": results.get("source", "unknown"),
    }


@router.get("/gutenberg/search")
async def search_gutenberg_books(
    q: str = Query(..., min_length=1, description="Search query"),
    page: int = Query(1, ge=1, description="Page number")
):
    """
    Search Project Gutenberg directly for public domain books.
    """
    client = get_gutendex_client()
    results = await client.search_public_domain(query=q, page=page)

    return {
        "query": q,
        "books": results.get("books", []),
        "total": results.get("total", 0),
        "next": results.get("next"),
        "previous": results.get("previous"),
    }


@router.get("/gutenberg/{gutenberg_id}")
async def get_gutenberg_book(gutenberg_id: int):
    """
    Get details for a specific Gutenberg book (from external API).
    """
    service = get_book_ingestion_service()
    book = await service.get_book_details(gutenberg_id)

    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    return book


@router.get("/gutenberg/{gutenberg_id}/download")
async def download_gutenberg_book(
    gutenberg_id: int,
    format: str = Query("txt", description="Download format: txt, epub, or html"),
    current_user=Depends(get_admin_user)
):
    """
    Download a Gutenberg book in various formats (admin only).

    Formats:
    - txt: Plain text (cleaned, no page numbers)
    - epub: EPUB format (may contain page markers)
    - html: HTML format (may contain page/chapter markers)
    """
    from fastapi.responses import Response

    client = get_gutendex_client()
    book = await client.get_book(gutenberg_id)

    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    # Create a safe filename
    safe_title = re.sub(r'[^\w\s-]', '', book.title)[:50].strip()

    if format == "txt":
        # Download plain text
        text = await client.download_text(book)
        if not text:
            raise HTTPException(status_code=404, detail="Plain text not available for this book")

        return PlainTextResponse(
            content=text,
            headers={
                "Content-Disposition": f'attachment; filename="{safe_title}_{gutenberg_id}.txt"'
            }
        )

    elif format == "epub":
        # Download EPUB
        epub_url = book.epub_url
        if not epub_url:
            raise HTTPException(status_code=404, detail="EPUB not available for this book")

        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get(epub_url) as response:
                if response.status != 200:
                    raise HTTPException(status_code=404, detail="Failed to download EPUB")
                content = await response.read()

        return Response(
            content=content,
            media_type="application/epub+zip",
            headers={
                "Content-Disposition": f'attachment; filename="{safe_title}_{gutenberg_id}.epub"'
            }
        )

    elif format == "html":
        # Download HTML
        html_url = book.html_url
        if not html_url:
            raise HTTPException(status_code=404, detail="HTML not available for this book")

        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get(html_url) as response:
                if response.status != 200:
                    raise HTTPException(status_code=404, detail="Failed to download HTML")
                content = await response.text()

        return PlainTextResponse(
            content=content,
            media_type="text/html",
            headers={
                "Content-Disposition": f'attachment; filename="{safe_title}_{gutenberg_id}.html"'
            }
        )

    else:
        raise HTTPException(status_code=400, detail=f"Invalid format: {format}. Use txt, epub, or html")


@router.get("/gutenberg/{gutenberg_id}/epub")
async def stream_gutenberg_epub(
    gutenberg_id: int,
    db: Prisma = Depends(get_db)
):
    """
    Stream EPUB content for in-browser reading.

    This endpoint serves cached EPUB from our database if available,
    otherwise fetches from Gutenberg, caches it, and serves it.
    This avoids CORS issues and speeds up subsequent loads.
    """
    from fastapi.responses import Response

    # First, check if we have the EPUB cached in our database
    book_record = await db.book.find_first(
        where={"gutenbergId": gutenberg_id},
        include={"bookText": True}
    )

    if book_record and book_record.bookText and book_record.bookText.epubContent:
        # Serve from cache
        logger.info(f"[EPUB] Serving cached EPUB for gutenberg_id={gutenberg_id}")
        return Response(
            content=bytes(book_record.bookText.epubContent),
            media_type="application/epub+zip",
            headers={
                "Cache-Control": "public, max-age=604800",  # Cache for 1 week
                "X-Cache": "HIT"
            }
        )

    # Not cached - fetch from Gutenberg
    client = get_gutendex_client()
    gutenberg_book = await client.get_book(gutenberg_id)

    if not gutenberg_book:
        raise HTTPException(status_code=404, detail="Book not found")

    epub_url = gutenberg_book.epub_url
    if not epub_url:
        raise HTTPException(status_code=404, detail="EPUB not available for this book")

    import aiohttp
    async with aiohttp.ClientSession() as session:
        async with session.get(epub_url) as response:
            if response.status != 200:
                raise HTTPException(status_code=404, detail="Failed to fetch EPUB")
            content = await response.read()

    logger.info(f"[EPUB] Fetched EPUB from Gutenberg for gutenberg_id={gutenberg_id}, size={len(content)} bytes")

    # Cache the EPUB if the book exists in our database
    if book_record and book_record.bookText:
        try:
            await db.booktext.update(
                where={"id": book_record.bookText.id},
                data={"epubContent": content}
            )
            logger.info(f"[EPUB] Cached EPUB for book_id={book_record.id}")
        except Exception as e:
            logger.warning(f"[EPUB] Failed to cache EPUB: {e}")

    return Response(
        content=content,
        media_type="application/epub+zip",
        headers={
            "Cache-Control": "public, max-age=86400",  # Cache for 1 day
            "X-Cache": "MISS"
        }
    )


@router.get("/gutenberg/{gutenberg_id}/pages")
async def analyze_book_pages(
    gutenberg_id: int,
    current_user=Depends(get_admin_user)
):
    """
    Analyze page structure of a Gutenberg book (admin only).

    Tries to extract page markers from the book in this order:
    1. EPUB file (most likely to have page markers)
    2. HTML file (may have page comments/anchors)
    3. Plain text (may have [Page X] markers)
    4. Falls back to word-count estimation

    Returns information about detected pages without the full text.
    """
    from ..services.page_extractor import get_page_extractor
    import aiohttp

    client = get_gutendex_client()
    book = await client.get_book(gutenberg_id)

    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    extractor = get_page_extractor()
    result = None

    # Try EPUB first (most likely to have page markers)
    if book.epub_url:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(book.epub_url) as response:
                    if response.status == 200:
                        epub_content = await response.read()
                        result = await extractor.extract_from_epub(epub_content)
                        if result.success and 'estimated' not in result.method:
                            # Found real page markers in EPUB
                            pass
                        else:
                            result = None  # Try other formats
        except Exception as e:
            logger.warning(f"[Books] EPUB page extraction failed: {e}")

    # Try HTML if EPUB didn't work
    if result is None and book.html_url:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(book.html_url) as response:
                    if response.status == 200:
                        html_content = await response.text()
                        result = await extractor.extract_from_html(html_content)
                        if result.success and 'estimated' not in result.method:
                            pass
                        else:
                            result = None
        except Exception as e:
            logger.warning(f"[Books] HTML page extraction failed: {e}")

    # Try plain text
    if result is None:
        try:
            text = await client.download_text(book)
            if text:
                result = await extractor.extract_from_text(text)
        except Exception as e:
            logger.warning(f"[Books] Text page extraction failed: {e}")

    if result is None:
        raise HTTPException(
            status_code=404,
            detail="Could not extract page information from any format"
        )

    # Return summary (not full text to keep response small)
    return {
        "gutenberg_id": gutenberg_id,
        "title": book.title,
        "success": result.success,
        "method": result.method,
        "total_pages": result.total_pages,
        "warnings": result.warnings,
        "sample_pages": [
            {
                "page_number": p.page_number,
                "text_preview": p.text[:200] + "..." if len(p.text) > 200 else p.text,
                "word_count": len(p.text.split())
            }
            for p in result.pages[:5]  # First 5 pages as sample
        ],
        "available_formats": {
            "epub": book.epub_url is not None,
            "html": book.html_url is not None,
            "txt": book.plain_text_url is not None
        }
    }


@router.get("/by-gutenberg/{gutenberg_id}")
async def get_book_by_gutenberg_id(
    gutenberg_id: int,
    db: Prisma = Depends(get_db)
):
    """
    Check if a book with this Gutenberg ID has already been analyzed.
    Returns the book if it exists, 404 if not.
    """
    book = await db.book.find_unique(
        where={"gutenbergId": gutenberg_id}
    )

    if not book:
        raise HTTPException(status_code=404, detail="Book not analyzed yet")

    return {
        "id": book.id,
        "title": book.title,
        "author": book.author,
        "year": book.year,
        "description": book.description,
        "cover_url": book.coverUrl,
        "difficulty_level": book.difficultyLevel,
        "difficulty_score": book.difficultyScore,
        "word_count": book.wordCount,
        "gutenberg_id": book.gutenbergId,
        "open_library_key": book.openLibraryKey,
    }


@router.post("/analyze/{gutenberg_id}")
async def analyze_book(
    gutenberg_id: int,
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db)
):
    """
    Download and analyze a book from Project Gutenberg.

    This will:
    1. Download the full text from Gutenberg
    2. Create a Book entry in the database
    3. Run CEFR classification on the text
    4. Return the book ID for vocabulary viewing

    Requires authentication.
    """
    logger.info(f"[Books] Analyzing Gutenberg book: {gutenberg_id}")

    # Check if book already exists
    existing = await db.book.find_unique(
        where={"gutenbergId": gutenberg_id}
    )

    if existing:
        logger.info(f"[Books] Book {gutenberg_id} already exists as book {existing.id}")
        return {
            "book_id": existing.id,
            "title": existing.title,
            "already_exists": True
        }

    # Fetch book details and text
    service = get_book_ingestion_service()

    book_details = await service.get_book_details(gutenberg_id)
    if not book_details:
        raise HTTPException(status_code=404, detail="Book not found in Gutenberg")

    # Download full text
    book_text = await service.get_book_text(gutenberg_id)
    if not book_text:
        raise HTTPException(
            status_code=400,
            detail="Failed to download book text. This book may not have a plain text version available."
        )

    # Get word count
    word_count = len(re.findall(r'\b\w+\b', book_text))

    if word_count < 100:
        raise HTTPException(
            status_code=400,
            detail="Book text is too short for analysis (less than 100 words)."
        )

    logger.info(f"[Books] Downloaded book text: {word_count} words")

    # Extract page information
    from ..services.page_extractor import get_page_extractor
    import aiohttp

    extractor = get_page_extractor()
    page_result = None
    page_data = None

    # Try to get page markers from different formats
    client = get_gutendex_client()
    gutenberg_book = await client.get_book(gutenberg_id)

    if gutenberg_book:
        # Try EPUB first
        if gutenberg_book.epub_url:
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(gutenberg_book.epub_url) as response:
                        if response.status == 200:
                            epub_content = await response.read()
                            page_result = await extractor.extract_from_epub(epub_content)
                            if not page_result.success or 'estimated' in page_result.method:
                                page_result = None
            except Exception as e:
                logger.warning(f"[Books] EPUB page extraction failed: {e}")

        # Try HTML if EPUB didn't work
        if page_result is None and gutenberg_book.html_url:
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(gutenberg_book.html_url) as response:
                        if response.status == 200:
                            html_content = await response.text()
                            page_result = await extractor.extract_from_html(html_content)
                            if not page_result.success or 'estimated' in page_result.method:
                                page_result = None
            except Exception as e:
                logger.warning(f"[Books] HTML page extraction failed: {e}")

    # Fall back to text-based extraction or estimation
    if page_result is None:
        page_result = await extractor.extract_from_text(book_text)

    if page_result and page_result.success:
        # Store page boundaries for later lookup
        page_data = [
            {
                "page": p.page_number,
                "start": p.start_position,
                "end": p.end_position
            }
            for p in page_result.pages
        ]
        logger.info(f"[Books] Extracted {page_result.total_pages} pages using {page_result.method}")

    # Create book entry
    try:
        # Determine year from author death year or first publish year
        year = book_details.get("first_publish_year")
        if not year and book_details.get("author_death_year"):
            year = book_details["author_death_year"]

        book_entry = await db.book.create(
            data={
                "title": book_details.get("title", "Unknown"),
                "author": book_details.get("author"),
                "year": year,
                "description": book_details.get("description") or f"Public domain book by {book_details.get('author', 'Unknown')}",
                "coverUrl": book_details.get("cover_large") or book_details.get("cover_medium"),
                "gutenbergId": gutenberg_id,
                "openLibraryKey": book_details.get("open_library_key"),
            }
        )

        logger.info(f"[Books] Created book entry: {book_entry.id}")

        # Create BookText entry
        metadata = {
            "gutenberg_id": gutenberg_id,
            "author": book_details.get("author"),
            "subjects": book_details.get("subjects", []),
            "download_url": book_details.get("plain_text_url"),
        }

        book_text_entry = await db.booktext.create(
            data={
                "book": {"connect": {"id": book_entry.id}},
                "sourceType": booksourcetype.GUTENBERG,
                "rawText": book_text[:100000],  # Store first 100k chars
                "cleanedText": book_text,
                "cleanedWordCount": word_count,
                "processingMetadata": json.dumps(metadata),
                "totalPages": page_result.total_pages if page_result else None,
                "pageExtractionMethod": page_result.method if page_result else None,
                "pageData": json.dumps(page_data) if page_data else None,
            }
        )

        logger.info(f"[Books] Created book text entry: {book_text_entry.id}")

        # Run CEFR classification
        try:
            classifier = get_classifier()
            classifications = classifier.classify_text(book_text)

            # Build a helper to find page number for a word position
            def find_page_for_word(word: str) -> Optional[int]:
                """Find which page a word first appears on"""
                if not page_data:
                    return None
                # Find first occurrence of word in text
                pos = book_text.lower().find(word.lower())
                if pos == -1:
                    return None
                # Find which page this position falls into
                for page_info in page_data:
                    if page_info["start"] <= pos < page_info["end"]:
                        return page_info["page"]
                return None

            # Compute statistics
            level_distribution = {"A1": 0, "A2": 0, "B1": 0, "B2": 0, "C1": 0, "C2": 0}
            unique_lemmas = set()

            for cls in classifications:
                level = cls.cefr_level.value
                level_distribution[level] = level_distribution.get(level, 0) + 1
                unique_lemmas.add(cls.lemma)

            unique_words = len(unique_lemmas)

            # Save classifications to database (batch) - deduplicate first
            unique = {}
            for cls in classifications:
                key = (cls.lemma, cls.cefr_level.value)
                if key not in unique:
                    unique[key] = cls

            cls_list = list(unique.values())

            # Pre-compute page numbers for all words
            word_pages = {cls.word: find_page_for_word(cls.word) for cls in cls_list}

            batch_size = 200
            for i in range(0, len(cls_list), batch_size):
                batch = cls_list[i:i + batch_size]
                await db.bookwordclassification.create_many(
                    data=[
                        {
                            'bookTextId': book_text_entry.id,
                            'word': cls.word,
                            'lemma': cls.lemma,
                            'pos': cls.pos or None,
                            'cefrLevel': cls.cefr_level.value,
                            'confidence': cls.confidence,
                            'source': cls.source.value,
                            'frequencyRank': cls.frequency_rank,
                            'pageNumber': word_pages.get(cls.word),
                        }
                        for cls in batch
                    ],
                    skip_duplicates=True
                )

            logger.info(f"[Books] Saved {len(cls_list)} word classifications")

            # Update book with difficulty info
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

            await db.book.update(
                where={'id': book_entry.id},
                data={
                    'difficultyLevel': level,
                    'difficultyScore': score,
                    'cefrDistribution': json.dumps(breakdown) if breakdown else None,
                    'wordCount': word_count
                }
            )

            logger.info(
                f"[Books] ✓ Analysis complete for '{book_entry.title}': "
                f"book_id={book_entry.id}, words={word_count}, unique={unique_words}"
            )

            return {
                "book_id": book_entry.id,
                "title": book_entry.title,
                "author": book_details.get("author"),
                "word_count": word_count,
                "unique_words": unique_words,
                "cefr_distribution": level_distribution,
                "difficulty_level": level,
                "difficulty_score": score,
                "already_exists": False
            }

        except Exception as e:
            logger.error(f"[Books] Classification failed: {e}", exc_info=True)
            # Still return success since book was saved
            return {
                "book_id": book_entry.id,
                "title": book_entry.title,
                "author": book_details.get("author"),
                "word_count": word_count,
                "unique_words": 0,
                "cefr_distribution": {},
                "already_exists": False,
                "warning": "Classification failed, vocabulary may not be available"
            }

    except Exception as e:
        logger.error(f"[Books] Failed to create book entry: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to save book: {str(e)}"
        )


@router.get("/{book_id}")
async def get_book(
    book_id: int,
    db: Prisma = Depends(get_db)
):
    """
    Get book details by ID.
    """
    book = await db.book.find_unique(
        where={"id": book_id}
    )

    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    return {
        "id": book.id,
        "title": book.title,
        "author": book.author,
        "year": book.year,
        "description": book.description,
        "cover_url": book.coverUrl,
        "difficulty_level": book.difficultyLevel,
        "difficulty_score": book.difficultyScore,
        "word_count": book.wordCount,
        "gutenberg_id": book.gutenbergId,
        "open_library_key": book.openLibraryKey,
    }


@router.get("/{book_id}/difficulty")
async def get_book_difficulty(
    book_id: int,
    db: Prisma = Depends(get_db)
):
    """
    Get book difficulty information.
    """
    book = await db.book.find_unique(where={"id": book_id})

    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    breakdown = None
    if book.cefrDistribution:
        try:
            breakdown = json.loads(book.cefrDistribution) if isinstance(book.cefrDistribution, str) else book.cefrDistribution
        except:
            pass

    return {
        "difficulty_level": book.difficultyLevel,
        "difficulty_score": book.difficultyScore,
        "breakdown": breakdown
    }


@router.get("/{book_id}/vocabulary")
async def get_book_vocabulary(
    book_id: int,
    db: Prisma = Depends(get_db),
    current_user=Depends(get_current_active_user)
):
    """
    Get vocabulary analysis for a book.
    Requires authentication for full access.
    """
    book = await db.book.find_unique(
        where={"id": book_id},
        include={"bookText": True}
    )

    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    if not book.bookText:
        raise HTTPException(status_code=404, detail="Book text not found")

    # Get word classifications
    classifications = await db.bookwordclassification.find_many(
        where={"bookTextId": book.bookText.id},
        order={"frequencyRank": "asc"}
    )

    # Build level distribution and top words by level
    level_distribution = {"A1": 0, "A2": 0, "B1": 0, "B2": 0, "C1": 0, "C2": 0}
    top_words_by_level = {"A1": [], "A2": [], "B1": [], "B2": [], "C1": [], "C2": []}

    for cls in classifications:
        level = cls.cefrLevel
        level_distribution[level] = level_distribution.get(level, 0) + 1

        if len(top_words_by_level[level]) < 50:
            top_words_by_level[level].append({
                "word": cls.word,
                "lemma": cls.lemma,
                "confidence": cls.confidence,
                "frequency_rank": cls.frequencyRank
            })

    return {
        "book_id": book.id,
        "title": book.title,
        "total_words": book.bookText.cleanedWordCount or 0,
        "unique_words": len(classifications),
        "level_distribution": level_distribution,
        "top_words_by_level": top_words_by_level,
        "idioms": []
    }


@router.get("/{book_id}/vocabulary/preview")
async def get_book_vocabulary_preview(
    book_id: int,
    db: Prisma = Depends(get_db)
):
    """
    Get a preview of vocabulary analysis (limited, no auth required).
    """
    book = await db.book.find_unique(
        where={"id": book_id},
        include={"bookText": True}
    )

    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    if not book.bookText:
        raise HTTPException(status_code=404, detail="Book text not found")

    # Get word classifications (limited)
    classifications = await db.bookwordclassification.find_many(
        where={"bookTextId": book.bookText.id},
        order={"frequencyRank": "asc"},
        take=100  # Limited for preview
    )

    # Build level distribution
    level_distribution = {"A1": 0, "A2": 0, "B1": 0, "B2": 0, "C1": 0, "C2": 0}
    top_words_by_level = {"A1": [], "A2": [], "B1": [], "B2": [], "C1": [], "C2": []}

    for cls in classifications:
        level = cls.cefrLevel
        level_distribution[level] = level_distribution.get(level, 0) + 1

        if len(top_words_by_level[level]) < 10:  # Limited for preview
            top_words_by_level[level].append({
                "word": cls.word,
                "lemma": cls.lemma,
                "confidence": cls.confidence,
                "frequency_rank": cls.frequencyRank
            })

    return {
        "book_id": book.id,
        "title": book.title,
        "total_words": book.bookText.cleanedWordCount or 0,
        "unique_words": len(classifications),
        "level_distribution": level_distribution,
        "top_words_by_level": top_words_by_level,
        "idioms": [],
        "is_preview": True
    }


@router.get("/{book_id}/pages")
async def get_book_page_info(
    book_id: int,
    db: Prisma = Depends(get_db)
):
    """
    Get page information for a book.
    Returns total pages and extraction method used.
    """
    book = await db.book.find_unique(
        where={"id": book_id},
        include={"bookText": True}
    )

    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    if not book.bookText:
        raise HTTPException(status_code=404, detail="Book text not found")

    return {
        "book_id": book.id,
        "title": book.title,
        "total_pages": book.bookText.totalPages,
        "extraction_method": book.bookText.pageExtractionMethod,
        "has_page_data": book.bookText.pageData is not None
    }


@router.get("/{book_id}/vocabulary/pages")
async def get_book_vocabulary_by_pages(
    book_id: int,
    start_page: int = Query(..., ge=1, description="Start page number"),
    end_page: int = Query(..., ge=1, description="End page number"),
    db: Prisma = Depends(get_db),
    current_user=Depends(get_current_active_user)
):
    """
    Get vocabulary for a specific page range.
    Useful for learning words before reading specific pages.
    Requires authentication.
    """
    if end_page < start_page:
        raise HTTPException(status_code=400, detail="end_page must be >= start_page")

    book = await db.book.find_unique(
        where={"id": book_id},
        include={"bookText": True}
    )

    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    if not book.bookText:
        raise HTTPException(status_code=404, detail="Book text not found")

    if not book.bookText.totalPages:
        raise HTTPException(
            status_code=400,
            detail="This book doesn't have page information. Re-analyze the book to extract pages."
        )

    # Get word classifications for the page range
    classifications = await db.bookwordclassification.find_many(
        where={
            "bookTextId": book.bookText.id,
            "pageNumber": {
                "gte": start_page,
                "lte": end_page
            }
        },
        order={"pageNumber": "asc"}
    )

    # Build level distribution and words by level
    level_distribution = {"A1": 0, "A2": 0, "B1": 0, "B2": 0, "C1": 0, "C2": 0}
    words_by_level = {"A1": [], "A2": [], "B1": [], "B2": [], "C1": [], "C2": []}

    for cls in classifications:
        level = cls.cefrLevel
        level_distribution[level] = level_distribution.get(level, 0) + 1

        words_by_level[level].append({
            "word": cls.word,
            "lemma": cls.lemma,
            "confidence": cls.confidence,
            "frequency_rank": cls.frequencyRank,
            "page_number": cls.pageNumber
        })

    return {
        "book_id": book.id,
        "title": book.title,
        "page_range": {"start": start_page, "end": end_page},
        "total_pages": book.bookText.totalPages,
        "words_in_range": len(classifications),
        "level_distribution": level_distribution,
        "words_by_level": words_by_level
    }
