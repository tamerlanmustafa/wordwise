# WordWise: Advanced Language Difficulty Scoring & Learner Tracking

> Comprehensive implementation plan for enhancing movie/content difficulty scoring with advanced linguistic features and building a personalized learner tracking system.

**Last updated:** 2026-04-05
**Status:** Planning

---

## Table of Contents

1. [Current State](#1-current-state)
2. [Phase 1 — Morphosyntactic Complexity](#2-phase-1--morphosyntactic-complexity)
3. [Phase 2 — Lexical Sophistication](#3-phase-2--lexical-sophistication)
4. [Phase 3 — Semantic & Conceptual Complexity](#4-phase-3--semantic--conceptual-complexity)
5. [Phase 4 — Pragmatic & Discourse Complexity](#5-phase-4--pragmatic--discourse-complexity)
6. [Phase 5 — Cognitive Load & Predictability](#6-phase-5--cognitive-load--predictability)
7. [Phase 6 — User Interaction Tracking](#7-phase-6--user-interaction-tracking)
8. [Phase 7 — Adaptive Learning Insights](#8-phase-7--adaptive-learning-insights)
9. [Phase 8 — Monitoring, Validation & Future Expansions](#9-phase-8--monitoring-validation--future-expansions)

---

## 1. Current State

### Existing Difficulty Scorer (`difficulty_scorer.py`)

The scorer computes a 0–100 difficulty score using **11 weighted base signals**, **3 multipliers**, and **1 filter**:

| # | Signal | Weight | Description |
|---|--------|--------|-------------|
| 1 | Weighted content word complexity | 22% | % of content words (A2+) at B2/C1/C2, weighted by level |
| 2 | Hard word concentration | 20% | B2+ density among content words |
| 3 | Zipf rarity | 10% | Vocabulary rarity via Zipf frequency scale |
| 4 | Median CEFR level | 8% | Median difficulty of unique words |
| 5 | Flesch Reading Ease | 8% | Readability formula score |
| 6 | Sentence length buckets | 8% | % of sentences that are long (16–20 words) or complex (21+) |
| 7 | Lexical diversity (Herdan's C) | 7% | Vocabulary richness |
| 8 | CEFR spread | 5% | Range between easiest and hardest word levels |
| 9 | Syllable complexity | 4% | Average syllables per word |
| 10 | Repetition ratio | 4% | Unique-to-total word ratio |
| 11 | Idiom/phrasal verb density | 4% | Phrasal verb and idiom frequency |

**Multipliers:** Domain vocabulary (7 domains, up to 1.25×), genre normalization (TMDB genres), band clamping (vocabulary-based floor/ceiling).

**Filter:** Slang/gibberish detector that downgrades suspect C1/C2 words (contractions, no-vowel strings) to B1.

### Existing Data Models

- `WordClassification` — per-word CEFR level, confidence, frequency rank, POS tag
- `MovieScript` — raw subtitle text + cleaned script text
- `UserWord` — saved words per user/movie (web only, not yet on mobile)
- `UserTranslationHistory` — tracks word translation lookups per user
- `SentenceBank` + `SentenceLemmaLink` — sentences extracted per movie with lemma linkage
- `Lemma` + `WordSense` + `TranslationMemory` — V2 context-aware translation system

### Key Constraints

- Script text comes from SRT subtitles — speaker turns and timestamps are **stripped during parsing** (flattened to continuous text)
- No dependency/constituency parse trees currently stored
- No user interaction events tracked beyond word saves and translation history
- Mobile app does **not** have the word save/bookmark feature yet (web only)

---

## 2. Phase 1 — Morphosyntactic Complexity

**Goal:** Measure grammatical structure difficulty beyond word-level signals.

**Dependencies:** `spaCy` (with `en_core_web_sm` or `en_core_web_md` model)

### Signals to Implement

#### 1.1 Clause Density
- **What:** Average number of clauses per sentence (coordinated + subordinated)
- **How:** Use spaCy dependency parse. Count tokens with `dep_` in `{advcl, relcl, ccomp, xcomp, acl, csubj}` → each is a subordinate clause boundary. Count `conj` with verb heads → coordinate clauses.
- **Score:** `clause_count / sentence_count`. Normalize: 1.0 clause/sentence = 0.0, 3.0+ = 1.0
- **CEFR rationale:** A1–A2 = simple sentences (1 clause). B1 = compound sentences (2). B2+ = complex/compound-complex (3+).

#### 1.2 Syntactic Depth
- **What:** Average maximum dependency tree depth per sentence
- **How:** For each sentence, compute max depth of the dependency tree from root. `max(token.ancestors count for token in sentence)`.
- **Score:** Normalize: depth 2–3 = 0.0, depth 7+ = 1.0
- **CEFR rationale:** Deep nesting (relative clauses inside relative clauses) is a C1+ marker.

#### 1.3 Passive Voice Ratio
- **What:** % of sentences containing passive constructions
- **How:** Detect `auxpass` dependency or pattern `nsubjpass` in spaCy parse. Alternative: regex for `(was|were|been|being|is|are|get|got|gotten) + past_participle`.
- **Score:** `passive_count / sentence_count`. Normalize: 0% = 0.0, 25%+ = 1.0
- **CEFR rationale:** Passive voice is B1+ (simple passive), B2+ (complex passive, passive reporting).

#### 1.4 Nominalization Density
- **What:** Frequency of abstract nouns derived from verbs/adjectives (e.g., "investigate" → "investigation")
- **How:** Detect nouns ending in `-tion`, `-ment`, `-ness`, `-ity`, `-ance`, `-ence`, `-ism`, `-ure` where the root is a known verb/adjective. Use spaCy lemmatization + suffix check.
- **Score:** `nominalization_count / total_nouns`. Normalize: 5% = 0.0, 25%+ = 1.0
- **CEFR rationale:** Nominalizations are a hallmark of academic/formal register (B2–C2). Everyday speech uses verbs; formal speech packs meaning into nouns.

### Implementation Steps

- [ ] Add `spacy` to `requirements.txt` and download `en_core_web_sm`
- [ ] Create `backend/src/services/syntactic_analyzer.py` with functions:
  - `analyze_morphosyntax(text: str) -> MorphosyntaxResult`
  - Returns: `clause_density`, `avg_tree_depth`, `passive_ratio`, `nominalization_density`
- [ ] Cache spaCy `nlp` object as module-level singleton (model loading is expensive, ~2s)
- [ ] Add `morphosyntax_score` signal to `compute_difficulty_advanced()` as a composite:
  ```
  morphosyntax = 0.35 * clause_density + 0.25 * tree_depth + 0.20 * passive_ratio + 0.20 * nominalization
  ```
- [ ] Suggested weight in final scorer: **6–8%** (rebalance from existing signals)
- [ ] Store raw morphosyntax metrics in `Movie.cefrDistribution` JSON for debugging
- [ ] Add timeout/fallback: if spaCy parse exceeds 30s on long scripts, skip and use default 0.3

### Data Processing Notes

- spaCy processes ~10K tokens/second on CPU — a 15K-word movie script takes ~1.5s
- Run syntactic analysis **once during classification** (slow path in `cefr.py`), not on every difficulty query
- Store computed metrics in `cefrDistribution` JSON so they don't need recomputation

---

## 3. Phase 2 — Lexical Sophistication

**Goal:** Capture vocabulary difficulty beyond individual word CEFR levels.

**Dependencies:** Pre-built collocation database or corpus statistics (optional: `nltk.collocations`, `wordfreq`)

### Signals to Implement

#### 2.1 Collocation Complexity
- **What:** Density of non-obvious word pairings that a learner wouldn't predict
- **How:** Extract bigrams from text. Score each bigram using Pointwise Mutual Information (PMI):
  ```
  PMI(w1, w2) = log2(P(w1,w2) / (P(w1) * P(w2)))
  ```
  High PMI = strong collocation (e.g., "stark contrast", "utter nonsense"). Count bigrams with PMI > 3.0 as "strong collocations".
- **Data source:** Pre-compute PMI from a large subtitle corpus (OpenSubtitles), or use `wordfreq` unigram frequencies + observed bigram counts from the movie's own text as an approximation.
- **Score:** `strong_collocation_count / total_bigrams`. Normalize: 1% = 0.0, 5%+ = 1.0
- **CEFR rationale:** Collocations are a major B2+ challenge. Learners know individual words but not which words "go together" (e.g., "make a decision" not "do a decision").

#### 2.2 Multi-Word Expression (MWE) Density
- **What:** Frequency of idioms, phrasal verbs, and fixed expressions
- **How:** Expand the existing `detect_phrasal_verbs_and_idioms()` with a curated MWE list. Sources:
  - PHaVE List (Phrasal Verb Academic Vocabulary, ~300 entries)
  - Oxford Idioms Dictionary (top 500 idioms)
  - Cambridge Phrasal Verbs in Use (organized by CEFR level)
- **Score:** `mwe_count / sentence_count`. Normalize: 0 MWEs/sentence = 0.0, 0.3+ = 1.0
- **Enhancement:** Tag MWEs by CEFR level so that B1 phrasal verbs ("look after") are weighted less than C1 idioms ("to burn bridges").

#### 2.3 Rare Morphological Forms
- **What:** Frequency of uncommon inflections, irregular forms, and productive morphology
- **How:** Detect:
  - Irregular past tenses not in top 100 frequency list ("wrought", "bidden", "slain")
  - Productive prefixes/suffixes creating low-frequency derived words ("un-re-do-able", "anti-establishment-arian")
  - Uncommon comparative/superlative forms ("more beautiful" vs. "beautifuler" — but "further" vs "farther")
- **Score:** `rare_form_count / total_words`. Normalize: 0.5% = 0.0, 3%+ = 1.0
- **CEFR rationale:** Learners up to B1 know regular morphology. Irregular and productive morphology is B2+.

### Implementation Steps

- [ ] Create `backend/src/services/lexical_analyzer.py`:
  - `compute_collocation_complexity(text: str) -> float`
  - `compute_mwe_density(text: str) -> float`
  - `compute_rare_morphology(words: List[WordData]) -> float`
- [ ] Build collocation PMI table:
  - Option A (offline): Pre-compute PMI from OpenSubtitles corpus, store as JSON/pickle (~5MB)
  - Option B (online): Approximate PMI using `wordfreq` unigram frequencies + in-text bigram counts
- [ ] Expand the existing MWE/idiom list in `difficulty_scorer.py` with CEFR-tagged entries
- [ ] Create `data/irregular_forms.json` — ~200 rare irregular verb forms with frequency rank
- [ ] Add composite `lexical_sophistication` signal to scorer:
  ```
  lexical_sophistication = 0.40 * collocation + 0.35 * mwe_density + 0.25 * rare_morphology
  ```
- [ ] Suggested weight: **5–6%** (partially subsumes existing `idiom_density` at 4%)

---

## 4. Phase 3 — Semantic & Conceptual Complexity

**Goal:** Measure how abstract, ambiguous, and concept-dense the language is.

**Dependencies:** Concreteness ratings database, `wordfreq`, optionally sentence embeddings

### Signals to Implement

#### 3.1 Abstractness Score
- **What:** Average concreteness of content words (inverse = abstractness)
- **How:** Use the Brysbaert et al. (2014) concreteness ratings database — 40K English words rated 1–5 (1 = abstract, 5 = concrete). Freely available for research.
  ```
  abstractness = 1 - (avg_concreteness_rating / 5.0)
  ```
- **Score:** 0.0 = all concrete words ("table", "run"), 1.0 = all abstract words ("justice", "democracy")
- **CEFR rationale:** A1–A2 vocabulary is overwhelmingly concrete. B2+ introduces abstract concepts. C1+ texts operate in purely abstract domains.

#### 3.2 Polysemy Load
- **What:** Average number of dictionary senses per content word
- **How:** Use WordNet sense counts: `len(wn.synsets(word, pos))`. Higher polysemy = more ambiguity for learners.
- **Score:** `avg_sense_count` across content words. Normalize: 2 senses avg = 0.0, 8+ = 1.0
- **CEFR rationale:** Polysemous words ("run" = 40+ senses, "set" = 60+) are deceptively hard. Learners know one meaning but encounter another.
- **Bonus:** Cross-reference with `WordSense` table — if a movie uses rare senses of common words, that's a strong difficulty signal.

#### 3.3 Semantic Density
- **What:** Information packed per sentence — how many distinct concepts per unit of text
- **How:** Count content words (nouns, verbs, adjectives, adverbs) per sentence, divided by total words per sentence. Subtract function words.
  ```
  semantic_density = content_word_count / total_word_count  (per sentence, then average)
  ```
- **Score:** Normalize: 0.40 = 0.0 (normal speech), 0.65+ = 1.0 (dense academic text)
- **CEFR rationale:** Casual dialogue is ~40% content words. Academic/technical monologues pack 55–65%.

#### 3.4 Referential Complexity
- **What:** How hard it is to track who/what is being talked about
- **How:** Count pronoun-to-noun ratio and pronoun chain length. High pronoun density with few explicit referents = harder to follow.
  - Use spaCy NER + POS: count `PRON` tokens, count `PROPN`/`NOUN` tokens
  - `referential_complexity = pronoun_count / (pronoun_count + explicit_noun_count)`
- **Score:** Normalize: 0.30 = 0.0, 0.60+ = 1.0
- **CEFR rationale:** A1–B1 texts use explicit referents. B2+ assumes you can track pronoun chains across sentences.

### Implementation Steps

- [ ] Download Brysbaert concreteness ratings → `data/concreteness_ratings.csv` (~40K entries, ~2MB)
- [ ] Create `backend/src/services/semantic_analyzer.py`:
  - `compute_abstractness(words: List[WordData]) -> float` — lookup in concreteness DB
  - `compute_polysemy_load(words: List[WordData]) -> float` — WordNet sense counts
  - `compute_semantic_density(text: str) -> float` — content/function word ratio per sentence
  - `compute_referential_complexity(text: str) -> float` — pronoun tracking
- [ ] Load concreteness ratings as module-level dict (one-time ~50ms load)
- [ ] Add composite `semantic_complexity` signal:
  ```
  semantic = 0.30 * abstractness + 0.25 * polysemy + 0.25 * semantic_density + 0.20 * referential
  ```
- [ ] Suggested weight: **6–7%**
- [ ] WordNet dependency: `nltk.download('wordnet')` — already have nltk installed

---

## 5. Phase 4 — Pragmatic & Discourse Complexity

**Goal:** Capture difficulty that comes from how language is *used* beyond its literal meaning.

**Dependencies:** Curated lists of discourse markers, cultural reference database (manual)

### Signals to Implement

#### 4.1 Indirect Speech & Implicature Density
- **What:** How much meaning is implied rather than stated directly
- **How:** Detect markers of indirect speech and hedging:
  - Reporting verbs: "claimed", "suggested", "implied", "insinuated"
  - Hedging: "sort of", "kind of", "arguably", "presumably", "seemingly"
  - Understatement markers: "not exactly", "not entirely", "not unlike"
  - Rhetorical questions: sentences ending in `?` without question words, or `?` after declarative structure
- **Score:** `indirect_marker_count / sentence_count`. Normalize: 0.02 = 0.0, 0.15+ = 1.0
- **CEFR rationale:** Understanding what someone *means* vs. what they *say* is B2+ pragmatic competence.

#### 4.2 Discourse Cohesion Device Complexity
- **What:** Sophistication of logical connectors between ideas
- **How:** Categorize discourse markers by CEFR level:
  - **A1–A2:** and, but, so, because, then, or
  - **B1:** however, although, therefore, moreover, furthermore, meanwhile
  - **B2:** nevertheless, notwithstanding, conversely, consequently, insofar as
  - **C1+:** be that as it may, inasmuch as, irrespective of, hitherto, whereby
  
  Score = weighted average of connector CEFR levels used.
- **Score:** Normalize same as CEFR level mapping (A1=0, C2=1)
- **CEFR rationale:** Connector sophistication directly tracks reading comprehension descriptors.

#### 4.3 Cultural Reference Density (lightweight)
- **What:** Frequency of proper nouns, brand names, and culturally-specific terms that require world knowledge
- **How:** Use spaCy NER to extract `PERSON`, `ORG`, `GPE`, `EVENT`, `WORK_OF_ART` entities. Higher density = more background knowledge assumed.
- **Score:** `named_entity_count / sentence_count`. Normalize: 0.2 = 0.0, 1.5+ = 1.0
- **CEFR rationale:** Understanding "Lehman Brothers collapsed" requires both linguistic AND world knowledge. This is C1+ territory.
- **Note:** This is a proxy — true cultural reference detection would need a knowledge base. Named entity density is a reasonable approximation.

### Implementation Steps

- [ ] Create `data/discourse_markers.json`:
  ```json
  {
    "A1": ["and", "but", "so", "or", "then"],
    "A2": ["because", "also", "first", "next", "finally"],
    "B1": ["however", "although", "therefore", "moreover", "despite"],
    "B2": ["nevertheless", "consequently", "furthermore", "whereas", "thereby"],
    "C1": ["notwithstanding", "hitherto", "insofar as", "irrespective", "whereby"],
    "C2": ["be that as it may", "inasmuch as", "lest", "whence"]
  }
  ```
- [ ] Create `data/indirect_speech_markers.json` — reporting verbs + hedging + understatement patterns
- [ ] Create `backend/src/services/discourse_analyzer.py`:
  - `compute_indirect_speech_density(text: str) -> float`
  - `compute_cohesion_complexity(text: str) -> float`
  - `compute_cultural_reference_density(text: str) -> float` (uses spaCy NER)
- [ ] Add composite `pragmatic_complexity` signal:
  ```
  pragmatic = 0.35 * indirect_speech + 0.40 * cohesion + 0.25 * cultural_refs
  ```
- [ ] Suggested weight: **4–5%**

---

## 6. Phase 5 — Cognitive Load & Predictability

**Goal:** Measure how much mental effort is required to process the text.

**Dependencies:** N-gram language model or pre-trained perplexity model

### Signals to Implement

#### 5.1 Word Sequence Entropy (Surprisal)
- **What:** How predictable the next word is given context — high entropy = harder to process
- **How:**
  - **Lightweight approach:** Use bigram/trigram probabilities from a pre-built frequency table. Compute average surprisal: `-log2(P(word_n | word_n-1))`.
  - **Heavy approach:** Use a small pre-trained language model (e.g., GPT-2 small via HuggingFace) to compute perplexity per sentence. **Not recommended for MVP** — too heavy for on-demand scoring.
  - **Recommended:** Use `wordfreq` conditional probabilities or pre-compute bigram stats from OpenSubtitles.
- **Score:** Average surprisal across sentences. Normalize: surprisal 4.0 bits = 0.0, 10.0+ bits = 1.0
- **CEFR rationale:** Predictable text ("How are you?" → "Fine, thanks") is easier. Unpredictable sequences ("The collateralized debt obligation's tranche structure...") require more cognitive effort.

#### 5.2 Topic Shift Frequency
- **What:** How often the conversation changes subject — frequent shifts = harder to follow
- **How:** Divide text into windows of N sentences (e.g., 5). Compute content-word overlap between consecutive windows. Low overlap = topic shift.
  ```
  overlap(window_i, window_i+1) = |content_words_i ∩ content_words_i+1| / |content_words_i ∪ content_words_i+1|
  ```
  Count windows where overlap < 0.10 as "topic shifts".
- **Score:** `topic_shift_count / total_windows`. Normalize: 10% shifts = 0.0, 40%+ = 1.0
- **CEFR rationale:** A1–B1 texts maintain one topic. B2+ texts (especially movies with multiple plotlines) shift rapidly.

### Implementation Steps

- [ ] Create `backend/src/services/cognitive_analyzer.py`:
  - `compute_surprisal(text: str) -> float` — bigram surprisal using `wordfreq`
  - `compute_topic_shift_frequency(text: str, window_size: int = 5) -> float`
- [ ] For surprisal: use `wordfreq.zipf_frequency()` as unigram baseline; compute observed bigram probabilities from the text itself (self-referential but captures dialogue predictability)
- [ ] Add composite `cognitive_load` signal:
  ```
  cognitive = 0.60 * surprisal + 0.40 * topic_shifts
  ```
- [ ] Suggested weight: **3–4%** (experimental — validate before increasing)
- [ ] Mark as **experimental**: correlation with learner difficulty needs validation before production weight

---

## 7. Phase 6 — User Interaction Tracking

**Goal:** Track how users interact with content to detect individual learning challenges.

### 6.1 Word Saving / Bookmarking (Mobile)

The web app already has word saving via `POST /user/words/save` and the `UserWord` model. Mobile does not.

#### Implementation Steps

- [ ] **Mobile UI: Add save/bookmark icon** to the word row in `App.tsx`
  - Tap to save → filled bookmark icon
  - Tap again to unsave → outline bookmark icon
  - Use existing `POST /api/user/words/save` endpoint (toggle behavior already implemented)
- [ ] **Mobile: Fetch saved state on load**
  - Call `GET /api/user/words` on vocabulary load
  - Cross-reference saved words with displayed word list to show bookmark state
- [ ] **Mobile: Auth requirement**
  - Word saving requires authentication — show login prompt if user is not authenticated
  - If no auth system on mobile yet, store saves locally in SQLite (`database.ts` already exists) and sync when auth is added
- [ ] **Backend: Add aggregation endpoint**
  - `GET /api/user/words/stats` — returns:
    ```json
    {
      "total_saved": 142,
      "by_cefr": {"B1": 45, "B2": 67, "C1": 30},
      "by_movie": [{"movie_id": 1, "title": "The Big Short", "count": 23}],
      "most_saved_words": [{"word": "mortgage", "save_count": 1, "movies": ["The Big Short"]}],
      "recurring_saves": [{"word": "leverage", "saved_in_movies": 3}]
    }
    ```

### 6.2 Repeated Click / Lookup Tracking

Track when users click on the same word multiple times across sessions — signals persistent difficulty.

#### New Data Model

```prisma
model UserWordInteraction {
  id            Int      @id @default(autoincrement())
  userId        Int      @map("user_id")
  word          String   @db.VarChar
  movieId       Int?     @map("movie_id")
  interactionType  interactiontype  @map("interaction_type")
  metadata      Json?    // e.g., {"time_spent_ms": 3200, "translation_viewed": true}
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  user  User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  movie Movie? @relation(fields: [movieId], references: [id], onDelete: SetNull)

  @@index([userId, word], map: "ix_user_word_interactions_user_word")
  @@index([userId, createdAt], map: "ix_user_word_interactions_user_date")
  @@index([word], map: "ix_user_word_interactions_word")
  @@map("user_word_interactions")
}

enum interactiontype {
  ROW_CLICK        // Expanded word row to see sentence/translation
  TRANSLATION_VIEW // Viewed translation of a sentence
  DEFINITION_VIEW  // Viewed word definition
  WORD_SAVE        // Saved/bookmarked a word
  WORD_UNSAVE      // Removed bookmark
}
```

#### Implementation Steps

- [ ] Add `UserWordInteraction` model to `schema.prisma`
- [ ] Run `prisma migrate dev --name add_user_word_interactions`
- [ ] Create `POST /api/user/interactions` endpoint:
  ```python
  @router.post("/interactions")
  async def log_interaction(request: InteractionRequest, ...):
      # Fire-and-forget — don't slow down the UI
      await db.userwordinteraction.create(data={...})
  ```
- [ ] **Frontend (web):** In `WordRow.tsx`, log `ROW_CLICK` when row expands, `TRANSLATION_VIEW` when translation renders
- [ ] **Frontend (mobile):** In `App.tsx`, same events on row expand and sentence display
- [ ] **Backend aggregation endpoint** `GET /api/user/interactions/struggles`:
  ```json
  {
    "frequently_looked_up": [
      {"word": "collateral", "lookup_count": 7, "across_movies": 2, "cefr": "C1"},
      {"word": "derivative", "lookup_count": 5, "across_movies": 1, "cefr": "C1"}
    ],
    "struggle_patterns": {
      "by_cefr": {"B2": 34, "C1": 52, "C2": 8},
      "by_domain": {"finance": 15, "legal": 8},
      "by_pos": {"noun": 45, "verb": 30, "adjective": 19}
    }
  }
  ```
- [ ] **Rate limiting:** Max 1 interaction log per word per user per 30 seconds (prevent spam from rapid clicking)

### 6.3 Time-on-Explanation Tracking (Optional)

- [ ] Track `time_spent_ms` in the interaction metadata — measure time from row expand to row collapse
- [ ] Long time on a word (>5s) may indicate difficulty; very short (<500ms) may indicate accidental click
- [ ] Store in `UserWordInteraction.metadata` JSON field — no schema change needed

### 6.4 Exercise Performance (Future)

When exercises are implemented (vocabulary quizzes, fill-in-the-blank, etc.):

- [ ] Create `UserExerciseResult` model with `word`, `exercise_type`, `is_correct`, `response_time_ms`
- [ ] Feed results into struggle detection — words failed multiple times are high-priority review candidates
- [ ] This depends on the exercise/quiz feature being built first

---

## 8. Phase 7 — Adaptive Learning Insights

**Goal:** Combine difficulty scoring + user interaction data to provide personalized learning insights.

### 7.1 Personal Difficulty Profile

Generate a per-user difficulty profile based on their interaction patterns:

```json
{
  "user_id": 42,
  "estimated_level": "B1+",
  "strengths": ["everyday vocabulary", "short sentences", "concrete topics"],
  "weaknesses": ["financial terminology", "passive constructions", "abstract nouns"],
  "struggle_domains": ["finance", "legal"],
  "recommended_next_movie": {
    "title": "Finding Nemo",
    "score": 32,
    "reason": "Matches your current level with gentle stretch on B2 vocabulary"
  }
}
```

#### Implementation Steps

- [ ] Create `backend/src/services/learner_profile.py`:
  - `compute_user_level(user_id: int) -> LearnerProfile` — analyze saved words, interaction history, movies watched
  - Level estimation: if user struggles with B2 words but handles B1 fine → estimated level is B1+
- [ ] **Movie recommendation logic:**
  - User at level B1 (score ~40) → recommend movies scored 35–50 (slight stretch)
  - User at level B2 (score ~55) → recommend movies scored 50–65
  - Avoid movies where >30% of vocabulary is in user's known struggle domains
- [ ] Create `GET /api/user/profile/learning` endpoint
- [ ] Display learning insights on a new "My Progress" page (web + mobile)

### 7.2 Word-Level Difficulty Personalization

Adjust displayed word difficulty based on user history:

- [ ] If user has looked up "mortgage" 5 times across 3 movies → flag it as "still challenging" even if their overall level is B2
- [ ] If user saved a word in movie A and encounters it in movie B → highlight it as "previously saved — do you know it now?"
- [ ] Create `GET /api/user/words/context/{movie_id}` endpoint:
  ```json
  {
    "previously_seen": ["mortgage", "equity"],
    "previously_struggled": ["derivative", "collateral"],
    "new_for_you": ["tranche", "securitize"]
  }
  ```

### 7.3 Adaptive Hints

When a user clicks on a word they've seen before:

- [ ] **First encounter:** Show full definition + translation + sentence
- [ ] **2nd–3rd encounter:** Show sentence only, with word highlighted — "Do you remember this word?"
- [ ] **4th+ encounter:** Show a fill-in-the-blank prompt before revealing the answer
- [ ] Track progression via `UserWordInteraction` count per word

---

## 9. Phase 8 — Monitoring, Validation & Future Expansions

### 8.1 Validation Strategy

Before assigning production weights to new signals, validate them:

- [ ] **Ground truth dataset:** Curate 20–30 movies with known CEFR levels (from language teaching resources):
  - A2: Peppa Pig, Dora the Explorer
  - B1: Cars, Finding Nemo, Toy Story
  - B2: The Social Network, Harry Potter
  - C1: The Big Short, The Godfather, 12 Angry Men
  - C2: There Will Be Blood, Primer
- [ ] **Signal correlation analysis:** For each new signal, compute Pearson correlation with ground-truth difficulty
- [ ] **Ablation testing:** Score all 20+ movies with and without each signal. Does adding the signal improve rank ordering?
- [ ] **Threshold tuning:** Use the ground truth set to calibrate normalization ranges (the "0.0 at X, 1.0 at Y" parameters)

### 8.2 Monitoring Metrics

Track in production:

- [ ] **Score distribution:** Histogram of all movie scores — should be roughly uniform, not clustered
- [ ] **Signal contribution:** Log each signal's raw value per movie — detect if any signal is always 0 or always 1 (degenerate)
- [ ] **User-score correlation:** Do users who struggle more (high lookup count) tend to watch higher-scored movies? If not, the score isn't capturing real difficulty
- [ ] **A/B test:** Show difficulty scores to 50% of users, measure if it affects movie selection or completion rates

### 8.3 Rebalanced Weight Distribution (Target)

After all phases are implemented and validated, the target weight distribution:

| Signal Group | Weight | Signals |
|---|---|---|
| Vocabulary complexity | 35% | weighted_complex (18%), hard_word_score (17%) |
| Lexical sophistication | 10% | collocations, MWEs, rare morphology |
| Syntactic complexity | 10% | clause density, tree depth, passive voice, nominalizations |
| Readability & structure | 10% | Flesch, sentence length buckets |
| Frequency & diversity | 10% | Zipf rarity, lexical diversity, repetition |
| Semantic complexity | 8% | abstractness, polysemy, semantic density |
| Pragmatic & discourse | 6% | indirect speech, cohesion, cultural refs |
| Cognitive load | 4% | surprisal, topic shifts |
| Other | 7% | median CEFR, spread, syllables, idiom density |

**Multipliers (unchanged):** Domain vocabulary (up to 1.25×), genre normalization

### 8.4 Future Content Type Expansions

#### Books (already partially supported)
- [ ] `BookText` model and `BookWordClassification` already exist in schema
- [ ] Apply same difficulty scorer — books have longer text, so syntactic and semantic signals will be even more discriminating
- [ ] Books will score higher on average (no subtitle flattening, full paragraphs preserved)
- [ ] **Key difference:** Books preserve paragraph structure → can compute paragraph-level signals (topic coherence, discourse structure)

#### Podcasts / Audio Content
- [ ] Requires speech-to-text transcript (e.g., Whisper API)
- [ ] After transcription, apply same text-based scorer
- [ ] Additional signal: **speech rate** (words per minute from timestamps) — faster speech = harder
- [ ] Additional signal: **speaker count** — more speakers with overlapping dialogue = harder

#### News Articles
- [ ] Clean text input — no subtitle parsing needed
- [ ] Higher baseline on semantic density, nominalization, cohesion devices
- [ ] Additional signal: **headline complexity** vs body complexity gap
- [ ] Can categorize by section (politics, science, sports) for automatic domain detection

#### User-Generated Text
- [ ] Allow users to paste any text for difficulty scoring
- [ ] Create `POST /api/analyze/text` endpoint — runs scorer on arbitrary input
- [ ] No genre/movie-specific signals — rely purely on text-based signals
- [ ] Useful for: students checking if a text is at their level, teachers selecting materials

---

## Dependency Graph

```
Phase 1 (Morphosyntax)     ──┐
Phase 2 (Lexical)          ──┼── All feed into scorer rebalancing
Phase 3 (Semantic)         ──┤
Phase 4 (Pragmatic)        ──┤
Phase 5 (Cognitive Load)   ──┘
                              │
                              ▼
                    Validation & Weight Tuning (8.1–8.3)
                              │
Phase 6 (User Tracking)    ───┤
                              ▼
                    Phase 7 (Adaptive Learning)
                              │
                              ▼
                    Phase 8.4 (Future Content Types)
```

- Phases 1–5 are **independent** of each other — can be implemented in any order or in parallel
- Phase 6 (user tracking) is **independent** of phases 1–5 — can start immediately
- Phase 7 (adaptive learning) **depends on** Phase 6 (needs interaction data)
- Validation (8.1–8.3) should happen **after each phase**, not only at the end

---

## Recommended Implementation Order

| Priority | Phase | Effort | Impact | Rationale |
|----------|-------|--------|--------|-----------|
| 🔴 P0 | **Phase 6.1** — Mobile word saving | S | High | Unblocks all user tracking; already built on web |
| 🔴 P0 | **Phase 6.2** — Interaction tracking | M | High | Foundation for all personalization; lightweight backend |
| 🟡 P1 | **Phase 1** — Morphosyntax | M | High | Biggest scoring gap; spaCy gives 4 signals at once |
| 🟡 P1 | **Phase 3.1** — Abstractness | S | Medium | Single CSV lookup, high discriminative power |
| 🟢 P2 | **Phase 2** — Lexical sophistication | L | Medium | Collocation PMI requires corpus preprocessing |
| 🟢 P2 | **Phase 4** — Pragmatic/discourse | M | Medium | Curated lists + spaCy NER |
| 🟢 P2 | **Phase 7** — Adaptive learning | L | High | Depends on P0 phases having enough data |
| 🔵 P3 | **Phase 3.2–3.4** — Full semantic | M | Medium | WordNet + pronoun tracking |
| 🔵 P3 | **Phase 5** — Cognitive load | M | Low–Med | Experimental; needs validation |
| 🔵 P3 | **Phase 8.4** — Other content types | L | Medium | Only after core scoring is stable |

**S** = Small (1–2 days), **M** = Medium (3–5 days), **L** = Large (1–2 weeks)
