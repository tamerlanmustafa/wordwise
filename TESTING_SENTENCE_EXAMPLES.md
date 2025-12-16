# Testing Sentence Examples Feature

## Step 1: Apply Database Migration

```bash
cd backend
prisma generate
prisma db push
```

This creates the `word_sentence_examples` table.

## Step 2: Start Backend

```bash
cd backend
uvicorn src.main:app --reload --port 8000
```

## Step 3: Test with Existing Movie

### Option A: Using Swagger UI (Easiest)

1. Open browser: http://localhost:8000/docs
2. Navigate to **"Enrichment"** section
3. Test the endpoints:

#### **POST /api/enrichment/examples**
Click "Try it out", use this request body:
```json
{
  "movie_id": 1,
  "target_lang": "ES",
  "batch_size": 25,
  "delay_ms": 500
}
```

**Note:** Replace `movie_id: 1` with an actual movie ID from your database that has:
- CEFR classifications (run `/api/cefr/classify-script` first if needed)
- A script with cleaned text

Expected response (takes 30-60 seconds):
```json
{
  "movie_id": 1,
  "target_lang": "ES",
  "status": "success",
  "sentences_extracted": 450,
  "words_processed": 150,
  "examples_saved": 450,
  "translation_stats": {
    "total_sentences": 200,
    "cache_hits": 0,
    "api_calls": 200,
    "cache_hit_rate": 0.0
  }
}
```

#### **GET /api/enrichment/movies/{movie_id}/examples?lang=ES**
After enrichment completes, fetch the examples:
- Set `movie_id` to the same movie ID
- Set `lang` to `ES`
- Click "Execute"

Expected response (instant):
```json
{
  "movie_id": 1,
  "target_lang": "ES",
  "words": [
    {
      "word": "hello",
      "lemma": "hello",
      "cefr_level": "A1",
      "examples": [
        {
          "sentence": "Hello, how are you today?",
          "translation": "Hola, ¿cómo estás hoy?",
          "word_position": 0
        }
      ]
    }
  ],
  "total_words": 150
}
```

#### **GET /api/enrichment/movies/{movie_id}/examples/{word}?lang=ES**
Fetch examples for a specific word:
- Set `movie_id` to your movie ID
- Set `word` to any word (e.g., "hello")
- Set `lang` to `ES`

### Option B: Using curl

```bash
# 1. Enrich a movie
curl -X POST "http://localhost:8000/api/enrichment/examples" \
  -H "Content-Type: application/json" \
  -d '{
    "movie_id": 1,
    "target_lang": "ES",
    "batch_size": 25,
    "delay_ms": 500
  }'

# 2. Fetch all examples
curl "http://localhost:8000/api/enrichment/movies/1/examples?lang=ES"

# 3. Fetch examples for specific word
curl "http://localhost:8000/api/enrichment/movies/1/examples/hello?lang=ES"
```

## Step 4: Check Database

```bash
# Connect to PostgreSQL
psql -U wordwise_user -d wordwise_db

# Check how many examples were saved
SELECT COUNT(*) FROM word_sentence_examples;

# View some examples
SELECT word, sentence, translation, target_lang
FROM word_sentence_examples
LIMIT 5;

# Check examples for specific word
SELECT sentence, translation
FROM word_sentence_examples
WHERE movie_id = 1 AND word = 'hello' AND target_lang = 'ES';
```

## Step 5: Watch Backend Logs

The backend logs will show detailed progress:

```
INFO - Starting enrichment for movie 1, lang ES
INFO - Found 150 vocabulary words
INFO - Extracting sentences for 150 vocabulary words
INFO - Split script into 1,234 sentences
INFO - Extracted examples for 148 words
INFO - Translating 200 unique sentences to ES in batches of 25
INFO - Processing batch 1/8 (25 sentences)
INFO - Sleeping 0.5s before next batch
INFO - Processing batch 2/8 (25 sentences)
...
INFO - Translation complete: 120 cached, 80 API calls
INFO - Saving 145 word examples to database
INFO - Deleted 0 existing rows
INFO - Inserting 435 new examples
INFO - Successfully saved 435 word examples
INFO - ✓ Enrichment complete for movie 1
```

## Common Issues

### "Movie has no vocabulary classifications"
**Solution:** Run CEFR classification first:
```bash
POST /api/cefr/classify-script
{
  "movie_id": 1,
  "save_to_db": true
}
```

### "Script has no cleaned text"
**Solution:** The movie needs a script. Fetch one first:
```bash
POST /api/scripts/fetch
{
  "movie_title": "The Matrix",
  "force_refresh": false
}
```

### Translation errors
**Solution:** Check your DeepL/Google Translate API keys in `.env`:
```
DEEPL_API_KEY=your-key-here
GOOGLE_TRANSLATE_CREDENTIALS=path/to/credentials.json
```

## Testing Different Languages

Try multiple languages:
```bash
# Spanish
POST /api/enrichment/examples {"movie_id": 1, "target_lang": "ES"}

# Russian
POST /api/enrichment/examples {"movie_id": 1, "target_lang": "RU"}

# German
POST /api/enrichment/examples {"movie_id": 1, "target_lang": "DE"}

# French
POST /api/enrichment/examples {"movie_id": 1, "target_lang": "FR"}
```

## Performance Testing

Time the enrichment:
```bash
time curl -X POST "http://localhost:8000/api/enrichment/examples" \
  -H "Content-Type: application/json" \
  -d '{"movie_id": 1, "target_lang": "ES"}'
```

Expected: 30-60 seconds for typical movie.

## Next Steps: Frontend Integration

To use this in the frontend, you'd add a call to fetch examples:

```typescript
// In your component
const fetchWordExamples = async (movieId: number, word: string, lang: string) => {
  const response = await fetch(
    `http://localhost:8000/api/enrichment/movies/${movieId}/examples/${word}?lang=${lang}`
  );
  const data = await response.json();
  return data.examples; // Array of {sentence, translation, word_position}
};

// Display in WordRow or tooltip
const examples = await fetchWordExamples(123, "hello", "ES");
examples.forEach(ex => {
  console.log(ex.sentence); // "Hello, how are you?"
  console.log(ex.translation); // "Hola, ¿cómo estás?"
});
```

## Idempotency Test

Run enrichment twice for the same movie:
```bash
# First run - should do translations
POST /api/enrichment/examples {"movie_id": 1, "target_lang": "ES"}

# Second run - should have 100% cache hit rate
POST /api/enrichment/examples {"movie_id": 1, "target_lang": "ES"}
```

The second run should show `"cache_hit_rate": 1.0` in the response.
