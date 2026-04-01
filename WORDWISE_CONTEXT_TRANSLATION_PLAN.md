# WordWise Context-Aware Translation System — Master Plan

**Author:** Staff Engineer / System Architect
**Status:** REVISED v3 — Post Second Review
**Created:** 2026-03-30
**Last Updated:** 2026-03-31

### Revision Log

| Date | Version | Changes |
|------|---------|---------|
| 2026-03-30 | v1 | Initial draft |
| 2026-03-31 | v2 | Major revisions from architecture review: (1) sense reuse with confidence gating, (2) separate word + sentence translation instead of extraction, (3) lazy/priority-based translation with visibility gating, (4) language-agnostic NLP pipeline decoupled from per-language translation, (5) POS-aware senses, (6) quality feedback loop, (7) MiniLM hybrid clustering planned for Phase 5, (8) multi-word expression handling |
| 2026-03-31 | v3 | Second review pass: (1) clustering threshold tightened 0.4→0.6, (2) MiniLM for reuse validation moved to Phase 3 (targeted, not full clustering), (3) prefer shorter representative sentences, (4) hybrid priority score replaces static top-500, (5) runtime sense selection via sentence similarity (critical fix), (6) auto-retranslation on high report rate, (7) consistency fixes throughout |

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
┌──────────────────────────────────────────────────────────────────────┐
│              BACKGROUND PIPELINE (Language-Agnostic)                  │
│              Runs ONCE per movie. No translation here.               │
│                                                                      │
│  Script Text                                                         │
│      ↓                                                               │
│  [1] Tokenize + Lemmatize (spaCy) + POS tagging                    │
│      ↓                                                               │
│  [2] Deduplicate against Global Lemma Registry                       │
│      ↓  (skip lemmas already registered)                             │
│  [3] Extract Sentences → Score → Select top N per lemma              │
│      ↓  (deduplicate against SentenceBank)                           │
│  [4] Cluster sentences by meaning → Assign sense_id                  │
│      ↓  (TF-IDF + cosine; Phase 5 upgrade: +MiniLM hybrid)         │
│      ↓  (reuse existing sense only if similarity > 0.85)            │
│  [5] Compute priorityScore (frequency + CEFR + click rate)          │
│                                                                      │
│  Output: Lemmas, Senses, Sentences — NO translations yet            │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────────┐
│              TRANSLATION PIPELINE (Per Language)                      │
│              Runs per target_lang. Only translates what's needed.    │
│                                                                      │
│  For each EAGER sense (priorityScore>=0.4) without TM entry:         │
│      ↓                                                               │
│  [6a] Translate the WORD (lemma in context sentence)                 │
│       → "Translate 'charge' as used in: 'The suspect faces a        │
│          criminal charge'"                                           │
│  [6b] Translate the representative SENTENCE                          │
│       → Full sentence translation for display                        │
│      ↓  (Cache → Google for A1/A2 → DeepL for B2+)                 │
│  [7] Store BOTH in Translation Memory                                │
│      ↓  (lemma + sense + lang → word translation + sentence)        │
│  [8] Propagate to WordSentenceExample (backward-compatible)          │
│                                                                      │
│  LOW-PRIORITY senses: Skip. Translated on-demand when user clicks.  │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                    RUNTIME (REQUEST PATH)                             │
│                                                                      │
│  User clicks word in sentence                                        │
│      ↓                                                               │
│  [A] Lemmatize (in-memory LRU, <1ms)                                │
│  [B] Select sense (compare clicked sentence vs representatives)      │
│      └── Single sense → skip comparison. Multi-sense → TF-IDF.      │
│  [C] Lookup TranslationMemory (lemma + sense + lang)                │
│      ├── HIT → Return word translation + examples                   │
│      └── MISS → Single API call → cache in TranslationMemory        │
│  [D] Return translation + sentence examples                          │
│      ↓                                                               │
│  [E] Increment usageCount (async, non-blocking)                      │
└──────────────────────────────────────────────────────────────────────┘
```

**Target: 80–95% reduction in translation API calls.**

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
│ priorityScore│ Float        │ Hybrid score (0.0–1.0) combining │
│              │              │ frequency, CEFR difficulty, and  │
│              │              │ click rate. Controls eager vs    │
│              │              │ lazy translation.                │
│ totalMovieCount│ Int        │ How many movies contain this     │
│              │              │ lemma. Updated on each ingestion.│
│ createdAt    │ DateTime     │ UTC                              │
│ updatedAt    │ DateTime     │ UTC                              │
├──────────────┴──────────────┴───────────────────────────────────┤
│ @@unique([lemma])                                               │
│ @@index([cefrLevel])                                            │
│ @@index([frequencyRank])                                        │
│ @@index([priorityScore])                                        │
└─────────────────────────────────────────────────────────────────┘

Example Records:
  { id: 1,  lemma: "run",      pos: "VERB", cefrLevel: "A1", priorityScore: 0.92,  totalMovieCount: 87, wordForms: ["run","runs","running","ran"] }
  { id: 2,  lemma: "bank",     pos: "NOUN", cefrLevel: "A2", priorityScore: 0.78,  totalMovieCount: 34, wordForms: ["bank","banks","banking","banked"] }
  { id: 3,  lemma: "give up",  pos: "VERB", cefrLevel: "B1", priorityScore: 0.65,  totalMovieCount: 22, isMultiWord: true, wordForms: ["give up","gives up","gave up","given up"] }
  { id: 4,  lemma: "jurisprudence", pos: "NOUN", cefrLevel: "C2", priorityScore: 0.08, totalMovieCount: 1, wordForms: ["jurisprudence"] }
```

#### 4.2 `WordSense` — Distinct Meanings Per Lemma

Each lemma can have multiple senses discovered through clustering. Senses are **global** (not per-movie), but new senses are created when incoming sentences don't match existing clusters above the confidence threshold.

**Key design decision (v2):** Senses are reused across movies ONLY when similarity > 0.85. Below that threshold, a new sense is created. This prevents mismatched translations (e.g., "charge" as legal accusation vs. electrical charge).

```
┌─────────────────────────────────────────────────────────────────┐
│ WordSense                                                       │
├──────────────────────────┬──────────────┬───────────────────────┤
│ Field                    │ Type         │ Notes                 │
├──────────────────────────┼──────────────┼───────────────────────┤
│ id                       │ Int (PK)     │ Auto-increment        │
│ lemmaId                  │ Int (FK)     │ → Lemma.id            │
│ senseIndex               │ Int          │ 0, 1, 2... per lemma  │
│ pos                      │ String?      │ POS for this sense    │
│                          │              │ (NOUN vs VERB "run")  │
│ label                    │ String?      │ "financial", "river"  │
│ representativeSentence   │ String       │ Best example sentence │
│ keywords                 │ Json?        │ ["money","deposit"]   │
│ clusterCentroid          │ Json?        │ TF-IDF vector (for    │
│                          │              │ reuse comparison)     │
│ sentenceCount            │ Int          │ # sentences in cluster│
│ createdAt                │ DateTime     │ UTC                   │
│ updatedAt                │ DateTime     │ UTC                   │
├──────────────────────────┴──────────────┴───────────────────────┤
│ @@unique([lemmaId, senseIndex])                                 │
│ @@index([lemmaId])                                              │
│ @@index([lemmaId, pos])                                         │
└─────────────────────────────────────────────────────────────────┘

Example Records:
  { id: 1, lemmaId: 2 (bank), senseIndex: 0, pos: "NOUN", label: "financial",  representativeSentence: "I need to go to the bank to deposit money", sentenceCount: 12 }
  { id: 2, lemmaId: 2 (bank), senseIndex: 1, pos: "NOUN", label: "river",      representativeSentence: "They sat on the bank of the river",          sentenceCount: 3 }
  { id: 3, lemmaId: 1 (run),  senseIndex: 0, pos: "VERB", label: "movement",   representativeSentence: "She decided to run through the park",         sentenceCount: 25 }
  { id: 4, lemmaId: 1 (run),  senseIndex: 1, pos: "VERB", label: "manage",     representativeSentence: "He runs the entire company",                  sentenceCount: 8 }
  { id: 5, lemmaId: 1 (run),  senseIndex: 2, pos: "NOUN", label: "sequence",   representativeSentence: "We had a good run at the box office",         sentenceCount: 4 }
```

**Sense Reuse Algorithm (v2):**
```
When processing a new movie with sentences for lemma "charge":

1. Compute TF-IDF vector for new sentence cluster
2. Compare against existing WordSense.clusterCentroid entries for this lemma
3. If max_similarity > 0.85:
   → Assign to existing sense, increment sentenceCount
4. If max_similarity <= 0.85:
   → Create NEW sense (new senseIndex)
5. If POS differs from existing sense:
   → Always create new sense (NOUN "run" ≠ VERB "run")
```

#### 4.3 `TranslationMemory` — Sense-Aware Translation Cache

The core cache: one translation per (lemma, sense, language). This is what eliminates redundant API calls.

**Key design decision (v2):** Both `translatedWord` and `translatedSentence` are obtained via **separate API calls**, not by extracting one from the other. Word extraction from translated sentences is unreliable across languages (word order changes, morphology, dropped words, phrase expansion like "give up" → "vazgeçmek").

```
┌──────────────────────────────────────────────────────────────────┐
│ TranslationMemory                                                │
├─────────────────────┬──────────────┬─────────────────────────────┤
│ Field               │ Type         │ Notes                       │
├─────────────────────┼──────────────┼─────────────────────────────┤
│ id                  │ Int (PK)     │ Auto-increment              │
│ lemmaId             │ Int (FK)     │ → Lemma.id                 │
│ senseId             │ Int (FK)     │ → WordSense.id             │
│ targetLang          │ String(10)   │ "ES", "TR", "DE", etc.     │
│ translatedWord      │ String       │ Word-level translation      │
│                     │              │ (separate API call)         │
│ translatedSentence  │ String?      │ Full sentence translation   │
│                     │              │ (separate API call)         │
│ wordProvider        │ String       │ Provider for word transl.   │
│ sentenceProvider    │ String?      │ Provider for sentence       │
│ usageCount          │ Int          │ Times served to users       │
│ reportCount         │ Int          │ Times flagged by users      │
│ createdAt           │ DateTime     │ UTC                         │
│ updatedAt           │ DateTime     │ UTC                         │
├─────────────────────┴──────────────┴─────────────────────────────┤
│ @@unique([lemmaId, senseId, targetLang])                         │
│ @@index([lemmaId, targetLang])                                   │
│ @@index([targetLang])                                            │
└──────────────────────────────────────────────────────────────────┘

Example Records:
  { lemmaId: 2 (bank), senseId: 1 (financial), targetLang: "ES", translatedWord: "banco",  translatedSentence: "Necesito ir al banco a depositar dinero", wordProvider: "google", usageCount: 47, reportCount: 0 }
  { lemmaId: 2 (bank), senseId: 2 (river),     targetLang: "ES", translatedWord: "orilla", translatedSentence: "Se sentaron en la orilla del río",        wordProvider: "deepl",  usageCount: 3,  reportCount: 0 }
  { lemmaId: 1 (run),  senseId: 3 (movement),  targetLang: "TR", translatedWord: "koşmak", translatedSentence: "Parkta koşmaya karar verdi",              wordProvider: "deepl",  usageCount: 22, reportCount: 1 }
```

**Word Translation Strategy (v2):**
```
For each (lemma, sense) needing translation:

  Call 1 — WORD translation (with context):
    Input:  "charge" (with context: "The suspect faces a criminal charge")
    Method: translate("charge") with context hint
    Output: "acusación"

  Call 2 — SENTENCE translation:
    Input:  "The suspect faces a criminal charge"
    Method: translate(full_sentence)
    Output: "El sospechoso enfrenta una acusación penal"

  Total: 2 API calls per (lemma, sense, language)
  But senses are deduplicated globally, so this is ~2x the unique sense count.
  Across 100 movies, sense count converges quickly → negligible extra cost.
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
│ @@unique([sentenceHash])            ← v2: globally unique, not  │
│                                       per-lemma. Same sentence  │
│                                       never stored twice.       │
│ @@index([lemmaId, senseId])                                     │
│ @@index([movieId])                                              │
└─────────────────────────────────────────────────────────────────┘

Note: A sentence may contain multiple target lemmas. We store it ONCE
in SentenceBank and create a separate join table for sentence↔lemma links:

┌─────────────────────────────────────────────────────────────────┐
│ SentenceLemmaLink                                               │
├──────────────────┬──────────────┬───────────────────────────────┤
│ id               │ Int (PK)     │ Auto-increment                │
│ sentenceId       │ Int (FK)     │ → SentenceBank.id            │
│ lemmaId          │ Int (FK)     │ → Lemma.id                   │
│ senseId          │ Int? (FK)    │ → WordSense.id               │
│ wordPosition     │ Int?         │ Position of target word       │
│ score            │ Float        │ Quality score for this lemma  │
│ isRepresentative │ Boolean      │ Is rep for this sense?        │
├──────────────────┴──────────────┴───────────────────────────────┤
│ @@unique([sentenceId, lemmaId])                                 │
│ @@index([lemmaId, senseId])                                     │
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

### Translation Input Strategy (v2 — Dual-Call)

We make **two separate translation calls** per sense: one for the word, one for the sentence. Extracting word translations from sentence translations is unreliable across languages.

```
BAD  (v1):  translate("They sat on the bank of the river") → extract "orilla" ← UNRELIABLE
GOOD (v2):  translate("bank", context="They sat on the bank of the river") → "orilla" ← DIRECT
            translate("They sat on the bank of the river") → "Se sentaron en la orilla del río" ← FOR DISPLAY
```

**Why 2 calls is acceptable:**
- Senses are globally deduplicated. After 10 movies, <5% of senses are new.
- 2 calls × 200 new senses = 400 calls (vs current 6,500 per movie).
- Word-only translations are short strings — minimal character cost.

### Lazy Translation (v2 — Visibility Gating)

**NOT all senses are translated eagerly.** Lemmas above a hybrid priority threshold are translated during background enrichment. The rest are translated on-demand when a user clicks the word.

**Hybrid Priority Score (v3):**
```python
def compute_priority_score(lemma, movie_count: int, click_rate: float = 0.0) -> float:
    """
    Hybrid score replaces static top-500 boolean.
    All weights sum to 1.0. Score range: 0.0–1.0.
    """
    # Frequency: normalized rank within current movie (0=rarest, 1=most frequent)
    freq_norm = 1.0 - (lemma.frequencyRank / movie_count) if lemma.frequencyRank else 0.0
    freq_norm = max(0.0, min(1.0, freq_norm))

    # CEFR difficulty: higher difficulty → more value in pre-translating
    cefr_weights = {"A1": 0.1, "A2": 0.3, "B1": 0.5, "B2": 0.7, "C1": 0.9, "C2": 1.0}
    difficulty = cefr_weights.get(lemma.cefrLevel, 0.5)

    # Click rate: historical clicks / impressions (0 until data exists)
    usage = min(1.0, click_rate)

    FREQ_WEIGHT = 0.5
    CEFR_WEIGHT = 0.3
    USAGE_WEIGHT = 0.2

    return FREQ_WEIGHT * freq_norm + CEFR_WEIGHT * difficulty + USAGE_WEIGHT * usage

# Threshold: priorityScore >= 0.4 → EAGER, else LAZY
EAGER_THRESHOLD = 0.4
```

```
EAGER (background):  priorityScore >= 0.4  → translate during enrichment
LAZY  (on-demand):   priorityScore < 0.4   → translate when user clicks, cache result

Typical distribution:
  - Eager: ~600-800 lemmas (covers ~85% of user clicks)
  - Lazy: ~2,200-2,700 lemmas (covers ~15% of user clicks, translated one-at-a-time)

Advantages over static top-500:
  - A rare C2 word that users click frequently gets promoted automatically
  - A common A1 word that nobody clicks gets demoted over time
  - New movies: frequency-only (no click data yet) → CEFR weight kicks in
  - Mature system: click rate corrects for frequency-only blind spots
```

### Batch Optimization

```
Current:  7,000 sentences × 1 API call each = 7,000 calls
Proposed: 500 high-priority senses × 2 calls each = 1,000 calls (background)
          + ~375 lazy senses × 2 calls each = 750 calls (on-demand, spread over time)
          = ~1,750 total (vs 7,000)
          + cross-movie reuse reduces this further over time
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

def cluster_senses(sentences: List[str], threshold: float = 0.6) -> List[int]:
    """
    Cluster sentences containing the same lemma into distinct senses.
    Returns cluster labels (0, 1, 2, ...) for each sentence.

    v3: Threshold tightened from 0.4 to 0.6 to be consistent with
    the reuse threshold (0.85). The gap was too large — loose clusters
    + strict reuse = no reuse OR incorrect grouping.
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

**Why TF-IDF for cluster creation:**
- TF-IDF is fast (no model loading per call, no GPU)
- Agglomerative clustering auto-determines number of clusters
- Threshold 0.6 (v3: tightened from 0.4) balances splitting vs lumping
- Runs in <100ms for 50 sentences
- Known limitation: Weak on short sentences and paraphrases

**MiniLM for Reuse Validation (v3 — moved from Phase 5 to Phase 3):**

TF-IDF creates clusters within a movie. But the critical question is:
*"Should this new cluster reuse an existing sense from another movie?"*
TF-IDF is too weak for this cross-movie comparison. MiniLM is used **only
for the reuse decision**, not for full clustering.

```
Cluster creation:   TF-IDF + Agglomerative (fast, within-movie)
Reuse validation:   MiniLM (targeted, cross-movie comparison only)

MiniLM reuse flow:
  1. TF-IDF creates clusters for new movie's sentences (fast, <100ms)
  2. For each new cluster, compute MiniLM embedding of representative sentence
  3. Compare against existing WordSense representative sentence embeddings
  4. If MiniLM cosine similarity > 0.85 → reuse existing sense
  5. If similarity ≤ 0.85 → create new sense

Why this is cheap:
  - MiniLM (all-MiniLM-L6-v2, ~80MB) loads once, stays in memory
  - Only computes embeddings for representative sentences (1 per cluster)
  - NOT all sentences — just the ~20-50 new cluster reps per movie
  - Inference: <5ms per sentence on CPU

Phase 5 Upgrade (full hybrid):
  - Use MiniLM within clusters too (split/merge refinement)
  - "I ran quickly" vs "She sprinted fast" → same sense (MiniLM catches this)
  - TF-IDF as coarse filter → MiniLM as fine-grained similarity
```

**Representative Sentence Selection (v3):**

The representative sentence for each cluster is used for translation and shown to users. Prefer shorter, clearer sentences:

```python
def select_representative(sentences: List[Dict]) -> Dict:
    """
    Pick the best representative from a sense cluster.
    Prefer: high quality score, shorter length, contains target word clearly.
    """
    # Score = quality_score - length_penalty
    # Shorter sentences translate better and cost fewer API chars
    for s in sentences:
        word_count = len(s["sentence"].split())
        length_penalty = max(0, (word_count - 12) * 0.02)  # Penalize >12 words
        s["rep_score"] = s["score"] - length_penalty

    return max(sentences, key=lambda s: s["rep_score"])
```

Why shorter is better:
- Translation quality degrades with sentence complexity
- Shorter sentences cost fewer API characters
- Users scan examples quickly — concise > verbose
- The representative is translated; other cluster sentences are not (unless user scrolls)

**When to cluster:**
- Only for lemmas with 3+ collected sentences (across all movies)
- 1-2 sentences → automatic single sense (sense_0)
- Re-cluster when new sentences added (batch, not per-sentence)
- POS-aware: NOUN "run" and VERB "run" are always separate senses

### 6.5 Multi-Word Expression Detection

The existing CEFR classifier already detects phrasal verbs and idioms. We hook into this:

```python
# Existing: PHRASAL_VERBS and IDIOMS dicts in cefr_classifier.py
# These are already classified by CEFR level

# New: n-gram detection during lemmatization
def detect_multi_word_expressions(tokens: List[str], doc: spacy.tokens.Doc) -> List[str]:
    """
    Detect phrasal verbs and idioms from the token stream.
    Uses:
    1. spaCy dependency parsing (verb + particle patterns)
    2. Existing PHRASAL_VERBS / IDIOMS lookup dicts
    3. Simple bigram/trigram matching against known phrases
    """
    mwes = []
    # Check existing dictionaries
    for n in [3, 2]:  # trigrams first, then bigrams
        for i in range(len(tokens) - n + 1):
            phrase = " ".join(tokens[i:i+n])
            if phrase in ALL_PHRASAL_VERBS or phrase in ALL_IDIOMS:
                mwes.append(phrase)
    return mwes
```

Multi-word expressions get their own `Lemma` entry with `isMultiWord=true` and are treated as a single unit throughout the pipeline.

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

### New Pipeline: `EnrichmentPipelineV2` (Language-Decoupled)

The pipeline is split into two independent stages:

**Stage A: NLP Pipeline (language-agnostic, runs ONCE per movie)**
**Stage B: Translation Pipeline (runs per target language, only when needed)**

```
═══════════════════════════════════════════════════════════════════
  STAGE A: NLP PIPELINE (Language-Agnostic)
  Trigger: Movie script ingested
  Runs: Once per movie, never repeated
═══════════════════════════════════════════════════════════════════

Input: movie_id

Step A1: SCRIPT RETRIEVAL
  └── Fetch MovieScript.cleanedScriptText from DB

Step A2: LEMMATIZATION + MWE DETECTION
  └── spaCy: text → [(word, lemma, pos), ...]
  └── Detect multi-word expressions (phrasal verbs, idioms)
  └── Deduplicate lemmas
  └── Upsert into Lemma table (skip existing, update totalMovieCount)
  └── Create MovieLemmaMapping entries (with frequencyInMovie)
  └── Compute priorityScore for each lemma (frequency + CEFR + click rate)

Step A3: CEFR CLASSIFICATION (existing, unchanged)
  └── Run HybridCEFRClassifier on new lemmas only
  └── Update Lemma.cefrLevel, confidence, source
  └── Store WordClassification for backward compatibility

Step A4: SENTENCE EXTRACTION
  └── Split script into sentences
  └── For each lemma in movie: score & select top 3 sentences
  └── Hash and deduplicate against SentenceBank
  └── Insert new sentences into SentenceBank
  └── Create SentenceLemmaLink entries

Step A5: SENSE CLUSTERING (for lemmas with 3+ sentences globally)
  └── Fetch all SentenceLemmaLink entries for each lemma
  └── TF-IDF + Agglomerative clustering
  └── Compare new clusters against existing WordSense.clusterCentroid
  │   ├── Similarity > 0.85 → assign to existing sense
  │   └── Similarity ≤ 0.85 or different POS → create new sense
  └── Update SentenceLemmaLink.senseId
  └── Select representative sentence per sense (highest score)

Step A6: STATUS UPDATE
  └── Mark NLP pipeline as complete for movie_id

═══════════════════════════════════════════════════════════════════
  STAGE B: TRANSLATION PIPELINE (Per Language)
  Trigger: User requests language OR background job
  Runs: Once per (movie, target_lang), incremental
═══════════════════════════════════════════════════════════════════

Input: movie_id, target_lang

Step B1: IDENTIFY TRANSLATION GAPS
  └── Get all lemmas for movie (via MovieLemmaMapping)
  └── Filter to EAGER lemmas (priorityScore >= 0.4)
  └── For each (lemma, sense): check TranslationMemory
  └── Collect senses WITHOUT translation for this target_lang

Step B2: TRANSLATE (only gaps, tiered)
  └── For each untranslated (lemma, sense):
      ├── Determine tier:
      │   A1/A2 or confidence > 0.8 → Google (free)
      │   B2+ or idiom             → DeepL (paid)
      ├── Call 1: Translate WORD with context sentence as hint
      ├── Call 2: Translate representative SENTENCE
      └── Store BOTH in TranslationMemory

Step B3: PROPAGATION (backward compatibility)
  └── For each SentenceLemmaLink for this movie:
      ├── Lookup TranslationMemory for (lemma, sense, target_lang)
      └── Write to WordSentenceExample table (existing format)

Step B4: STATUS UPDATE
  └── Mark translation as complete for (movie_id, target_lang)
```

### Pipeline Characteristics

| Property | Value |
|----------|-------|
| Idempotent | Yes — re-running skips already-processed lemmas/senses/translations |
| Resumable | Yes — each step checks what's already done |
| Async | Yes — runs as background task |
| Incremental | Yes — new movie only processes NEW lemmas |
| Language-decoupled | Yes — NLP runs once, translation runs per language |
| Lazy-aware | Yes — only high-priority lemmas translated eagerly |

### Adding a New Language Later

```
Movie already processed (NLP complete):
  Stage A: SKIP entirely (already done)
  Stage B: Run for new language only
    → Only translates senses that don't have this language yet
    → If 90% of senses already translated (from other movies): ~10% new work
```

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

### Runtime Path: Zero NLP (except sense selection)

The request path **never** runs spaCy, TF-IDF, or full clustering. The only intelligence at runtime is **sense selection** — picking the right sense for the sentence the user clicked in.

### Runtime Sense Selection (v3 — Critical)

**Problem:** When a user clicks "charge" in a sentence, which sense do we return? The word may have 3 senses (legal, electrical, military). The `dominantSenseId` in `MovieLemmaMapping` is a fallback but not always correct — a movie about law might use "charge" in both legal and financial contexts.

**Algorithm:**

```python
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

# In-memory cache: sense_id → representative_sentence TF-IDF vector
_sense_vector_cache: Dict[int, sparse_matrix] = {}

def select_sense_at_runtime(
    lemma_id: int,
    clicked_sentence: str,
    senses: List[WordSense]
) -> WordSense:
    """
    Given the sentence the user clicked in, pick the closest sense.

    Fast path: If lemma has only 1 sense → return it immediately.
    Slow path: Compare clicked sentence against sense representatives.
    """
    if len(senses) == 1:
        return senses[0]  # Fast path: single sense, no comparison needed

    # Collect representative sentences + the clicked sentence
    rep_sentences = [s.representativeSentence for s in senses]
    all_sentences = rep_sentences + [clicked_sentence]

    # TF-IDF vectorize all together (ensures same feature space)
    vectorizer = TfidfVectorizer(stop_words='english', max_features=500)
    tfidf_matrix = vectorizer.fit_transform(all_sentences)

    # Compare clicked sentence (last row) against each representative
    clicked_vector = tfidf_matrix[-1]
    rep_vectors = tfidf_matrix[:-1]
    similarities = cosine_similarity(clicked_vector, rep_vectors)[0]

    best_idx = similarities.argmax()
    return senses[best_idx]

# Usage in request handler:
async def handle_word_click(word: str, sentence: str, target_lang: str):
    lemma = lemmatize(word)  # LRU cache, <1ms
    senses = await db.wordsense.find_many(where={"lemmaId": lemma.id})

    # Pick the right sense based on clicked sentence context
    sense = select_sense_at_runtime(lemma.id, sentence, senses)

    # Lookup translation for this specific sense
    tm = await db.translationmemory.find_first(
        where={"lemmaId": lemma.id, "senseId": sense.id, "targetLang": target_lang}
    )
    if tm:
        return tm  # Cache hit
    else:
        return await translate_on_demand(lemma, sense, target_lang)  # Lazy path
```

**Why TF-IDF is sufficient here (not MiniLM):**
- We are comparing against 2-5 representative sentences, not thousands
- The representatives are already semantically distinct (from clustering)
- TF-IDF catches keyword overlap ("bank" + "deposit" vs "bank" + "river") which is the primary signal
- Runs in <5ms for 5 candidates — no model loading overhead
- If accuracy proves insufficient, can upgrade to MiniLM cosine similarity in Phase 5

**Fallback chain:**
1. Single sense → return immediately (most common: ~70% of lemmas)
2. Multi-sense + clicked sentence available → TF-IDF similarity
3. Multi-sense + no sentence context → `dominantSenseId` from MovieLemmaMapping
4. No dominant sense → sense_0 (most common sense)

```
User clicks "running" in "She started running through the park"
  → Lemmatize: "running" → "run" (LRU cache, <1ms)
  → Fetch senses for "run": [movement, manage, sequence]
  → Compare "She started running through the park" against representatives
  → Best match: sense_0 "movement" (similarity 0.82)
  → DB lookup: TranslationMemory WHERE lemma="run" AND sense=movement AND lang="ES"
  → Return: { translation: "correr", sense: "movement", examples: [...] }
  → Total: <20ms
```

### Auto-Retranslation on High Report Rate (v3)

When users report bad translations, the system should self-heal without manual intervention:

```python
REPORT_THRESHOLD = 0.1  # 10% report rate triggers retranslation
MIN_USAGE_FOR_EVAL = 5  # Don't evaluate until at least 5 usages

async def check_and_retranslate(tm: TranslationMemory):
    """
    Called async after each report. If report rate exceeds threshold,
    retranslate with DeepL (highest quality) regardless of original provider.
    """
    if tm.usageCount < MIN_USAGE_FOR_EVAL:
        return  # Not enough data to judge

    report_rate = tm.reportCount / tm.usageCount
    if report_rate <= REPORT_THRESHOLD:
        return  # Within acceptable range

    # Retranslate with DeepL (force, even if original was Google)
    sense = await db.wordsense.find_unique(where={"id": tm.senseId})
    new_word = await deepl_translate(
        sense.lemma, context=sense.representativeSentence, target=tm.targetLang
    )
    new_sentence = await deepl_translate(
        sense.representativeSentence, target=tm.targetLang
    )

    await db.translationmemory.update(
        where={"id": tm.id},
        data={
            "translatedWord": new_word,
            "translatedSentence": new_sentence,
            "wordProvider": "deepl",
            "sentenceProvider": "deepl",
            "reportCount": 0,      # Reset after retranslation
            "usageCount": 0,       # Reset to re-evaluate fresh
        }
    )
```

**Why this is safe:**
- 10% threshold + minimum 5 usages prevents overcorrection from a single report
- Only upgrades to DeepL (never downgrades)
- Resets counters so the new translation gets a fair evaluation
- Runs async — never blocks the user request path
- Worst case: a good Google translation gets replaced by a good DeepL translation (no harm)

---

## 10. Cost Optimization Strategy

### Quantified Savings (v2 — with lazy translation + dual-call)

#### Scenario: 100 Movies, 5 Languages (ES, TR, DE, FR, PT)

**Current System:**
```
Per movie: ~6,500 API calls (sentence translations)
100 movies × 5 languages = 500 enrichment runs
Total API calls: 500 × 6,500 = 3,250,000
DeepL chars (avg 80/sentence): 260,000,000 chars
Cost at $20/1M chars: $5,200
```

**New System (with lazy translation):**
```
Movie 1:  3,500 lemmas → 500 high-priority → ~600 senses → 1,200 API calls (word+sentence)
Movie 2:  3,200 lemmas → 150 NEW high-priority senses → 300 API calls
Movie 10: 3,000 lemmas → 30 NEW high-priority senses → 60 API calls
Movie 50: 3,400 lemmas → 5 NEW high-priority senses → 10 API calls
Movie 100:3,100 lemmas → 2 NEW high-priority senses → 4 API calls

Background (eager) total across 100 movies × 5 langs: ~12,000 API calls
On-demand (lazy) estimate (15% of users click non-priority words): ~3,000 API calls
Grand total: ~15,000 API calls (vs 3,250,000)

DeepL calls (B2+ words, ~40%): 6,000 calls × avg 30 chars = 180,000 chars
Google calls (A1-B1 words, ~60%): 9,000 calls (~free)
DeepL cost at $20/1M chars: $3.60
Total for 5 languages: ~$18 (vs $5,200)
```

**Conservative estimate (30% overlap, not 95%):**
```
Background: ~80,000 API calls (×2 for word+sentence)
On-demand: ~15,000 API calls
Total: ~175,000 (vs 3,250,000)
DeepL portion (40%): 70,000 × 30 chars = 2,100,000 chars
Cost: $42 (vs $5,200)

Conservative savings: 99.2%
```

### Where Each Saving Comes From

| Optimization | Reduction | Mechanism |
|-------------|-----------|-----------|
| Lemma-level caching | 60-70% | "running"/"ran"/"runs" → one "run" translation |
| Cross-movie reuse | 20-50% | Shared vocabulary only translated once |
| Sense-aware caching | 5-10% | Same sense reused, different senses distinguished |
| Tiered providers | 30-40% of remaining | A1/A2 words → Google (free) instead of DeepL |
| Translate words not sentences | 80% | 30-char word vs 80-char sentence = 62% char savings |
| Lazy/priority-based | 70-85% | Only eager lemmas (priorityScore >= 0.4) translated in background |
| Language decoupling | N/A (structural) | NLP runs once; adding Spanish later = translation only |

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
| Sense clustering produces too many/few senses | Medium | Medium | Tunable threshold (0.6 default, v3). MiniLM reuse validation at 0.85. Monitor and adjust. Single-sense fallback for sparse data. |
| Migration corrupts existing data | Low | High | Dual-write strategy. New tables only — never modify existing tables until proven. Old endpoints always work. |
| spaCy model size adds to deployment | Low | Low | `en_core_web_sm` is 12MB. Negligible. |
| scikit-learn dependency | Low | Low | Already common in Python ML projects. Small footprint. |
| Background pipeline takes too long | Medium | Medium | Incremental processing. Only new lemmas processed. Progress tracking. |

### Tradeoffs

| Decision | Trade | Rationale |
|----------|-------|-----------|
| TF-IDF for clustering, MiniLM for reuse (Phase 3) | Two tools for two jobs | TF-IDF runs in <100ms for within-movie clustering. MiniLM used only for cross-movie sense reuse validation (~1 embedding per cluster rep). Full MiniLM hybrid clustering deferred to Phase 5. |
| Dual-call (word + sentence) | 2× API calls per sense | Eliminates brittle word-extraction from translated sentences. Senses are deduplicated globally so 2× a small number is still small. |
| Lazy translation | Some words untranslated until clicked | 85% of user clicks hit eager words (priorityScore >= 0.4). Remaining 15% get on-demand translation (200-500ms, cached forever after). Score adapts with usage data. |
| Sense reuse threshold 0.85 | May create duplicate senses | Better to have a redundant sense than serve a wrong translation. Senses can be merged later in Phase 5. |
| No job queue (Phase 1-4) | No retry/parallelism | FastAPI BackgroundTasks + status table is sufficient at current scale. Add Celery/RQ if processing 1000+ movies. |
| POS-aware senses | More senses than needed | "run" (noun) and "run" (verb) are genuinely different. POS split prevents wrong translations. Minor storage cost. |
| Google for A1/A2 | Slightly lower quality | A1/A2 words ("run", "eat", "big") have unambiguous translations. Google quality is identical to DeepL for these. |
| Dual-write migration | Temporary storage overhead | Worth it for zero-downtime migration. Old tables can be cleaned up in Phase 5. |
| No LLM in pipeline | No natural-language sense labels | Labels are keyword-based (TF-IDF top terms). Could add LLM-generated labels as Phase 6 if needed. |

### Decisions Explicitly Rejected

| Suggestion | Why Rejected | Revisit When |
|------------|-------------|--------------|
| Domain signatures on senses | Over-complex. Global senses + confidence threshold achieves the same goal more simply. | Never — threshold approach is strictly better. |
| Semantic fuzzy matching in Translation Memory | Adds embedding storage + cosine similarity at query time. Exact (lemma, sense, lang) lookup is sufficient because senses are pre-clustered. | Phase 6+ if data shows significant missed reuse. |
| Celery/RQ job queue | Needs Redis/RabbitMQ infrastructure. Overkill for current scale (< 1000 movies). | When processing >1000 movies or need distributed workers. |
| Word extraction from sentence translation | Unreliable: word order, morphology, dropped words, phrase expansion. | Never — dual-call is the correct approach. |

---

## 13. Implementation Phases

### Phase 1: Lemmatization Layer + Schema ✅
**Dependencies:** spaCy installation
**Deliverables:**
- [x] Install spaCy + en_core_web_sm + scikit-learn
- [x] Prisma schema: add ALL new models (Lemma, WordSense, TranslationMemory, MovieLemmaMapping, SentenceBank, SentenceLemmaLink)
- [x] Run migration (`prisma db push` — tables created)
- [x] `LemmatizationService` class (spaCy tokenize + lemmatize + POS + MWE detection) — `backend/src/services/lemmatization_service.py`
- [x] Integration with classification pipeline (dual-write to Lemma + WordClassification) — `backend/src/routes/cefr.py` SLOW PATH
- [x] `priorityScore` computation (hybrid: frequency + CEFR + click rate) — `compute_priority_score()` in lemmatization_service.py
- [x] Migration script: backfill Lemma table from existing WordClassification — `POST /api/cefr/v2/backfill-lemmas`
- [ ] Tests

### Phase 2: Sentence Deduplication ✅
**Dependencies:** Phase 1
**Deliverables:**
- [x] `SentenceBankService` class (hash, deduplicate, store) — `backend/src/services/sentence_bank_service.py`
- [x] `SentenceLemmaLink` creation during sentence extraction — created in `populate_sentence_bank()`
- [x] Integration with enrichment pipeline (dual-write to SentenceBank + WordSentenceExample) — `backend/src/routes/enrichment.py` (both sync + async paths)
- [ ] Tests

### Phase 3: Sense Clustering + MiniLM Reuse Validation ✅
**Dependencies:** Phase 2, MiniLM model (all-MiniLM-L6-v2, ~80MB)
**Deliverables:**
- [x] `SenseClusteringService` class (TF-IDF + agglomerative, threshold 0.6) — `backend/src/services/sense_clustering_service.py`
- [x] POS-aware sense separation (lemmas already POS-tagged from Phase 1, senses grouped per lemma)
- [x] MiniLM integration for cross-movie sense reuse validation (targeted, not full clustering) — `find_reusable_sense()`
- [x] Sense reuse logic (MiniLM cosine similarity > 0.85 → reuse existing sense) — `compute_minilm_similarity()`
- [x] Sense labeling (keyword extraction from TF-IDF top terms) — `label_sense()`
- [x] Representative sentence selection (highest score, prefer shorter sentences, length penalty 0.05/word over 12) — `select_representative()`
- [x] Runtime sense selection: TF-IDF comparison of clicked sentence vs sense representatives — `select_sense_at_runtime()`
- [x] Integration with enrichment pipeline — dual-write in `enrichment.py` (both sync + async paths)
- [ ] Tests

### Phase 4: Translation Memory + Lazy Translation ✅
**Dependencies:** Phase 3
**Deliverables:**
- [x] `TranslationMemoryService` class — `backend/src/services/translation_memory_service.py`
- [x] Dual-call translation (word + sentence, separate API calls) — `translate_sense()` makes 2 calls
- [x] Tiered provider logic (Cache → Google for A1/A2 → DeepL for B2+) — `_select_provider()`, Tier 0/1/2/3 in `translate_sense()`
- [x] Lazy translation: only high-priority lemmas in background — `translate_movie_eager()` filters by `priorityScore >= 0.4`
- [x] On-demand translation path: user clicks → translate → cache in TranslationMemory — `translate_on_demand()`
- [x] Modify `POST /translate` to check TranslationMemory first — `translation.py` tries V2 when `sentence` or `movie_id` provided
- [x] V2 enrichment pipeline (Stage A: NLP, Stage B: Translation) — dual-write in `enrichment.py` (sync + async paths)
- [x] Backward-compatible WordSentenceExample population (propagation step) — `propagate_to_word_sentence_examples()`
- [x] `usageCount` / `reportCount` tracking — incremented in `translate_on_demand()` and `report_translation()`
- [x] Auto-retranslation: retranslate with DeepL when reportCount/usageCount > 0.1 — `_retranslate_with_deepl()`
- [x] V2 API endpoints — `POST /v2/movies/{id}/start`, `GET /v2/translation-memory/word/{word}`, `POST /v2/translation-memory/{id}/report`, `GET /v2/translation-memory/stats`
- [ ] Tests

### Phase 5: Optimization & Quality
**Dependencies:** Phase 4
**Deliverables:**
- [ ] Backfill script: process all existing movies through V2 pipeline
- [ ] Migrate existing TranslationCache entries → TranslationMemory where possible
- [ ] MiniLM hybrid clustering upgrade: use MiniLM within clusters for split/merge refinement (Phase 3 only uses it for cross-movie reuse)
- [ ] `priorityScore` recalculation job: periodically recompute scores with fresh click rate data
- [ ] Cost monitoring: cache hit rates, API call counts, provider breakdown
- [ ] Quality metrics: reportCount analysis, sense accuracy spot-checks, auto-retranslation audit
- [ ] Performance benchmarks (pipeline throughput, runtime latency)
- [ ] Cleanup: remove dual-write for fully-migrated tables

---

## Appendix A: Dependency List

```
New Python packages:
  - spacy >= 3.5.0
  - en_core_web_sm (spacy model, 12MB)
  - scikit-learn >= 1.2.0 (for TF-IDF + AgglomerativeClustering)
  - sentence-transformers >= 2.2.0 (for MiniLM, Phase 3+)
  - all-MiniLM-L6-v2 (sentence-transformers model, ~80MB, Phase 3+)

Already available:
  - prisma (database)
  - fastapi (API)
  - deepl (translation)
  - googletrans or equivalent (translation fallback)
```

## Appendix B: Example End-to-End Flow (v2)

```
═══════════════════════════════════════════════════════════════════
MOVIE: "The Dark Knight" (FIRST movie processed)
═══════════════════════════════════════════════════════════════════

STAGE A: NLP Pipeline (language-agnostic, runs once)
─────────────────────────────────────────────────────
1. Script: 35,000 words
2. Lemmatization (spaCy): 3,800 unique lemmas + 45 multi-word expressions
3. Lemma Registry: All 3,845 are new → create entries, compute priorityScore for each
4. CEFR Classification: A1(400) A2(800) B1(1200) B2(900) C1+(500)
5. Sentence Extraction: 3,845 × 3 = ~8,500 candidate sentences
   - After hash dedup: ~6,000 unique in SentenceBank
   - Create ~8,000 SentenceLemmaLink entries
6. Sense Clustering:
   - 2,500 lemmas with 1-2 sentences → sense_0 each = 2,500 senses
   - 1,345 lemmas with 3+ sentences → TF-IDF clustering → ~1,800 senses
   - Total: ~4,300 senses (all new, no existing to reuse)
   - POS splits: ~200 lemmas have NOUN+VERB senses → +200 extra senses
   - Grand total: ~4,500 WordSense entries
7. Eager senses (priorityScore >= 0.4): ~600 lemmas × avg 1.2 senses = ~720 senses

STAGE B: Translation Pipeline (for Spanish)
─────────────────────────────────────────────────────
8. Translation gaps: ~720 eager senses (all new)
   - A1/A2 (200 senses) → Google word+sentence: 400 calls (~free)
   - B1 high-confidence (150 senses) → Google: 300 calls (~free)
   - B1 low-confidence (50 senses) → DeepL: 100 calls
   - B2+ (200 senses) → DeepL: 400 calls
   - Total DeepL: 500 calls (vs current 6,500) — 92% reduction
   - Total Google: 700 calls (~free)
9. Store in TranslationMemory: 600 entries
10. Lazy senses (priorityScore < 0.4, ~3,780): NOT translated. On-demand when user clicks.
11. Propagate to WordSentenceExample: 6,000 entries (backward-compatible)

═══════════════════════════════════════════════════════════════════
MOVIE: "Inception" (SECOND movie, same user requests Spanish)
═══════════════════════════════════════════════════════════════════

STAGE A: NLP Pipeline
─────────────────────────────────────────────────────
1. Script: 28,000 words
2. Lemmatization: 3,200 unique lemmas
3. Lemma Registry: 2,400 already exist → only 800 NEW lemma entries
   Update totalMovieCount for all 3,200
4. Sentence Extraction: Only for 800 new lemmas → ~2,000 sentences
   + Some new sentences for existing lemmas in this movie
5. Sense Clustering for 800 new lemmas:
   - Compare against existing centroids
   - 600 match existing senses (similarity > 0.85) → reuse
   - 200 create new senses
   - Total new WordSense entries: ~250
6. Eager (priorityScore >= 0.4): ~80 new lemmas (most overlap with Dark Knight)

STAGE B: Translation Pipeline (Spanish)
─────────────────────────────────────────────────────
7. Translation gaps: ~80 new eager senses
   - 30 → Google (60 calls, ~free)
   - 50 → DeepL (100 calls)
   - Total DeepL: 100 (vs current 6,500) — 98.5% reduction
8. 2,400 existing lemmas: TranslationMemory already has translations → $0
9. Propagate to WordSentenceExample: All lemmas covered

═══════════════════════════════════════════════════════════════════
MOVIE 50: "Toy Story" (user requests Turkish — NEW LANGUAGE)
═══════════════════════════════════════════════════════════════════

STAGE A: NLP Pipeline → SKIP (already done for this movie)

STAGE B: Translation Pipeline (Turkish)
─────────────────────────────────────────────────────
1. Check TranslationMemory for Turkish: mostly empty (new language)
2. But: Toy Story shares 95% of lemmas with previous 49 movies
   - Those lemmas have senses already → just need Turkish translations
3. High-priority senses needing Turkish: ~550
   - 300 → Google (~free)
   - 250 → DeepL (500 calls)
4. After this movie: Turkish TranslationMemory has ~550 entries
5. Next Turkish request: dramatically fewer gaps

═══════════════════════════════════════════════════════════════════
RUNTIME: User clicks "charge" in "The suspect faces a criminal charge" (Spanish)
═══════════════════════════════════════════════════════════════════

1. Lemmatize "charge" → lemma="charge", pos="NOUN" (LRU cache, <1ms)
2. Fetch senses for "charge": [legal/accusation, electrical, financial]
3. Runtime sense selection: compare "The suspect faces a criminal charge"
   against representative sentences → best match: sense "legal" (sim=0.87)
4. Lookup TranslationMemory (lemmaId=X, senseId=legal, targetLang="ES")
   → HIT: { translatedWord: "acusación", translatedSentence: "..." }
5. Fetch examples: SentenceLemmaLink WHERE lemmaId=X AND senseId=legal
6. Increment usageCount (async)
7. Return to user: <20ms total

═══════════════════════════════════════════════════════════════════
RUNTIME: User clicks rare word "jurisprudence" (lazy, no pre-translation)
═══════════════════════════════════════════════════════════════════

1. Lemmatize → lemma="jurisprudence"
2. Lookup TranslationMemory → MISS (priorityScore=0.08, never translated)
3. On-demand:
   - Get representative sentence from SentenceBank
   - Translate word: "jurisprudence" → "jurisprudencia" (Google, ~free)
   - Translate sentence (Google)
   - Store in TranslationMemory (cached for all future users)
4. Return to user: ~400ms (one-time, cached forever after)
```

---

## Appendix C: Review Decisions Log

| Review Point | Decision | Rationale |
|-------------|----------|-----------|
| Global vs domain-scoped senses | Global + confidence threshold (0.85) | Simpler than domain signatures. POS-awareness handles noun/verb splits. Threshold prevents cross-domain mismatches. |
| Word extraction from sentences | Rejected → dual API call | Unreliable across languages. 2 calls per sense is negligible cost given deduplication. |
| TF-IDF vs MiniLM clustering | TF-IDF Phase 3, MiniLM hybrid Phase 5 | Measure before optimizing. TF-IDF is 80% of the value at 10% of the complexity. |
| Eager vs lazy translation | Lazy by default, eager for priorityScore >= 0.4 | 85% of user clicks hit eager words. Remaining 15% are on-demand with <500ms latency. Hybrid score adapts over time. |
| Fuzzy Translation Memory lookup | Rejected for now | Exact (lemma, sense, lang) is sufficient because senses are pre-clustered. Revisit if data shows missed reuse. |
| Job queue (Celery/RQ) | Rejected for now | FastAPI BackgroundTasks + status table sufficient at <1000 movies. |
| Language decoupling | Adopted | NLP pipeline runs once. Translation pipeline runs per language. Adding a new language = translation only. |
| Quality feedback | Adopted (lightweight) | usageCount + reportCount on TranslationMemory. Enables future quality improvements. |
| Clustering threshold 0.4→0.6 (v3) | Adopted | 0.4 was too loose — created clusters that wouldn't pass the 0.85 reuse threshold. 0.6 narrows the gap and produces more coherent senses. |
| MiniLM in Phase 3, not Phase 5 (v3) | Adopted (targeted only) | MiniLM used only for cross-movie reuse validation (1 embedding per cluster rep), not full clustering. ~80MB model, <5ms per sentence on CPU. Cheap enough for Phase 3. |
| Hybrid priority score (v3) | Adopted — replaces `isHighPriority` boolean | Static top-500 ignored CEFR difficulty and user behavior. Hybrid score (frequency 50% + CEFR 30% + click rate 20%) adapts over time. Threshold 0.4. |
| Runtime sense selection (v3) | Adopted — TF-IDF at request time | Was the biggest gap: user clicks word → which sense? Compare clicked sentence against sense representatives via TF-IDF cosine similarity. <5ms for 2-5 candidates. Fallback to dominantSenseId if no sentence context. |
| Shorter representative sentences (v3) | Adopted | Shorter sentences translate better, cost fewer chars, and are easier for users to scan. Length penalty applied during representative selection. |
| Auto-retranslation on reports (v3) | Adopted | If reportCount/usageCount > 0.1 (10% report rate), auto-retranslate with DeepL regardless of original provider. Prevents bad Google translations from persisting. |

---

*End of Master Plan v3. Revised based on two architecture reviews. Ready for implementation approval.*
