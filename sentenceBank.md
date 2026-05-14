# SentenceBank — Plan & Architecture

How example sentences end up on the For You row (and the expanded WordRow) without making spaCy do work at request time.

---

## Goal

When a user opens the For You list for a movie, every word should show one in-movie example sentence inline, in **<50ms server time**, with **no LLM and no spaCy** at request time. Tapping a row shows the translation lazily (existing behaviour).

---

## TL;DR — current state

| | Status |
|---|---|
| Data model (SentenceBank + SentenceLemmaLink) | ✅ shipped |
| `matched_form` column on links | ✅ shipped (migration 2026_05_08) |
| Batch endpoint `POST /api/enrichment/movies/{id}/sentences/batch` | ✅ shipped |
| Lemma-based indexer with two-tier short-line handling | ✅ shipped |
| Auto-enrich BG task on `classify-script` | ✅ shipped |
| Backfill script for 2,748 unbanked movies | ⏳ ready to run — see [`backfillSentence.md`](backfillSentence.md) |
| Re-index of 5 legacy-banked movies | ⏳ pending (low coverage / NULL `matched_form`) |
| Slow-path fallback in batch endpoint | ✅ shipped (vestigial after full backfill) |

After the full backfill: request time is a single indexed `JOIN` query.

---

## Data model

```
movies
  └── movie_scripts (1:1)
        └── word_classifications (N:1, per-script CEFR list)

sentence_bank
  • sentenceHash  (unique, sha256 of normalized text)
  • sentence       text
  • movieId        FK → movies
  • indexed by movieId

sentence_lemma_links              ← the join row
  • sentenceId     FK → sentence_bank
  • lemmaId        FK → lemmas
  • wordPosition   int    — token index inside the sentence
  • matchedForm    varchar — actual surface form ("ran" for lemma "run")
  • score          float
  • unique (sentenceId, lemmaId)
  • indexed (lemmaId, senseId)

lemmas
  • lemma          unique
  • cefrLevel, frequencyRank, wordForms…
```

Why this shape works:

- **Sentences are deduped globally** by hash — "I love you" said in 50 movies stores once.
- **Lemmas are global** — one row per lemma across the whole DB; `lemma.lemma IN (…)` is a unique-index hit.
- **The link row carries everything the row UI needs** — text + position + matched_form. No re-parse at request time.
- **Up to N links per (movie, lemma)** — we currently store up to 3 sentences per lemma for diversity (could rotate per-session in the UI).

---

## Index-time flow (one spaCy pass per movie)

[`populate_movie_sentence_bank`](backend/src/services/sentence_bank_service.py#L133)

```
classify-script saves WordClassification rows
        ↓
BackgroundTasks.add_task(populate_sentence_bank_bg, movie_id)
        ↓
1. Resolve { lemma → lemma_id } from word_classifications  (1 query)
2. nlp(full_script_text)                                   (1 spaCy pass, ~1-2s for 8K words)
3. extract_sentences_for_lemmas() — for every sentence in doc.sents:
     • check each token's lemma against the target set
     • two-tier scoring:
        – preferred: 6–25 words, score > 0
        – fallback : short dialogue, padded with previous sentence
4. dedup sentences by hash → SentenceBank.create(...)
5. SentenceLemmaLink.create(sentenceId, lemmaId, wordPosition, matchedForm, score)
```

**Coverage observed:** 92.5% of classified lemmas get at least one sentence (Hardcore Henry: 745/805). Old literal-matching indexer was ~75%.

**Per-movie cost:** ~2–3 seconds CPU + ~hundreds of small DB writes. No LLM.

---

## Request-time flow

[`POST /api/enrichment/movies/{id}/sentences/batch`](backend/src/routes/enrichment.py#L776)

```
words = ["redemption", "vigilante", "chaos", ...]
        ↓
1. nlp.pipe(words)            # batch lemmatize, ~10ms for 25 words
2. lemma.find_many(in: ...)   # 1 query, unique index
3. sentence_lemma_links.find_many(lemmaId: in, sentence: { movieId })
                               # 1 query, indexed
4. Group by lemma → take top max_examples per lemma
5. Return { word: [{ sentence, word_position, matched_form }] }
```

**Observed latency on indexed movie:** ~15ms for 10–25 words.

**Slow-path fallback** (when fast path returns no sentences for some words):

```
6. movie.find_unique(include movieScripts) — 1 query
7. one nlp(full_script) pass — ~1s for 8K words
8. extract_sentences_for_lemmas(missing_lemmas) — same matcher as indexer
```

Fires only when SentenceBank has gaps. After full backfill, this rarely runs.

---

## Frontend flow

[`MovieDetailScreen.tsx`](apps/mobile/src/components/screens/MovieDetailScreen.tsx) prefetch effect:

```
1. View becomes "foryou" + movieId resolved
2. words = first SUGGESTED_CAP from suggestedWords
3. wordwiseApi.batchSentences(movieId, missing)
4. setForyouSentences({ word: { sentence, word_position, matched_form }, ... })
5. ForYouWordRow reads preloadedSentence from props (no fetch on mount)
6. If first response is mostly empty → automatic single retry after 5s
   (covers race between classify-script returning and BG task finishing)
```

Status state machine per word: `undefined → in-flight → hit | miss-recent → in-flight-retry → hit | miss-confirmed`.

---

## Edge cases & known limitations

1. **Inflected forms not in any classification.** If a script has "abetted" but the classifier never produced a "abet" classification, no link gets stored. Slow path catches it at request time. **Open Q:** should we expand to *every* lemma the script contains, not just classified ones? Cheap to do but bloats the table.

2. **Phrases / idioms.** Batch endpoint skips multi-word inputs (`if " " in word`). Idioms in For You still render via `IdiomRow` and don't have inline sentences. Could add a `sentence_phrase_links` table or reuse `extract_phrase_sentences` in a phrase-batch endpoint.

3. **Score is constant 1.0 right now.** "Phase 3" sense clustering would refine score per (sentence, sense). Without it, we just take the first 3 sentences arbitrarily.

4. **Per-session diversity.** We store up to 3 sentences per lemma but the row only shows one. Could rotate by `(userId, lemmaId)` hash so re-opening shows a different example. Trivial UI change.

5. **Five legacy movies have NULL `matched_form`** (Hoppers id=9, Spirited Away id=1, Schindler's id=48, Constantine id=757, Project Hail Mary id=164). Frontend handles this via case-insensitive regex on the input word. Should be re-indexed for full quality (see backfill plan).

6. **Slow-path fallback latency** (~300ms–1s) feels OK as a one-off but could stack if the user opens many unbanked movies in a row. After full backfill this is moot.

---

## What changed recently (commits/changes)

- **Migration 2026_05_08** — added `matched_form` column to `sentence_lemma_links`.
- **Indexer rewritten** ([sentence_bank_service.py:133](backend/src/services/sentence_bank_service.py#L133)) — lemma-based, two-tier short-line handling, max 3 per lemma.
- **Auto-enrich BG task wired up** ([cefr.py:270](backend/src/routes/cefr.py#L270)) — fires from both fast-path and slow-path of `classify-script`. Was dead code before.
- **Batch endpoint** ([enrichment.py:776](backend/src/routes/enrichment.py#L776)) — fast path + slow-path fallback.
- **Existing `/sentences/{word}` endpoint** updated to use stored `matched_form` (skips redundant spaCy parse for highlighting).
- **Frontend `ForYouWordRow`** rewritten — sentence-first row design, sentence prop pre-loaded by parent.
- **Frontend prefetch with retry** — covers the race against the BG task.

---

## Future work (rough priority)

1. **Run the full backfill** — see `backfillSentence.md`. Without this, ~98% of movies still feel slow on first open.
2. **Re-index the 5 legacy movies** with the new indexer. Need a `--force` flag on the backfill script (or a small SQL script that deletes their `sentence_bank` rows so the existing skip-if-exists path lets them through).
3. **Index every script-occurring lemma**, not just classified ones, so slow path becomes truly vestigial.
4. **Diversity rotation** — pick which of the 3 stored sentences to show based on `(userId, lemmaId)` hash.
5. **Phrase / idiom inline sentences** — extend the model + endpoint to handle multi-word entries.
6. **Score refinement** — use sense clustering to pick the *most representative* sentence per lemma instead of arbitrary first-three.
