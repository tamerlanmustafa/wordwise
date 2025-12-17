# Enrichment Automation Strategy

## Current State

**Database Status:**
- 12 movies with scripts
- 12 movies with CEFR classifications
- **Only 1 movie with enrichment** (Spirited Away - ID 14, Spanish)

**Problem:**
Users can only see sentence examples for Spirited Away in Spanish. All other movies show no examples.

## Goal

Make sentence examples available for **all movies** and **all languages** that users might select.

---

## Architecture Options

### **Option 1: Automatic Enrichment After Classification** ⭐ **RECOMMENDED**

**When:** Automatically enrich after CEFR classification completes

**How it works:**
1. User selects a movie → triggers CEFR classification (existing flow)
2. After classification succeeds → automatically trigger enrichment
3. Enrich for user's selected target language only
4. Show progress indicator in UI

**Implementation:**

```python
# backend/src/routes/cefr.py - in classify_script endpoint

@router.post("/classify-script")
async def classify_script(request: ScriptClassificationRequest, db: Prisma = Depends(get_db)):
    # ... existing classification logic ...

    # NEW: After classification succeeds
    if request.save_to_db and request.target_language:
        # Trigger enrichment in background
        background_tasks.add_task(
            enrich_movie_after_classification,
            movie_id=request.movie_id,
            target_lang=request.target_language,
            db=db
        )

    return response
```

**Pros:**
- ✅ Seamless UX - enrichment happens automatically
- ✅ Only enriches what's needed (user's target language)
- ✅ No manual admin work
- ✅ Enrichment status can be shown in UI
- ✅ Works for new movies as they're added

**Cons:**
- ❌ Adds 30-60s to first-time movie load (can be backgrounded)
- ❌ Translation API costs per movie per language
- ❌ Requires tracking enrichment status per (movie, language)

**Cost:** ~$0.10-0.30 per movie per language (300 sentences × DeepL rate)

---

### **Option 2: Batch Enrichment Script**

**When:** Run once to enrich all existing movies

**How it works:**
1. Create admin script to enrich all 12 movies
2. Run for common languages (ES, FR, DE, RU, etc.)
3. Re-run periodically for new movies

**Implementation:**

```python
# scripts/enrich_all_movies.py

import asyncio
from prisma import Prisma

async def enrich_all_movies():
    db = Prisma()
    await db.connect()

    # Get all movies with classifications
    scripts = await db.moviescript.find_many(
        where={'wordClassifications': {'some': {}}}
    )

    languages = ['ES', 'FR', 'DE', 'RU', 'IT', 'PT']

    for script in scripts:
        for lang in languages:
            print(f"Enriching movie {script.movieId} for {lang}...")
            # Call enrichment service
            await enrich_movie(script.movieId, lang, db)

    await db.disconnect()

asyncio.run(enrich_all_movies())
```

**Run:**
```bash
cd backend
python scripts/enrich_all_movies.py
```

**Pros:**
- ✅ Fast to implement
- ✅ Pre-enriches everything upfront
- ✅ No delay for users
- ✅ Simple - just run and forget

**Cons:**
- ❌ High upfront cost (12 movies × 6 languages = 72 enrichments)
- ❌ Enriches languages users might never select
- ❌ Needs re-running for new movies
- ❌ Wastes API calls on unused languages

**Cost:** ~$7.20-21.60 upfront (72 enrichments × $0.10-0.30 each)

---

### **Option 3: Lazy On-Demand Enrichment**

**When:** Enrich only when user first requests examples

**How it works:**
1. User expands a word
2. Frontend requests examples
3. If no enrichment exists → trigger enrichment automatically
4. Show "Generating examples..." spinner
5. Return examples when ready

**Implementation:**

```python
# backend/src/routes/enrichment.py

@router.get("/movies/{movie_id}/examples/{word}")
async def get_word_examples(
    movie_id: int,
    word: str,
    lang: str,
    background_tasks: BackgroundTasks,
    db: Prisma = Depends(get_db)
):
    # Check if enrichment exists
    examples = await db.wordsentenceexample.find_many(...)

    if examples:
        return examples

    # NEW: No enrichment? Trigger it now
    enrichment_exists = await check_enrichment_exists(movie_id, lang)

    if not enrichment_exists:
        # Start enrichment in background
        background_tasks.add_task(enrich_movie, movie_id, lang, db)

        # Return 202 Accepted (processing)
        return Response(status_code=202, content={"status": "enriching"})

    return examples
```

**Frontend handles 202:**
```typescript
const response = await fetch(`/api/enrichment/movies/${movieId}/examples/${word}?lang=${lang}`);

if (response.status === 202) {
  // Enrichment in progress
  setStatus("Generating examples from movie script...");

  // Poll every 5 seconds until ready
  const pollInterval = setInterval(async () => {
    const retry = await fetch(url);
    if (retry.ok) {
      clearInterval(pollInterval);
      const data = await retry.json();
      setExamples(data.examples);
    }
  }, 5000);
}
```

**Pros:**
- ✅ Zero upfront cost
- ✅ Only enriches what users actually use
- ✅ Most efficient API usage
- ✅ Scales naturally with usage

**Cons:**
- ❌ First user waits 30-60s for examples
- ❌ Complex polling logic in frontend
- ❌ Requires 202 status handling
- ❌ Could cause rate limit issues if many users trigger same movie

**Cost:** Minimal - only pays for what's used

---

### **Option 4: Enrichment Admin Dashboard**

**When:** Admin manually triggers enrichment per movie

**How it works:**
1. Add admin page: `/admin/enrichment`
2. Shows list of movies with enrichment status
3. Admin clicks "Enrich" button for each movie
4. Select languages to enrich

**Implementation:**

```typescript
// frontend/src/pages/AdminEnrichment.tsx

export const AdminEnrichment = () => {
  const movies = useMovies();

  return (
    <Table>
      {movies.map(movie => (
        <TableRow key={movie.id}>
          <TableCell>{movie.title}</TableCell>
          <TableCell>
            <EnrichmentStatus movieId={movie.id} />
          </TableCell>
          <TableCell>
            <LanguageSelector
              onEnrich={(lang) => enrichMovie(movie.id, lang)}
            />
          </TableCell>
        </TableRow>
      ))}
    </Table>
  );
};
```

**Pros:**
- ✅ Full admin control
- ✅ Can enrich popular movies first
- ✅ Easy to monitor progress
- ✅ Can re-enrich if needed

**Cons:**
- ❌ Requires manual work
- ❌ Needs admin UI development
- ❌ Admin must remember to enrich new movies
- ❌ Not user-friendly at scale

**Cost:** Variable - admin decides what to enrich

---

## Comparison Matrix

| Feature | Option 1: Auto | Option 2: Batch | Option 3: Lazy | Option 4: Admin |
|---------|---------------|----------------|----------------|----------------|
| **User Experience** | ⭐⭐⭐⭐⭐ Seamless | ⭐⭐⭐⭐⭐ Instant | ⭐⭐⭐ First wait | ⭐⭐ Depends on admin |
| **Cost Efficiency** | ⭐⭐⭐⭐ Good | ⭐⭐ Wasteful | ⭐⭐⭐⭐⭐ Best | ⭐⭐⭐ Variable |
| **Implementation** | ⭐⭐⭐ Moderate | ⭐⭐⭐⭐⭐ Easy | ⭐⭐ Complex | ⭐⭐⭐ Moderate |
| **Maintenance** | ⭐⭐⭐⭐⭐ None | ⭐⭐ Manual re-runs | ⭐⭐⭐⭐ Self-maintaining | ⭐⭐ Ongoing admin work |
| **Scalability** | ⭐⭐⭐⭐⭐ Excellent | ⭐⭐⭐ OK | ⭐⭐⭐⭐ Good | ⭐⭐ Poor |

---

## Recommendation: **Hybrid Approach** 🎯

Combine **Option 1 (Auto)** + **Option 2 (Batch)** for best results:

### **Phase 1: Immediate (Batch)**
1. Run batch script to enrich existing 12 movies for top 3 languages:
   - Spanish (ES)
   - French (FR)
   - German (DE)
2. Cost: ~$3.60-10.80 (36 enrichments)
3. Time: ~20-60 minutes

### **Phase 2: Ongoing (Auto)**
1. Modify classification endpoint to auto-enrich after classification
2. Only enriches user's selected language
3. Background task - doesn't block response
4. Shows enrichment status in UI

### **Implementation Steps:**

#### Step 1: Create Batch Script

```bash
# backend/scripts/enrich_all_movies.py
```

```python
import asyncio
from prisma import Prisma
from src.services.example_translation_service import ExampleTranslationService
from src.services.sentence_example_service import SentenceExampleService

LANGUAGES = ['ES', 'FR', 'DE']  # Top 3 languages

async def enrich_all_movies():
    db = Prisma()
    await db.connect()

    # Get all movies with scripts and classifications
    movies = await db.movie.find_many(
        where={
            'movieScripts': {'some': {}},
        },
        include={'movieScripts': True}
    )

    total = len(movies) * len(LANGUAGES)
    current = 0

    for movie in movies:
        if not movie.movieScripts:
            continue

        script = movie.movieScripts[0]

        # Check if has classifications
        classifications = await db.wordclassification.find_many(
            where={'scriptId': script.id},
            take=1
        )

        if not classifications:
            print(f"⚠️  Skipping movie {movie.id} ({movie.title}) - no classifications")
            continue

        for lang in LANGUAGES:
            current += 1

            # Check if already enriched
            existing = await db.wordsentenceexample.find_first(
                where={'movieId': movie.id, 'targetLang': lang}
            )

            if existing:
                print(f"✓ [{current}/{total}] Movie {movie.id} ({movie.title}) already enriched for {lang}")
                continue

            print(f"🔄 [{current}/{total}] Enriching movie {movie.id} ({movie.title}) for {lang}...")

            try:
                # Call enrichment endpoint logic
                from src.routes.enrichment import enrich_movie_examples

                await enrich_movie_examples(
                    EnrichExamplesRequest(
                        movie_id=movie.id,
                        target_lang=lang,
                        batch_size=25,
                        delay_ms=500
                    ),
                    db=db
                )

                print(f"✅ [{current}/{total}] Successfully enriched movie {movie.id} for {lang}")

            except Exception as e:
                print(f"❌ [{current}/{total}] Failed to enrich movie {movie.id} for {lang}: {e}")
                continue

    await db.disconnect()
    print(f"\n🎉 Enrichment complete! {current}/{total} enrichments processed")

if __name__ == "__main__":
    asyncio.run(enrich_all_movies())
```

#### Step 2: Run Batch Enrichment

```bash
cd backend
python scripts/enrich_all_movies.py
```

Expected output:
```
🔄 [1/36] Enriching movie 10 (The Matrix) for ES...
✅ [1/36] Successfully enriched movie 10 for ES
🔄 [2/36] Enriching movie 10 (The Matrix) for FR...
✅ [2/36] Successfully enriched movie 10 for FR
...
🎉 Enrichment complete! 36/36 enrichments processed
```

#### Step 3: Add Auto-Enrichment (Future)

```python
# backend/src/routes/cefr.py - modify classify_script endpoint

from fastapi import BackgroundTasks

@router.post("/classify-script")
async def classify_script(
    request: ScriptClassificationRequest,
    background_tasks: BackgroundTasks,  # Add this
    db: Prisma = Depends(get_db)
):
    # ... existing classification logic ...

    # NEW: After saving classifications, trigger enrichment
    if request.save_to_db:
        # Get user's target language from request or default to ES
        target_lang = getattr(request, 'target_language', 'ES')

        # Check if enrichment already exists
        existing_enrichment = await db.wordsentenceexample.find_first(
            where={
                'movieId': request.movie_id,
                'targetLang': target_lang
            }
        )

        if not existing_enrichment:
            # Enrich in background (doesn't block response)
            background_tasks.add_task(
                trigger_enrichment_background,
                movie_id=request.movie_id,
                target_lang=target_lang,
                db=db
            )
            logger.info(f"🔄 Scheduled background enrichment for movie {request.movie_id}, lang {target_lang}")

    return response


async def trigger_enrichment_background(movie_id: int, target_lang: str, db: Prisma):
    """Background task to enrich movie after classification"""
    try:
        logger.info(f"Starting background enrichment for movie {movie_id}, lang {target_lang}")

        # Import here to avoid circular imports
        from src.routes.enrichment import enrich_movie_examples, EnrichExamplesRequest

        await enrich_movie_examples(
            EnrichExamplesRequest(
                movie_id=movie_id,
                target_lang=target_lang,
                batch_size=25,
                delay_ms=500
            ),
            db=db
        )

        logger.info(f"✅ Background enrichment complete for movie {movie_id}, lang {target_lang}")

    except Exception as e:
        logger.error(f"❌ Background enrichment failed for movie {movie_id}: {e}", exc_info=True)
```

---

## Testing Plan

### 1. Test Batch Enrichment
```bash
# Test on single movie first
python scripts/enrich_all_movies.py --movie-id 14 --languages ES,FR
```

### 2. Verify Data
```sql
-- Check enrichment coverage
SELECT
  m.id,
  m.title,
  COUNT(DISTINCT wse.target_lang) as languages_enriched
FROM movies m
LEFT JOIN word_sentence_examples wse ON m.id = wse.movie_id
GROUP BY m.id, m.title
ORDER BY m.id;
```

### 3. Test Frontend
1. Go to different movies
2. Select ES/FR/DE languages
3. Expand words
4. Verify sentence examples appear

---

## Rollback Plan

If issues occur:

```sql
-- Remove all enrichments for a specific language
DELETE FROM word_sentence_examples WHERE target_lang = 'FR';

-- Remove all enrichments for a specific movie
DELETE FROM word_sentence_examples WHERE movie_id = 14;

-- Remove ALL enrichments (nuclear option)
TRUNCATE word_sentence_examples;
```

---

## Cost Analysis

### Current (1 movie, 1 language)
- Movie: Spirited Away
- Language: Spanish
- Sentences: 300
- Cost: ~$0.15

### Batch Enrichment (12 movies, 3 languages)
- Movies: 12
- Languages: ES, FR, DE
- Total enrichments: 36
- Average sentences per movie: 250
- Total sentences: ~9,000
- **Total cost: $4.50 - $13.50**

### Ongoing Auto-Enrichment
- Per movie per language: $0.10 - $0.30
- Only charged when user selects new language

---

## Monitoring

Add to admin dashboard:

```typescript
// Show enrichment status
interface EnrichmentStats {
  total_movies: number;
  enriched_movies: number;
  total_languages: number;
  total_examples: number;
}

const stats = await fetch('/api/admin/enrichment/stats');
```

---

## Next Steps

**Immediate (Today):**
1. ✅ Review this document
2. 🔄 Decide: Run batch script now or wait?
3. 🔄 Choose languages to enrich

**Short-term (This Week):**
1. Create batch enrichment script
2. Test on 1-2 movies first
3. Run full batch enrichment
4. Verify frontend works for all movies

**Long-term (Future):**
1. Add auto-enrichment after classification
2. Add enrichment status indicator in UI
3. Add admin dashboard for monitoring
4. Consider adding more languages

---

## Questions to Decide

1. **Which languages to enrich?**
   - ES, FR, DE (top 3)?
   - Add more? (IT, PT, RU, ZH, JA?)

2. **When to run batch?**
   - Now (immediate)?
   - Test with 1-2 movies first?

3. **Auto-enrichment timing?**
   - Add now?
   - Wait and see usage first?

4. **Budget allocation?**
   - OK with $5-15 upfront cost?
   - Prefer pay-as-you-go?
