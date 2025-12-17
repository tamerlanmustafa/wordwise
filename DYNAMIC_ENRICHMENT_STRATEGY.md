# Dynamic Enrichment Strategy for All Movies

## The Real Requirement

**Users can search for ANY movie** → We can't pre-enrich everything → **Must enrich on-demand**

Current database: 12 movies with scripts
**Potential movies:** Unlimited (TMDB has 1M+ movies)

---

## Solution: **Automatic Pipeline with Background Processing**

### Architecture Flow

```
User searches movie
    ↓
Movie selected
    ↓
[1] Fetch script (if not exists)
    ↓
[2] Classify CEFR (if not exists)
    ↓
[3] Enrich with examples (if not exists for selected language) ← NEW
    ↓
User sees vocabulary with sentence examples
```

### Key Insight

Enrichment should be **part of the standard movie processing pipeline**, happening automatically after CEFR classification.

---

## Implementation: Automatic Enrichment Chain

### 1. **Modify Classification Endpoint**

The classification endpoint already runs after script fetch. We'll add enrichment to this chain.

**File:** `backend/src/routes/cefr.py`

```python
from fastapi import BackgroundTasks

@router.post("/classify-script", response_model=ScriptClassificationResponse)
async def classify_script(
    request: ScriptClassificationRequest,
    background_tasks: BackgroundTasks,
    db: Prisma = Depends(get_db)
):
    """
    Classify movie script and automatically enrich with sentence examples.
    """
    # ... existing classification logic ...

    # NEW: After successful classification, trigger enrichment
    if request.save_to_db:
        # Get target language from request or default to user's preference
        target_lang = getattr(request, 'target_language', 'ES')

        # Schedule enrichment in background (non-blocking)
        background_tasks.add_task(
            auto_enrich_after_classification,
            movie_id=request.movie_id,
            target_lang=target_lang
        )

        logger.info(
            f"✓ Classification complete for movie {request.movie_id}. "
            f"Enrichment scheduled for language {target_lang}"
        )

    return response


async def auto_enrich_after_classification(movie_id: int, target_lang: str):
    """
    Background task: Enrich movie with sentence examples after classification.

    This runs asynchronously and doesn't block the classification response.
    """
    try:
        # Check if enrichment already exists
        db = Prisma()
        await db.connect()

        existing = await db.wordsentenceexample.find_first(
            where={'movieId': movie_id, 'targetLang': target_lang}
        )

        if existing:
            logger.info(f"⚡ Movie {movie_id} already enriched for {target_lang} - skipping")
            await db.disconnect()
            return

        # Run enrichment
        from src.routes.enrichment import enrich_movie_examples, EnrichExamplesRequest

        logger.info(f"🔄 Starting background enrichment: movie {movie_id}, lang {target_lang}")

        await enrich_movie_examples(
            request=EnrichExamplesRequest(
                movie_id=movie_id,
                target_lang=target_lang,
                batch_size=25,
                delay_ms=500
            ),
            db=db
        )

        logger.info(f"✅ Background enrichment complete: movie {movie_id}, lang {target_lang}")
        await db.disconnect()

    except Exception as e:
        logger.error(f"❌ Background enrichment failed for movie {movie_id}: {e}", exc_info=True)
```

### 2. **Add Target Language to Classification Request**

**File:** `backend/src/routes/cefr.py`

```python
class ScriptClassificationRequest(BaseModel):
    """Request to classify a movie script"""
    movie_id: int
    save_to_db: bool = True
    target_language: Optional[str] = Field(
        default='ES',
        description="Target language for enrichment (e.g., 'ES', 'FR', 'DE')"
    )  # NEW: Add this field
```

### 3. **Update Frontend to Pass Target Language**

**File:** `frontend/src/pages/MovieDetail.tsx` (or wherever classification is triggered)

```typescript
// When user selects a movie
const classifyMovie = async (movieId: number, targetLanguage: string) => {
  const response = await fetch('/api/cefr/classify-script', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      movie_id: movieId,
      save_to_db: true,
      target_language: targetLanguage  // ← Pass user's selected language
    })
  });

  return response.json();
};
```

---

## User Experience Flow

### First-Time Movie View

```
User: Searches "The Godfather"
    ↓
App: Fetches script from IMSDB (30s)
    ↓
App: Classifies CEFR levels (10s)
    ↓
App: Shows vocabulary list immediately ✓
    ↓
Background: Enriching examples for Spanish... (60s, async)
    ↓
User: Expands word "family"
    ↓
UI: Shows translation + idioms immediately ✓
    ↓
UI: Shows "Generating examples from script..." (spinner)
    ↓
[After 60s background job finishes]
    ↓
UI: Shows 3 sentence examples ✓
```

### Second-Time Movie View (Same Language)

```
User: Opens "The Godfather" again
    ↓
App: Loads from cache instantly ✓
    ↓
User: Expands word "family"
    ↓
UI: Shows translation + examples instantly ✓ (already enriched)
```

### Same Movie, Different Language

```
User: Changes language Spanish → French
    ↓
App: Checks enrichment for FR
    ↓
Background: Enriching for French... (60s, async)
    ↓
User: Expands word "family"
    ↓
UI: Shows translation immediately ✓
    ↓
UI: Shows "Generating examples..." (first time for FR)
    ↓
[After 60s]
    ↓
UI: Shows French examples ✓
```

---

## UI Improvements

### 1. **Show Enrichment Status**

Add a status indicator when enrichment is in progress:

```typescript
// frontend/src/components/VocabularyHeader.tsx

export const VocabularyHeader = ({ movieId, targetLang }) => {
  const [enrichmentStatus, setEnrichmentStatus] = useState<'pending' | 'enriching' | 'ready'>('pending');

  useEffect(() => {
    // Check if enrichment exists
    const checkEnrichment = async () => {
      const response = await fetch(
        `/api/enrichment/movies/${movieId}/examples?lang=${targetLang}`
      );

      if (response.ok) {
        setEnrichmentStatus('ready');
      } else if (response.status === 404) {
        // Not enriched yet, poll for status
        setEnrichmentStatus('enriching');
        startPolling();
      }
    };

    checkEnrichment();
  }, [movieId, targetLang]);

  return (
    <Box>
      <Typography variant="h5">Vocabulary</Typography>

      {enrichmentStatus === 'enriching' && (
        <Alert severity="info" icon={<CircularProgress size={20} />}>
          Generating sentence examples from movie script...
          This takes about 1 minute and only happens once.
        </Alert>
      )}

      {enrichmentStatus === 'ready' && (
        <Chip
          icon={<CheckCircleIcon />}
          label="Sentence examples ready"
          color="success"
          size="small"
        />
      )}
    </Box>
  );
};
```

### 2. **Smart Polling in WordRow**

Instead of showing empty state, show a progress indicator:

```typescript
// frontend/src/components/WordRow.tsx

const [enrichmentStatus, setEnrichmentStatus] = useState<'checking' | 'enriching' | 'ready' | 'none'>('checking');

useEffect(() => {
  if (!movieId || !targetLang || !isExpanded) return;

  const checkExamples = async () => {
    const response = await fetch(
      `/api/enrichment/movies/${movieId}/examples/${word}?lang=${targetLang}`
    );

    if (response.ok) {
      const data = await response.json();
      setSentenceExamples(data.examples);
      setEnrichmentStatus('ready');
    } else if (response.status === 404) {
      // Check if enrichment is in progress
      const statusResponse = await fetch(
        `/api/enrichment/movies/${movieId}/status?lang=${targetLang}`
      );

      if (statusResponse.ok) {
        const { status } = await statusResponse.json();

        if (status === 'enriching') {
          setEnrichmentStatus('enriching');
          // Poll every 5 seconds
          setTimeout(checkExamples, 5000);
        } else {
          setEnrichmentStatus('none');
        }
      }
    }
  };

  checkExamples();
}, [movieId, targetLang, word, isExpanded]);

// In render:
{enrichmentStatus === 'enriching' && (
  <div className="word-row__examples">
    <span className="word-row__examples-loading">
      <CircularProgress size={16} />
      Generating examples from movie script (this takes ~1 minute)...
    </span>
  </div>
)}
```

---

## Backend: Add Enrichment Status Endpoint

**File:** `backend/src/routes/enrichment.py`

```python
@router.get("/movies/{movie_id}/status")
async def get_enrichment_status(
    movie_id: int,
    lang: str,
    db: Prisma = Depends(get_db)
):
    """
    Check enrichment status for a movie + language.

    Returns:
        - 'ready': Examples exist and ready to use
        - 'enriching': Background job in progress
        - 'not_started': Not yet enriched
    """
    # Check if examples exist
    existing = await db.wordsentenceexample.find_first(
        where={'movieId': movie_id, 'targetLang': lang.upper()}
    )

    if existing:
        return {"status": "ready", "movie_id": movie_id, "target_lang": lang.upper()}

    # Check if classification exists (prerequisite for enrichment)
    script = await db.moviescript.find_first(
        where={'movieId': movie_id},
        include={'wordClassifications': True}
    )

    if not script or not script.wordClassifications:
        return {"status": "not_started", "movie_id": movie_id, "target_lang": lang.upper()}

    # Classifications exist but no enrichment → assume enriching
    # (In production, you'd track this in a separate table or Redis)
    return {"status": "enriching", "movie_id": movie_id, "target_lang": lang.upper()}
```

---

## Handling Multiple Languages

### Problem
User switches from Spanish → French → German

### Solution
Use a queue system to enrich one language at a time:

```python
# backend/src/services/enrichment_queue.py

from asyncio import Queue, Lock
from typing import Dict, Tuple

class EnrichmentQueue:
    """
    Global queue for enrichment tasks.
    Ensures only one enrichment runs at a time per movie.
    """
    _instance = None
    _lock = Lock()

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance.queue = Queue()
            cls._instance.in_progress: Dict[Tuple[int, str], bool] = {}
        return cls._instance

    async def enqueue(self, movie_id: int, target_lang: str):
        """Add enrichment task to queue"""
        key = (movie_id, target_lang)

        async with self._lock:
            if key in self.in_progress and self.in_progress[key]:
                logger.info(f"⚠️  Enrichment already in progress for movie {movie_id}, lang {target_lang}")
                return

            self.in_progress[key] = True

        await self.queue.put((movie_id, target_lang))

    async def dequeue(self):
        """Get next task from queue"""
        movie_id, target_lang = await self.queue.get()
        return movie_id, target_lang

    async def mark_complete(self, movie_id: int, target_lang: str):
        """Mark task as complete"""
        key = (movie_id, target_lang)
        async with self._lock:
            self.in_progress[key] = False


# Use in background task:
queue = EnrichmentQueue()

async def auto_enrich_after_classification(movie_id: int, target_lang: str):
    await queue.enqueue(movie_id, target_lang)

    # Process queue
    while not queue.queue.empty():
        mid, lang = await queue.dequeue()

        try:
            # Run enrichment
            await enrich_movie_examples(...)
        finally:
            await queue.mark_complete(mid, lang)
```

---

## Cost Management

### Prevent Duplicate Enrichments

```python
async def auto_enrich_after_classification(movie_id: int, target_lang: str):
    # CRITICAL: Check if already enriched BEFORE starting
    existing = await db.wordsentenceexample.find_first(
        where={'movieId': movie_id, 'targetLang': target_lang}
    )

    if existing:
        logger.info(f"⚡ Enrichment already exists - skipping (saved $0.20)")
        return

    # Only enrich if needed
    await enrich_movie_examples(...)
```

### Rate Limiting

```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

@router.post("/examples")
@limiter.limit("10/hour")  # Max 10 enrichments per hour per IP
async def enrich_movie_examples(...):
    # Prevent abuse
    pass
```

---

## Testing Strategy

### 1. Test with New Movie

```bash
# Search for a movie not in database
# e.g., "Inception"

# Expected flow:
# 1. Script fetched (30s)
# 2. CEFR classified (10s)
# 3. Vocabulary shown (immediate)
# 4. Enrichment started in background (60s)
# 5. Examples appear when ready
```

### 2. Test Language Switching

```bash
# Open movie in Spanish → examples load
# Switch to French → new enrichment starts
# Switch back to Spanish → examples instant (cached)
```

### 3. Test Multiple Users

```bash
# User A opens "The Matrix" in Spanish
# User B opens "The Matrix" in Spanish (same time)
# Expected: Only 1 enrichment runs (deduplication works)
```

---

## Monitoring & Analytics

Track enrichment metrics:

```python
# backend/src/routes/enrichment.py

@router.get("/stats")
async def get_enrichment_stats(db: Prisma = Depends(get_db)):
    """
    Get enrichment statistics.
    Useful for admin dashboard.
    """
    total_movies = await db.movie.count()

    enriched_movies = await db.wordsentenceexample.group_by(
        by=['movieId'],
        count=True
    )

    languages = await db.wordsentenceexample.group_by(
        by=['targetLang'],
        count=True
    )

    total_examples = await db.wordsentenceexample.count()

    return {
        "total_movies": total_movies,
        "enriched_movies": len(enriched_movies),
        "languages": {lang['targetLang']: lang['_count'] for lang in languages},
        "total_examples": total_examples,
        "avg_examples_per_movie": total_examples / len(enriched_movies) if enriched_movies else 0
    }
```

---

## Summary

### What Changes

1. **Classification endpoint** → automatically triggers enrichment
2. **Frontend** → passes target language to classification
3. **WordRow** → shows loading state during enrichment
4. **New endpoint** → `/api/enrichment/movies/{id}/status` for polling

### What Stays the Same

- Enrichment API endpoints (already implemented)
- WordRow UI (already implemented)
- Sentence extraction logic (already implemented)

### Timeline

**Day 1 (2 hours):**
1. Add `target_language` field to classification request
2. Add background task to trigger enrichment
3. Add enrichment status endpoint

**Day 2 (2 hours):**
1. Update frontend to pass target language
2. Add enrichment status polling
3. Add UI indicators

**Day 3 (1 hour):**
1. Test with multiple movies
2. Test language switching
3. Deploy

---

## Cost Projections

**Assumptions:**
- Average movie: 250 unique sentences
- Cost per enrichment: $0.15
- Users per month: 100
- Average movies per user: 3
- Average languages per movie: 1.5

**Monthly cost:**
- 100 users × 3 movies × 1.5 languages = 450 enrichments
- 450 × $0.15 = **$67.50/month**

**Optimization:**
- Popular movies enriched once, used by many users
- Expected deduplication: 70%
- Actual cost: **~$20/month**

---

## Next Steps

Would you like me to:
1. ✅ **Implement automatic enrichment chain** (modify classification endpoint)
2. ✅ **Add enrichment status tracking** (new endpoint + polling)
3. ✅ **Update frontend UI** (status indicators + loading states)
4. ⏸️ **Add batch script for existing movies** (optional - for the 12 we have)

Let me know and I'll start implementing!
