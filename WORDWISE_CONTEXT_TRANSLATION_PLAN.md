# WordWise Context-Aware Translation System — Master Plan

**Author:** Staff Engineer / System Architect
**Status:** DRAFT — Awaiting Approval
**Created:** 2026-03-30
**Last Updated:** 2026-03-30

---

## 1. Executive Summary

### What We Are Building

A **context-aware, cost-optimized translation system** that replaces WordWise's current word-by-word and sentence-by-sentence translation approach with an intelligent pipeline that understands word meanings, deduplicates work across movies, and routes translations through the cheapest viable provider.

### Why the Current System Is Inefficient

The current system has **five structural cost problems**:

1. **No lemma-level translation reuse.** The word "running" in "I am running" and "He was running" produces two separate translation cache entries because caching operates at the full-sentence level, not the word/lemma level.

2. **No cross-movie deduplication.** If "The Matrix" and "Inception" both classify the word "run" (lemma), each movie stores its own `WordClassification` row and triggers its own sentence extraction + translation pipeline independently. Shared vocabulary is re-processed from scratch.

3. **Sentence translations scale linearly with vocabulary size.** With `MAX_EXAMPLES_PER_WORD = 3` and ~3,000–5,000 unique words per movie, a single enrichment run translates 6,000–9,000 sentences. At a 50% cache hit rate, that's 3,000–4,500 DeepL API calls per movie per language.

4. **No word-sense disambiguation.** The word "bank" (river bank vs. financial bank) gets one translation regardless of context. This wastes the opportunity to cache sense-specific translations that are reusable across any movie containing the same sense.

5. **All words translated equally.** A frequency-rank-1 word (appears 200 times in the script) and a frequency-rank-3000 word (appears once) receive identical translation effort. There is no prioritization.

### High-Level Solution

```
┌─────────────────────────────────────────────────────────────────┐
│                    BACKGROUND PIPELINE                          │
│                                                                 │
│  Script Text                                                    │
│      ↓                                                          │
│  [1] Tokenize + Lemmatize (spaCy)                              │
│      ↓                                                          │
│  [2] Deduplicate against Global Lemma Registry                  │
│      ↓  (skip lemmas already fully processed for this lang)     │
│  [3] Extract Sentences → Score → Select top N per lemma         │
│      ↓                                                          │
│  [4] Cluster sentences by meaning → Assign sense_id             │
│      ↓  (lightweight: TF-IDF + cosine, no LLM)                 │
│  [5] Translate ONE representative sentence per sense            │
│      ↓  (Cache → Google → DeepL tiered strategy)               │
│  [6] Store in Translation Memory (lemma + sense + lang → translation)│
│      ↓                                                          │
│  [7] Propagate translations to all sentences in same cluster    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    RUNTIME (REQUEST PATH)                        │
│                                                                 │
│  User clicks word                                               │
│      ↓                                                          │
│  [A] Lookup lemma in Translation Memory                         │
│      ↓  (lemma + target_lang → cached translation)              │
│  [B] If miss: Single API call, cache result                     │
│      ↓                                                          │
│  [C] Return translation + sentence examples (pre-translated)    │
└─────────────────────────────────────────────────────────────────┘
```

**Target: 70–90% reduction in translation API calls.**

---

## 2. Current Architecture Analysis

### Current Data Flow

```
Movie Selected
    ↓
[Script Ingestion] → DB cache → Subtitle API → STANDS4 PDF → STANDS4 API
    ↓
[CEFR Classification] → HybridCEFRClassifier
    ↓  Stores 3,000-5,000 WordClassification rows per movie
    ↓  (deduplicated by lemma+cefrLevel within the movie, NOT across movies)
    ↓
[Enrichment Pipeline] → Background task
    ├── SentenceExampleService.extract_word_sentences()
    │   └── Up to 3 sentences per word × 3,000 words = ~9,000 sentences
    ├── ExampleTranslationService.translate_all_sentences()
    │   └── Batches of 25, 500ms delay, semaphore(2)
    │   └── Each sentence: normalize → check cache → DeepL → Google fallback
    └── save_word_examples() → WordSentenceExample table

[User Request: Translate Word]
    ↓
POST /translate → normalize(text.lower().strip()) → cache check → DeepL → Google
    ↓
Return {translated, provider, cached}
```

### Identified Inefficiencies

| # | Inefficiency | Cost Impact | Root Cause |
|---|-------------|-------------|------------|
| 1 | Sentence-level caching only | High | Cache key = (full_sentence, target_lang). No word-level or lemma-level reuse. |
| 2 | No cross-movie vocabulary sharing | High | Each movie creates its own `WordClassification` rows. Lemma "run" in 50 movies = 50 DB rows. |
| 3 | All sentences translated equally | Medium | No prioritization. Frequency-rank-1 and frequency-rank-5000 words get same treatment. |
| 4 | No sentence deduplication across movies | Medium | Two movies with "I'll be back" = two translation API calls (unless exact text matches cache). |
| 5 | No word-sense awareness | Medium | "bank" always gets same translation regardless of river/money context. |
| 6 | Enrichment translates sentences, not words | Structural | Translating 7,000 sentences costs more than translating 3,000 unique lemmas + propagating. |
| 7 | No tiered provider strategy | Medium | DeepL tried first for all words. Common words (A1/A2) rarely need DeepL quality. |
| 8 | Batch size/delay not optimized | Low | Fixed 25/500ms regardless of cache hit rate. |

### Cost Estimate: Current System (Per Movie, Per Language)

```
Typical movie: 3,500 unique words → ~7,000 sentence examples
Sentence translation: 7,000 sentences
  - Cache hits (first movie for this language): ~500 (7%)
  - API calls: ~6,500
  - DeepL chars (avg 80 chars/sentence × 6,500): ~520,000 chars
  - DeepL cost ($20/1M chars): ~$10.40 per movie per language

For 100 movies × 5 languages = $5,200
```

---

## 3. Target Architecture

### System Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                        INGESTION LAYER                               │
│                                                                      │
│  Script Text ──→ [Tokenizer] ──→ [Lemmatizer (spaCy)] ──→ tokens   │
│                                                                      │
│  tokens ──→ [Global Lemma Registry] ──→ check if lemma exists       │
│              │                           │                           │
│              │ NEW lemma                 │ EXISTING lemma             │
│              ↓                           ↓                           │
│         Create LemmaEntry          Link movie → existing lemma      │
│         (word forms, POS)          (MovieLemmaMapping)               │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────────┐
│                     SENTENCE EXTRACTION LAYER                        │
│                                                                      │
│  For each NEW lemma (or lemma lacking examples for this movie):     │
│                                                                      │
│  Script Text ──→ [Sentence Splitter]                                │
│                      ↓                                               │
│              [Score + Select top 3 per lemma]                        │
│                      ↓                                               │
│              [Deduplicate against SentenceBank]                       │
│                ├── Exact match → reuse existing                      │
│                └── New sentence → add to SentenceBank                │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────────┐
│                    SENSE CLUSTERING LAYER                             │
│                                                                      │
│  For lemmas with 3+ distinct sentences:                              │
│                                                                      │
│  Sentences ──→ [TF-IDF Vectorizer] ──→ [Cosine Similarity Matrix]   │
│                                            ↓                         │
│                                   [Agglomerative Clustering]         │
│                                     (threshold=0.6)                  │
│                                            ↓                         │
│                                   sense_0, sense_1, ...              │
│                                                                      │
│  For lemmas with 1-2 sentences:                                      │
│  → Assign sense_0 (default single sense)                             │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────────┐
│                    TRANSLATION LAYER (Tiered)                        │
│                                                                      │
│  For each (lemma, sense_id, target_lang) needing translation:       │
│                                                                      │
│  ┌─ Tier 0: Translation Memory ─────────────────────────────────┐   │
│  │  Lookup: (lemma, sense_id, target_lang)                      │   │
│  │  Hit → DONE (cost: $0)                                       │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                         ↓ MISS                                       │
│  ┌─ Tier 1: Existing Sentence Cache ────────────────────────────┐   │
│  │  Lookup: (representative_sentence, target_lang) in old cache │   │
│  │  Hit → Store in Translation Memory → DONE (cost: $0)        │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                         ↓ MISS                                       │
│  ┌─ Tier 2: Google Translate ───────────────────────────────────┐   │
│  │  For: A1, A2 words OR words with confidence > 0.8            │   │
│  │  Translate representative sentence (cost: ~free)             │   │
│  │  Store in Translation Memory                                 │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                         ↓ MISS or Low-confidence                     │
│  ┌─ Tier 3: DeepL ─────────────────────────────────────────────┐   │
│  │  For: B2+ words, idioms, ambiguous senses                   │   │
│  │  Translate representative sentence (cost: $$)                │   │
│  │  Store in Translation Memory                                 │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────────┐
│                    PROPAGATION LAYER                                  │
│                                                                      │
│  For each sentence in the same cluster:                              │
│    Copy translation from representative sentence                     │
│    Store in WordSentenceExample (backward-compatible)                │
│                                                                      │
│  Result: All sentences have translations, but only ONE API call      │
│          was made per unique (lemma, sense, language) combination     │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Data Flow Summary

```
FIRST MOVIE:   3,500 lemmas → ~2,500 new → ~3,000 senses → 3,000 translations
SECOND MOVIE:  3,800 lemmas → ~800 new  → ~1,000 senses → 1,000 translations
TENTH MOVIE:   3,200 lemmas → ~200 new  → ~250 senses   → 250 translations
```

**Savings compound exponentially as more movies are processed.**

---

## 4. Data Model Design

### New Tables

#### 4.1 `Lemma` — Global Lemma Registry

Stores every unique lemma ever encountered. One row per lemma across the entire system.

```
┌─────────────────────────────────────────────────────────────────┐
│ Lemma                                                           │
├──────────────┬──────────────┬───────────────────────────────────┤
│ Field        │ Type         │ Notes                             │
├──────────────┼──────────────┼───────────────────────────────────┤
│ id           │ Int (PK)     │ Auto-increment                   │
│ lemma        │ String       │ Unique. Lowercase normalized.    │
│ pos          │ String?      │ Primary part-of-speech (NOUN,    │
│              │              │ VERB, ADJ, etc.)                  │
│ cefrLevel    │ String       │ Canonical CEFR level (A1-C2)     │
│ confidence   │ Float        │ Classification confidence         │
│ source       │ String       │ Classification source            │
│ frequencyRank│ Int?         │ Global frequency rank            │
│ wordForms    │ Json         │ ["run","runs","running","ran"]    │
│ isMultiWord  │ Boolean      │ false for words, true for idioms │
│ createdAt    │ DateTime     │ UTC                              │
│ updatedAt    │ DateTime     │ UTC                              │
├──────────────┴──────────────┴───────────────────────────────────┤
│ @@unique([lemma])                                               │
│ @@index([cefrLevel])                                            │
│ @@index([frequencyRank])                                        │
└─────────────────────────────────────────────────────────────────┘

Example Records:
  { id: 1,  lemma: "run",   pos: "VERB", cefrLevel: "A1", wordForms: ["run","runs","running","ran","runnings"] }
  { id: 2,  lemma: "bank",  pos: "NOUN", cefrLevel: "A2", wordForms: ["bank","banks","banking","banked"] }
  { id: 3,  lemma: "give up", pos: "VERB", cefrLevel: "B1", isMultiWord: true, wordForms: ["give up","gives up","gave up","given up","giving up"] }
```

#### 4.2 `WordSense` — Distinct Meanings Per Lemma

Each lemma can have multiple senses discovered through clustering.

```
┌─────────────────────────────────────────────────────────────────┐
│ WordSense                                                       │
├──────────────────┬──────────────┬───────────────────────────────┤
│ Field            │ Type         │ Notes                         │
├──────────────────┼──────────────┼───────────────────────────────┤
│ id               │ Int (PK)     │ Auto-increment                │
│ lemmaId          │ Int (FK)     │ → Lemma.id                   │
│ senseIndex       │ Int          │ 0, 1, 2... per lemma         │
│ label            │ String?      │ Optional: "financial", "river"│
│ representativeSentence │ String │ Best example sentence         │
│ keywords         │ Json?        │ ["money","account","deposit"] │
│ createdAt        │ DateTime     │ UTC                           │
├──────────────────┴──────────────┴───────────────────────────────┤
│ @@unique([lemmaId, senseIndex])                                 │
│ @@index([lemmaId])                                              │
└─────────────────────────────────────────────────────────────────┘

Example Records:
  { id: 1, lemmaId: 2 (bank), senseIndex: 0, label: "financial", representativeSentence: "I need to go to the bank to deposit money" }
  { id: 2, lemmaId: 2 (bank), senseIndex: 1, label: "river",    representativeSentence: "They sat on the bank of the river" }
  { id: 3, lemmaId: 1 (run),  senseIndex: 0, label: null,       representativeSentence: "She decided to run through the park" }
```

#### 4.3 `TranslationMemory` — Sense-Aware Translation Cache

The core cache: one translation per (lemma, sense, language). This is what eliminates redundant API calls.

```
┌─────────────────────────────────────────────────────────────────┐
│ TranslationMemory                                               │
├──────────────────┬──────────────┬───────────────────────────────┤
│ Field            │ Type         │ Notes                         │
├──────────────────┼──────────────┼───────────────────────────────┤
│ id               │ Int (PK)     │ Auto-increment                │
│ lemmaId          │ Int (FK)     │ → Lemma.id                   │
│ senseId          │ Int (FK)     │ → WordSense.id               │
│ targetLang       │ String(10)   │ "ES", "TR", "DE", etc.       │
│ translatedWord   │ String       │ The word translation          │
│ translatedSentence│ String?     │ Full sentence translation     │
│ provider         │ String       │ "deepl", "google", "cache"   │
│ confidence       │ Float        │ Translation confidence        │
│ createdAt        │ DateTime     │ UTC                           │
│ updatedAt        │ DateTime     │ UTC                           │
├──────────────────┴──────────────┴───────────────────────────────┤
│ @@unique([lemmaId, senseId, targetLang])                        │
│ @@index([lemmaId, targetLang])                                  │
│ @@index([targetLang])                                           │
└─────────────────────────────────────────────────────────────────┘

Example Records:
  { lemmaId: 2 (bank), senseId: 1 (financial), targetLang: "ES", translatedWord: "banco",     translatedSentence: "Necesito ir al banco a depositar dinero", provider: "deepl" }
  { lemmaId: 2 (bank), senseId: 2 (river),     targetLang: "ES", translatedWord: "orilla",    translatedSentence: "Se sentaron en la orilla del río",        provider: "google" }
  { lemmaId: 1 (run),  senseId: 3 (default),   targetLang: "TR", translatedWord: "koşmak",    translatedSentence: "Parkta koşmaya karar verdi",              provider: "deepl" }
```

#### 4.4 `MovieLemmaMapping` — Links Movies to Global Lemmas

Replaces per-movie `WordClassification` duplication. A movie doesn't own a lemma — it references one.

```
┌─────────────────────────────────────────────────────────────────┐
│ MovieLemmaMapping                                               │
├──────────────────┬──────────────┬───────────────────────────────┤
│ Field            │ Type         │ Notes                         │
├──────────────────┼──────────────┼───────────────────────────────┤
│ id               │ Int (PK)     │ Auto-increment                │
│ movieId          │ Int (FK)     │ → Movie.id                   │
│ lemmaId          │ Int (FK)     │ → Lemma.id                   │
│ frequencyInMovie │ Int          │ How often this lemma appears  │
│ dominantSenseId  │ Int? (FK)    │ → WordSense.id (most common  │
│                  │              │   sense in this movie)        │
│ createdAt        │ DateTime     │ UTC                           │
├──────────────────┴──────────────┴───────────────────────────────┤
│ @@unique([movieId, lemmaId])                                    │
│ @@index([movieId])                                              │
│ @@index([lemmaId])                                              │
└─────────────────────────────────────────────────────────────────┘

Example Records:
  { movieId: 1 (The Matrix), lemmaId: 1 (run),  frequencyInMovie: 12, dominantSenseId: 3 }
  { movieId: 1 (The Matrix), lemmaId: 2 (bank), frequencyInMovie: 3,  dominantSenseId: 1 }
  { movieId: 2 (Inception),  lemmaId: 1 (run),  frequencyInMovie: 8,  dominantSenseId: 3 }
```

#### 4.5 `SentenceBank` — Deduplicated Sentence Store

All sentences from all movies, deduplicated. Sentences are linked to lemmas and senses.

```
┌─────────────────────────────────────────────────────────────────┐
│ SentenceBank                                                    │
├──────────────────┬──────────────┬───────────────────────────────┤
│ Field            │ Type         │ Notes                         │
├──────────────────┼──────────────┼───────────────────────────────┤
│ id               │ Int (PK)     │ Auto-increment                │
│ sentenceHash     │ String       │ SHA256 of normalized sentence │
│ sentence         │ String       │ Original sentence text        │
│ lemmaId          │ Int (FK)     │ → Lemma.id (target word)     │
│ senseId          │ Int? (FK)    │ → WordSense.id               │
│ movieId          │ Int (FK)     │ → Movie.id (source movie)    │
│ wordPosition     │ Int?         │ Position of target word       │
│ score            │ Float        │ Quality score from extraction │
│ isRepresentative │ Boolean      │ Is this the cluster rep?      │
│ createdAt        │ DateTime     │ UTC                           │
├──────────────────┴──────────────┴───────────────────────────────┤
│ @@unique([sentenceHash, lemmaId])                               │
│ @@index([lemmaId, senseId])                                     │
│ @@index([movieId])                                              │
│ @@index([sentenceHash])                                         │
└─────────────────────────────────────────────────────────────────┘
```

### Relationship Diagram

```
Movie ──1:N──→ MovieLemmaMapping ──N:1──→ Lemma
                                              │
                                         1:N  │
                                              ↓
                                          WordSense
                                              │
                                         1:N  │
                                              ↓
                                      TranslationMemory
                                         (per language)

Movie ──1:N──→ SentenceBank ──N:1──→ Lemma
                     │
                     └──N:1──→ WordSense

(Backward-compatible)
Movie ──1:N──→ WordSentenceExample  (still populated for API compatibility)
Movie ──1:N──→ WordClassification   (still populated for API compatibility)
```

---

## 5. Translation Strategy

### Tiered Provider Decision Matrix

```
┌───────────────────┬──────────────────┬─────────────────────────────────────┐
│ Condition         │ Provider         │ Rationale                           │
├───────────────────┼──────────────────┼─────────────────────────────────────┤
│ TranslationMemory │ Cache (Tier 0)   │ Already translated for this sense  │
│ hit               │                  │ + language. Cost: $0                │
├───────────────────┼──────────────────┼─────────────────────────────────────┤
│ Old sentence      │ Migration (T1)   │ Existing TranslationCache entry    │
│ cache hit         │                  │ from legacy system. Cost: $0       │
├───────────────────┼──────────────────┼─────────────────────────────────────┤
│ CEFR A1/A2 word   │ Google (Tier 2)  │ Simple words. Google quality is    │
│                   │                  │ sufficient. Cost: ~free             │
├───────────────────┼──────────────────┼─────────────────────────────────────┤
│ CEFR B1 word,     │ Google (Tier 2)  │ Common words with high confidence. │
│ confidence > 0.8  │                  │ Cost: ~free                         │
├───────────────────┼──────────────────┼─────────────────────────────────────┤
│ CEFR B1 word,     │ DeepL (Tier 3)   │ Ambiguous or low-confidence. Need  │
│ confidence < 0.8  │                  │ quality. Cost: $$                   │
├───────────────────┼──────────────────┼─────────────────────────────────────┤
│ CEFR B2+ word     │ DeepL (Tier 3)   │ Advanced vocabulary. Nuance        │
│                   │                  │ matters. Cost: $$                   │
├───────────────────┼──────────────────┼─────────────────────────────────────┤
│ Multi-word /      │ DeepL (Tier 3)   │ Idioms/phrasal verbs need context- │
│ Idiom             │                  │ aware translation. Cost: $$         │
├───────────────────┼──────────────────┼─────────────────────────────────────┤
│ DeepL unavailable │ Google (fallback)│ Rate limit or unsupported language. │
│ or quota exceeded │                  │ Cost: ~free                         │
└───────────────────┴──────────────────┴─────────────────────────────────────┘
```

### Translation Input Strategy

Instead of translating isolated words, we translate the **representative sentence** for each sense. This gives the translation provider context to disambiguate.

```
BAD  (current): translate("bank")        → "banco" (always financial)
GOOD (new):     translate("They sat on the bank of the river") → extract "orilla"
```

The translated sentence is stored. The word-level translation is extracted by comparing source and target.

### Batch Optimization

```
Current:  7,000 sentences × 1 API call each = 7,000 calls
Proposed: 3,000 lemmas → ~3,500 senses → ~1,000 new senses (after cross-movie reuse)
          → batch into groups of 50 sentences per API call
          = ~20 batch API calls
```

---

## 6. NLP Pipeline Design

### 6.1 Lemmatization

**Tool:** spaCy (`en_core_web_sm`) — already a Python dependency in many NLP stacks.

```python
import spacy
nlp = spacy.load("en_core_web_sm")

def lemmatize_tokens(text: str) -> List[Dict]:
    doc = nlp(text)
    return [
        {"word": token.text, "lemma": token.lemma_.lower(), "pos": token.pos_}
        for token in doc
        if not token.is_punct and not token.is_space
    ]
```

**Why spaCy over NLTK:**
- Faster (C-based)
- Better lemmatization (context-aware, not just stemming)
- POS tagging included (needed for sense clustering)
- `en_core_web_sm` is only 12MB

**Integration with existing classifier:**
The existing `HybridCEFRClassifier` already does some lemmatization internally. We will:
1. Use spaCy as the canonical lemmatizer
2. Store lemma results in the `Lemma` table
3. The CEFR classifier continues to work as-is but reads from `Lemma` table when available

### 6.2 Sentence Deduplication

**Strategy:** Exact-match + near-match deduplication.

```
Step 1: Normalize sentence (lowercase, strip punctuation, collapse whitespace)
Step 2: Compute SHA256 hash
Step 3: Check SentenceBank for hash match
  - Exact match → reuse existing entry
  - No match → insert new entry
```

Near-match deduplication (optional, Phase 5 optimization):
```
"I need to go to the bank." vs "I need to go to the bank!"
→ Same after normalization → single entry
```

### 6.3 Sense Clustering

**Approach:** Lightweight, no LLM, runs in background.

```python
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.cluster import AgglomerativeClustering
from sklearn.metrics.pairwise import cosine_similarity

def cluster_senses(sentences: List[str], threshold: float = 0.4) -> List[int]:
    """
    Cluster sentences containing the same lemma into distinct senses.
    Returns cluster labels (0, 1, 2, ...) for each sentence.
    """
    if len(sentences) <= 2:
        return [0] * len(sentences)  # Single sense for 1-2 sentences

    vectorizer = TfidfVectorizer(stop_words='english', max_features=1000)
    tfidf_matrix = vectorizer.fit_transform(sentences)

    clustering = AgglomerativeClustering(
        n_clusters=None,
        distance_threshold=threshold,
        metric='cosine',
        linkage='average'
    )

    labels = clustering.fit_predict(tfidf_matrix.toarray())
    return labels.tolist()
```

**Why this approach:**
- TF-IDF is fast (no model loading, no GPU)
- Agglomerative clustering auto-determines number of clusters
- Threshold 0.4 balances splitting (too many senses) vs lumping (too few)
- Runs in <100ms for 50 sentences

**When to cluster:**
- Only for lemmas with 3+ collected sentences (across all movies)
- 1-2 sentences → automatic single sense (sense_0)
- Re-cluster when new sentences added (batch, not per-sentence)

### 6.4 Sense Labeling

Labels are optional and human-readable. Generated from top TF-IDF keywords in each cluster.

```python
def label_sense(sentences: List[str], n_keywords: int = 3) -> str:
    vectorizer = TfidfVectorizer(stop_words='english', max_features=100)
    tfidf = vectorizer.fit_transform(sentences)
    feature_names = vectorizer.get_feature_names_out()
    avg_tfidf = tfidf.mean(axis=0).A1
    top_indices = avg_tfidf.argsort()[-n_keywords:][::-1]
    return ", ".join(feature_names[i] for i in top_indices)
```

Example: Sentences about "bank" with money context → label: "money, account, deposit"

---

## 7. Enrichment Pipeline (Step-by-Step)

### New Pipeline: `EnrichmentPipelineV2`

```
Input: movie_id, target_lang

Step 1: SCRIPT RETRIEVAL
  └── Fetch MovieScript.cleanedScriptText from DB

Step 2: LEMMATIZATION
  └── spaCy: text → [(word, lemma, pos), ...]
  └── Deduplicate lemmas
  └── Upsert into Lemma table (skip existing)
  └── Create MovieLemmaMapping entries

Step 3: CEFR CLASSIFICATION (existing, unchanged)
  └── Run HybridCEFRClassifier on new lemmas only
  └── Update Lemma.cefrLevel, confidence, source
  └── Store WordClassification for backward compatibility

Step 4: SENTENCE EXTRACTION
  └── Split script into sentences
  └── For each lemma in movie: score & select top 3 sentences
  └── Hash and deduplicate against SentenceBank
  └── Insert new sentences into SentenceBank

Step 5: SENSE CLUSTERING (for lemmas with 3+ sentences globally)
  └── Fetch all sentences for lemma from SentenceBank
  └── TF-IDF + Agglomerative clustering
  └── Create/update WordSense entries
  └── Assign senseId to each SentenceBank entry
  └── Select representative sentence per sense (highest score)

Step 6: TRANSLATION (only for uncached senses)
  └── For each (lemma, sense, target_lang) WITHOUT TranslationMemory entry:
      ├── Determine tier (A1/A2 → Google, B2+ → DeepL)
      ├── Translate representative sentence
      ├── Extract word translation from sentence translation
      └── Store in TranslationMemory

Step 7: PROPAGATION (backward compatibility)
  └── For each sentence in SentenceBank for this movie:
      ├── Look up TranslationMemory for (lemma, sense, target_lang)
      └── Write to WordSentenceExample table (existing format)

Step 8: STATUS UPDATE
  └── Mark enrichment as complete for (movie_id, target_lang)
```

### Pipeline Characteristics

| Property | Value |
|----------|-------|
| Idempotent | Yes — re-running skips already-processed lemmas/senses |
| Resumable | Yes — each step checks what's already done |
| Async | Yes — runs as background task |
| Incremental | Yes — new movie only processes NEW lemmas |

---

## 8. API Changes

### New Endpoints

```
POST /api/v2/enrichment/movies/{movie_id}/start
  Body: { target_lang: "ES" }
  Response: { status: "started", estimated_new_lemmas: 250 }

  Triggers EnrichmentPipelineV2 as background task.
  Returns immediately.

GET /api/v2/enrichment/movies/{movie_id}/status
  Response: {
    status: "enriching" | "ready" | "not_started",
    progress: { lemmas_processed: 2800, lemmas_total: 3000, senses_translated: 150 }
  }

GET /api/v2/translation-memory/word/{word}
  Params: target_lang=ES
  Response: {
    lemma: "run",
    senses: [
      { sense_id: 0, label: "movement", translation: "correr", example: "She decided to run...", example_translation: "Ella decidió correr..." },
      { sense_id: 1, label: "manage", translation: "dirigir", example: "He runs the company...", example_translation: "Él dirige la empresa..." }
    ]
  }
```

### Modified Endpoints

```
POST /translate (MODIFIED — add Translation Memory lookup)
  Before: normalize → cache → DeepL → Google
  After:  normalize → lemmatize → TranslationMemory → old cache → DeepL → Google

  Added field in response: { ..., "sense_id": 0, "lemma": "run" }

GET /api/enrichment/movies/{movie_id}/examples (UNCHANGED)
  Still reads from WordSentenceExample (backward-compatible).
  The V2 pipeline writes to this table in Step 7.

GET /api/enrichment/movies/{movie_id}/examples/{word} (UNCHANGED)
  Still works. Data source is same WordSentenceExample table.
```

### Deprecation Plan

```
Phase 1-3: Both old and new endpoints active. Old writes to both old + new tables.
Phase 4:   New endpoints primary. Old endpoints still work (read from new tables).
Phase 5:   Old endpoints marked deprecated in docs. Still functional.
```

---

## 9. Performance Strategy

### What Is Precomputed (Background)

| Component | When | Duration |
|-----------|------|----------|
| Lemmatization | Movie ingestion | ~2s per movie |
| CEFR classification | Movie ingestion | ~5s per movie (or instant from cache) |
| Sentence extraction | Enrichment start | ~3s per movie |
| Sense clustering | Enrichment start | ~1s per 100 lemmas |
| Translation | Enrichment start | Variable (depends on cache hit rate) |

### What Is On-Demand (Request Path)

| Component | Latency | Fallback |
|-----------|---------|----------|
| Translation Memory lookup | <5ms (DB index) | Old TranslationCache |
| Word translation (cache miss) | 200-500ms (single API call) | Google if DeepL fails |
| Sentence examples | <10ms (DB query) | Empty list |

### Runtime Path: Zero NLP

The request path **never** runs spaCy, TF-IDF, or clustering. All intelligence is precomputed. The runtime is pure DB lookups.

```
User clicks "running"
  → Lemmatize: "running" → "run" (in-memory LRU cache, <1ms)
  → DB lookup: TranslationMemory WHERE lemma="run" AND targetLang="ES"
  → Return: { translation: "correr", sense: "movement", examples: [...] }
  → Total: <15ms
```

---

## 10. Cost Optimization Strategy

### Quantified Savings

#### Scenario: 100 Movies, 5 Languages (ES, TR, DE, FR, PT)

**Current System:**
```
Per movie: ~6,500 API calls (sentence translations)
100 movies × 5 languages = 500 enrichment runs
Total API calls: 500 × 6,500 = 3,250,000
DeepL chars (avg 80/sentence): 260,000,000 chars
Cost at $20/1M chars: $5,200
```

**New System:**
```
Movie 1:  3,500 lemmas → 3,500 new → ~4,000 senses → 4,000 translations
Movie 2:  3,200 lemmas → 800 new   → ~900 senses   → 900 translations
Movie 10: 3,000 lemmas → 200 new   → ~250 senses   → 250 translations
Movie 50: 3,400 lemmas → 50 new    → ~60 senses    → 60 translations
Movie 100:3,100 lemmas → 20 new    → ~25 senses    → 25 translations

Total new translations across 100 movies: ~15,000 (vs 3,250,000)
DeepL chars (only B2+ words, ~40%): 6,000 × 80 = 480,000 chars
Google chars (A1-B1 words, ~60%):   9,000 × 80 = 720,000 chars (free tier)
Cost at $20/1M chars: $9.60

Savings per language: 99.8%
Total for 5 languages: ~$48 (vs $5,200)
```

**But even conservatively (assuming less overlap):**
```
30% cross-movie lemma reuse (not 95%): ~175,000 translations
50% routed to Google (free): 87,500 DeepL calls
DeepL chars: 87,500 × 80 = 7,000,000
Cost: $140 (vs $5,200)

Conservative savings: 97.3%
```

### Where Each Saving Comes From

| Optimization | Reduction | Mechanism |
|-------------|-----------|-----------|
| Lemma-level caching | 60-70% | "running"/"ran"/"runs" → one "run" translation |
| Cross-movie reuse | 20-50% | Shared vocabulary only translated once |
| Sense-aware caching | 5-10% | Same sense reused, different senses distinguished |
| Tiered providers | 30-40% of remaining | A1/A2 words → Google (free) instead of DeepL |
| Sentence → word translation | 80% | Translate 3,500 lemmas instead of 7,000 sentences |
| Priority-based (lazy) | 10-20% | Only translate top-frequency words upfront |

---

## 11. Migration Plan

### Phase 0: Preparation (No User Impact)

1. Add new Prisma models (Lemma, WordSense, TranslationMemory, MovieLemmaMapping, SentenceBank)
2. Run `prisma migrate`
3. Deploy schema changes
4. **No code changes to existing endpoints**

### Phase 1: Lemmatization (Backward-Compatible)

1. Install spaCy + `en_core_web_sm`
2. Add `LemmatizationService`
3. Hook into existing classification pipeline: after CEFR classification, also populate Lemma table
4. **Existing WordClassification table still populated** — dual-write
5. **No API changes**

### Phase 2: Sentence Deduplication (Backward-Compatible)

1. Add `SentenceBankService`
2. Hook into existing enrichment pipeline: after sentence extraction, also populate SentenceBank
3. **WordSentenceExample still populated** — dual-write
4. **No API changes**

### Phase 3: Sense Clustering (Backward-Compatible)

1. Add `SenseClusteringService`
2. Run clustering as final step of enrichment
3. Populate WordSense table
4. **No API changes** — senses are internal optimization

### Phase 4: Translation Memory (New Primary Path)

1. Add `TranslationMemoryService`
2. Modify enrichment pipeline to use TranslationMemory instead of per-sentence translation
3. Modify `POST /translate` to check TranslationMemory first
4. **Old TranslationCache still works as fallback**
5. Add V2 API endpoints

### Phase 5: Optimization + Cleanup

1. Backfill: Run lemmatization + sense clustering on all existing movies
2. Migrate existing TranslationCache entries into TranslationMemory where possible
3. Add monitoring: cache hit rates, API call counts, cost tracking
4. Performance tune: batch sizes, clustering thresholds

### Data Migration Script

```python
async def migrate_existing_data():
    """
    Backfill Lemma table from existing WordClassification entries.
    Run ONCE after Phase 1 deployment.
    """
    # 1. Get all unique (lemma, cefrLevel) from WordClassification
    classifications = await db.wordclassification.group_by(
        by=['lemma', 'cefrLevel', 'pos', 'confidence', 'source', 'frequencyRank']
    )

    # 2. For each unique lemma, create Lemma entry (highest confidence wins)
    for cls in classifications:
        await db.lemma.upsert(
            where={'lemma': cls.lemma},
            create={...},
            update={...}  # Only update if new confidence is higher
        )

    # 3. Create MovieLemmaMapping from existing WordClassification
    # 4. Backfill SentenceBank from existing WordSentenceExample
```

---

## 12. Risks & Tradeoffs

### Risk Matrix

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| spaCy lemmatization differs from existing classifier | Medium | Low | Use spaCy as canonical; existing classifier results preserved in WordClassification for backward compat |
| Sense clustering produces too many/few senses | Medium | Medium | Tunable threshold (0.4 default). Monitor and adjust. Single-sense fallback for sparse data. |
| Migration corrupts existing data | Low | High | Dual-write strategy. New tables only — never modify existing tables until proven. Old endpoints always work. |
| spaCy model size adds to deployment | Low | Low | `en_core_web_sm` is 12MB. Negligible. |
| scikit-learn dependency | Low | Low | Already common in Python ML projects. Small footprint. |
| Background pipeline takes too long | Medium | Medium | Incremental processing. Only new lemmas processed. Progress tracking. |

### Tradeoffs

| Decision | Trade | Rationale |
|----------|-------|-----------|
| TF-IDF over embeddings | Lower accuracy, much faster | Embeddings (sentence-transformers) would be 400MB+ and require GPU. TF-IDF runs in <100ms on CPU. Accuracy is sufficient for sense clustering. |
| Agglomerative over K-means | Slower for large N, auto-determines K | We cluster per-lemma (max ~50 sentences), so N is small. Auto-K is critical since we don't know how many senses a word has. |
| Google for A1/A2 | Slightly lower quality | A1/A2 words ("run", "eat", "big") have unambiguous translations. Google quality is identical to DeepL for these. Saves significant cost. |
| Dual-write migration | Temporary storage overhead | Worth it for zero-downtime migration. Old tables can be cleaned up in Phase 5. |
| No LLM in pipeline | No natural-language sense labels | Labels are keyword-based (TF-IDF top terms). Adequate for internal use. Could add LLM-generated labels as Phase 6 if needed. |

---

## 13. Implementation Phases

### Phase 1: Lemmatization Layer
**Estimated effort:** 2-3 days
**Dependencies:** spaCy installation
**Deliverables:**
- [ ] Install spaCy + en_core_web_sm
- [ ] Prisma schema: add `Lemma` and `MovieLemmaMapping` models
- [ ] `LemmatizationService` class
- [ ] Integration with classification pipeline (dual-write)
- [ ] Migration script: backfill from existing WordClassification
- [ ] Tests

### Phase 2: Sentence Deduplication
**Estimated effort:** 1-2 days
**Dependencies:** Phase 1
**Deliverables:**
- [ ] Prisma schema: add `SentenceBank` model
- [ ] `SentenceBankService` class (hash, deduplicate, store)
- [ ] Integration with enrichment pipeline (dual-write)
- [ ] Tests

### Phase 3: Sense Clustering
**Estimated effort:** 2-3 days
**Dependencies:** Phase 2
**Deliverables:**
- [ ] Prisma schema: add `WordSense` model
- [ ] `SenseClusteringService` class (TF-IDF + agglomerative)
- [ ] Sense labeling (keyword extraction)
- [ ] Representative sentence selection
- [ ] Integration with enrichment pipeline
- [ ] Tests

### Phase 4: Translation Memory
**Estimated effort:** 3-4 days
**Dependencies:** Phase 3
**Deliverables:**
- [ ] Prisma schema: add `TranslationMemory` model
- [ ] `TranslationMemoryService` class
- [ ] Tiered provider logic (Cache → Google → DeepL)
- [ ] Modify enrichment pipeline to use Translation Memory
- [ ] Modify `POST /translate` to check Translation Memory first
- [ ] V2 API endpoints
- [ ] Backward-compatible WordSentenceExample population
- [ ] Tests

### Phase 5: Optimization & Cleanup
**Estimated effort:** 2-3 days
**Dependencies:** Phase 4
**Deliverables:**
- [ ] Backfill script: process all existing movies through new pipeline
- [ ] Migrate TranslationCache → TranslationMemory where possible
- [ ] Cost monitoring dashboard data
- [ ] Performance benchmarks
- [ ] Documentation update

---

## Appendix A: Dependency List

```
New Python packages:
  - spacy >= 3.5.0
  - en_core_web_sm (spacy model, 12MB)
  - scikit-learn >= 1.2.0 (for TF-IDF + AgglomerativeClustering)

Already available:
  - prisma (database)
  - fastapi (API)
  - deepl (translation)
  - googletrans or equivalent (translation fallback)
```

## Appendix B: Example End-to-End Flow

```
MOVIE: "The Dark Knight" (first movie processed for Spanish)

1. Script: 35,000 words
2. Lemmatization: 3,800 unique lemmas
3. Lemma Registry: All 3,800 are new → create 3,800 Lemma entries
4. CEFR Classification: A1(400) A2(800) B1(1200) B2(900) C1+(500)
5. Sentence Extraction: 3,800 × 3 = ~8,500 sentences (after dedup: ~6,000 unique)
6. Sense Clustering:
   - 2,500 lemmas with 1-2 sentences → sense_0 each = 2,500 senses
   - 1,300 lemmas with 3+ sentences → clustering → ~1,800 senses
   - Total: ~4,300 senses
7. Translation (all new):
   - A1/A2 (1,200 senses) → Google: 1,200 calls (~free)
   - B1 high-confidence (800 senses) → Google: 800 calls (~free)
   - B1 low-confidence (400 senses) → DeepL: 400 calls
   - B2+ (1,900 senses) → DeepL: 1,900 calls
   - Total DeepL: 2,300 calls (vs current 6,500)
   - Total Google: 2,000 calls (~free)
   - Savings: 65% fewer DeepL calls on FIRST movie
8. Store in TranslationMemory: 4,300 entries
9. Propagate to WordSentenceExample: 6,000 entries (backward-compatible)

MOVIE: "Inception" (second movie, same language)
1. Script: 28,000 words
2. Lemmatization: 3,200 unique lemmas
3. Lemma Registry: 2,400 already exist → only 800 new
4. Sentence Extraction: Only for 800 new lemmas → ~2,000 sentences
5. Sense Clustering: 800 lemmas → ~1,000 new senses
6. Translation:
   - 600 senses → Google (~free)
   - 400 senses → DeepL
   - Total DeepL: 400 (vs current 6,500)
   - Savings: 94% fewer DeepL calls
7. Store 1,000 new TranslationMemory entries
8. Propagate: All 3,200 lemmas get examples (using existing + new translations)
```

---

*End of Master Plan. Awaiting review and approval before implementation begins.*
