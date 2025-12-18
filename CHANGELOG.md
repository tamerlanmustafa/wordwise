# Changelog

All notable changes to the WordWise project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.6.0] - 2025-12-18

### Added
- **Idioms Tab**
  - Dedicated tab showing all detected idioms and phrasal verbs in the movie
  - Purple badge for idioms, teal badge for phrasal verbs
  - CEFR level badges for each expression

- **Manual Enrichment Control**
  - "Enrich with sentence examples" button instead of automatic enrichment
  - User controls when to start sentence extraction and translation
  - Real-time status tracking: not_started → enriching → ready
  - Background processing via FastAPI BackgroundTasks

### Changed
- **MUI-Based Word Rows Redesign**
  - Complete WordRow redesign using MUI styled() components
  - Card-based design with subtle borders and backgrounds
  - Smooth expand/collapse via MUI Collapse component (150ms ease-in-out)
  - MUI icons replacing inline SVGs

- **Load-Then-Expand Pattern**
  - On click, show spinner while loading translation + examples in parallel
  - Wait up to 250ms for content, then expand
  - Eliminates flickering/glitching when expanding rows
  - Removed loading skeletons for cleaner UX

- **Backend Enrichment API**
  - `GET /api/enrichment/movies/{movie_id}/status` - returns not_started/enriching/ready
  - `POST /api/enrichment/movies/{movie_id}/start` - triggers background enrichment
  - Fixed status to return "not_started" instead of incorrectly showing "enriching"

## [2.5.0] - 2025-12-15

### Added
- **Context-Aware Translation & Idiom Detection**
  - Backend detects 350+ idioms/phrasal verbs from existing dictionary
  - Idiom data returned in CEFR classification response
  - Each idiom includes: phrase, type (idiom/phrasal_verb), CEFR level, component words
  - Fast O(1) idiom lookup via word→idiom Map in Web Worker

- **Context-Aware Translation Display**
  - When clicking a word that's part of an idiom, shows:
    - Literal word translation (e.g., "leg → нога")
    - Idiom context with translation (e.g., Part of: "pulling one's leg" — шутить)
    - CEFR level badge for the idiom
  - Purple badge for idioms, teal badge for phrasal verbs
  - No external APIs needed - reuses existing DeepL/Google translation

- **Sentence Examples Enrichment System**
  - WordSentenceExample database model for storing examples
  - Sentence extraction service with intelligent scoring (6-25 word sentences)
  - Batch translation service (25 sentences/batch, 500ms delay)
  - Enrichment API endpoints for manual triggering and status checking
  - Cost-efficient: ~$0.15 per movie per language

### Changed
- **Click-to-Expand Translation Pattern**
  - Translations only fetched when user clicks a word row
  - Eliminates batch translation overhead entirely
  - Zero initial translation load time, no rate limiting issues

- **Memory Management**
  - Backend CEFR caches use LRU with 50k max entries
  - Frontend worker translation Map uses LRU with 5k max entries
  - Caches cleared on movie/tab change
  - Prevents memory leaks in long sessions

- **UI Polish**
  - Smooth fade transitions when switching CEFR tabs
  - Virtualized list with dynamic row heights for expanded words
  - Scroll-to-top floating button
  - Row number alignment with word text

## [2.4.0] - 2025-12-11

### Added
- **User Language Preferences** - Native and learning language selection during signup
  - Added `nativeLanguage` and `learningLanguage` fields to User model
  - Language selection required for both email and Google OAuth signup
  - 30 supported languages (English, Spanish, French, German, Chinese, etc.)
  - `PATCH /auth/me` endpoint for updating language preferences
  - `GET /auth/languages` endpoint for supported languages list
  - Frontend language dropdowns on signup page

- **Google OAuth Language Support**
  - Language preferences passed during Google signup
  - AuthContext updated to handle language parameters
  - Languages stored on first login, preserved on subsequent logins

### Changed
- **Signup Flow** - Language selection now required before account creation
- **OAuth Schema** - GoogleLoginRequest accepts optional language fields

## [2.3.0] - 2025-12-10

### Added
- **CEFR Classification Improvements**
  - Improved lemmatization with multi-POS tag attempts (verb, noun, adj, adv)
  - Fixed irregular plural handling (thieves→thief, knives→knife, etc.)
  - Frequency validation for C1/C2 words using Zipf scores
  - Kids vocabulary whitelist (~130 words) for movie genre-aware classification
  - Informal/slang vocabulary whitelist for movie content

- **Foreign Word Filtering**
  - Added `FOREIGN_WORDS_FILTER` for Italian, Spanish, French, German, Japanese, Latin, Russian, Yiddish words
  - Prevents non-English words from movie scripts (Godfather, etc.) from being classified

- **Contraction Fragment Filtering**
  - Added `CONTRACTION_FRAGMENTS` set to filter tokenization artifacts
  - Handles: hasn, weren, hadn, mustn, wouldn, couldn, etc.

### Fixed
- Common verb forms now properly lemmatized (coming→come, laughed→laugh)
- C1/C2 misclassifications for common words (trusted, loved, vulgar)
- Proper noun detection for fantasy/foreign names

## [2.2.0] - 2025-11-24

### Added
- **User Translation Tracking System** - Track translation attempts to identify difficult words
  - New `UserTranslationHistory` table to record every translation attempt
  - Tracks: word, target language, translation used, provider, timestamp
  - Automatic tracking when user_id is provided in translation requests
  - No impact on performance - tracking runs async without blocking translations

- **Learning Analytics API Endpoints**
  - `GET /translate/user/{user_id}/difficult-words` - Get words translated multiple times
    - Customizable min_attempts threshold (default: 2)
    - Sorted by attempt count (highest first)
    - Shows first/last translation dates and providers used
  - `GET /translate/user/{user_id}/stats` - Get user translation statistics
    - Total translations count
    - Unique words count
    - Breakdown by language and provider
    - Most recent translation timestamp

- **Hybrid Translation Provider System**
  - DeepL as primary provider (31 supported languages)
  - Google Cloud Translate as fallback for unsupported languages
  - Automatic provider selection based on language support
  - Azerbaijani (AZ) automatically uses Google Translate fallback
  - Provider tracking in translation history and responses

- **TMDB Integration**
  - Movie metadata from TMDB API
  - Saved words logic with movie associations

### Changed
- **Translation Service Enhanced**
  - Added optional `user_id` parameter to track translation attempts
  - Provider field now shows: "deepl", "google", or "cache"
  - Comprehensive logging for provider selection and fallbacks

- **Frontend Translation Updates**
  - Updated `translateText()` and `translateBatch()` to accept userId
  - Added `getUserDifficultWords()` and `getUserTranslationStats()` API functions
  - New TypeScript interfaces: DifficultWord, DifficultWordsResponse, UserTranslationStats

## [2.1.1] - 2025-11-23

### Changed
- **Lighter NLP Stack**
  - Removed spaCy dependency (replaced with NLTK WordNet lemmatizer)
  - Simpler regex-based tokenization
  - Reduced backend memory footprint

- **Script Source Priority**
  - Subliminal (SRT subtitles) now primary source for movie scripts
  - STANDS4 PDF as secondary fallback
  - Better coverage for recent movies

- **Frontend UI Improvements**
  - Nested pagination for vocabulary levels
  - Combined C1/C2 display on UI
  - DeepL translation integration (Free tier)

## [2.1.0] - 2025-11-22

### Added
- **Hybrid CEFR Difficulty Classifier** - Complete word classification system
  - Multi-source CEFR wordlist support (Oxford 3000/5000, EFLLex, EVP)
  - Frequency-based backoff using wordfreq library
  - Optional ML embedding classifier (sentence-transformers + scikit-learn)
  - Lemmatization for accurate word recognition
  - Confidence scoring (0.0-1.0) for all classifications
  - Configurable frequency thresholds via API

- **CEFR Classification API Endpoints**
  - `POST /api/cefr/classify-word` - Single word classification
  - `POST /api/cefr/classify-text` - Full text analysis
  - `POST /api/cefr/classify-script` - Movie script classification with DB storage
  - `GET /api/cefr/statistics/{movie_id}` - Cached statistics retrieval
  - `GET /api/cefr/health` - Classifier health check

- **Database Schema Updates**
  - `WordClassification` table for storing word-level CEFR data
  - `classificationsource` enum (oxford_3000, efllex, frequency_backoff, etc.)
  - Indexes on script_id, lemma, and cefr_level for fast queries

- **Utility Scripts**
  - `download_cefr_data.py` - Download and prepare CEFR wordlists
  - `train_embedding_classifier.py` - Train ML models for rare words

### Performance
- **CEFR Classifier Speed**
  - Single word: <1ms
  - Short text (100 words): ~50ms
  - Full movie script (30K words): 2-3 seconds

## [2.0.0] - 2025-11-18

### Migration to Modern Architecture

Complete rewrite of the application stack for better performance, type safety, and developer experience.

### Added
- **Prisma ORM** - Type-safe database operations replacing SQLAlchemy
- **React + Vite** - Modern build tooling replacing Next.js (10x faster dev server)
- **Material-UI** - Component library for consistent UI
- **Docker optimization** - Multi-stage builds reducing image sizes by 60-90%
- **Web Worker Vocabulary System** - Off-thread processing for 10-100x faster rendering
- **TanStack Virtual** - High-performance list virtualization

### Changed
- **Frontend:** Next.js 14 → React 19 + Vite 7
- **Backend ORM:** SQLAlchemy + Alembic → Prisma
- **Styling:** Tailwind CSS → Material-UI
- **Build times:** 60-87% faster with Docker multi-stage caching

### Removed
- Next.js and all Next.js-specific code
- SQLAlchemy ORM and Alembic migrations
- Tailwind CSS configuration
- Virtual environment requirement

### Performance
- Frontend dev server: 10x faster (Vite HMR)
- Tab switch: 12ms (23x faster with Web Workers)
- Scroll: 60fps (smooth virtualization)
- DOM nodes: ~15 (8x fewer with TanStack Virtual)

## [1.1.0] - 2025-01-16

### Added
- **Google OAuth 2.0 Authentication**
  - Universal `/auth/google/login` endpoint (auto-creates accounts)
  - Backend Google ID token verification
  - JWT session management after OAuth login
  - Google user profile integration (name, email, profile picture)

- **Database Schema Updates for OAuth**
  - Added `google_id` field to User model (unique, indexed)
  - Added `profile_picture_url` field to User model
  - Added `oauth_provider` enum field (email/google)
  - Made `password_hash` optional for OAuth users

### Fixed
- Missing `Optional` import in users route
- Circular import issue in auth middleware
- Missing `email-validator` dependency

## [1.0.0] - 2024-10-13

### Added
- Initial project structure
- FastAPI backend with user authentication
- Next.js frontend with TypeScript
- PostgreSQL database integration
- Movie script analysis features
- Word difficulty categorization (A1-C2 levels)
- User word lists (Learn Later, Favorites, Mastered)
- JWT-based authentication
- Docker and Docker Compose configuration
- API documentation with Swagger UI

### Security
- Bcrypt password hashing
- JWT token-based authentication
- CORS configuration for allowed origins

---

# Roadmap

## Recent Accomplishments

### Context-Aware Translation (Completed 2025-12-18)
- [x] **Level 1: Sentence-aware translation** - Display sentence examples from movie scripts with translations
  - Added `WordSentenceExample` database model
  - Created sentence extraction service with intelligent scoring (6-25 word sentences)
  - Created batch translation service (25 sentences/batch, 500ms delay)
  - Built enrichment API endpoints (POST for enriching, GET for fetching)
  - Integrated sentence examples into WordRow UI with expand/collapse
  - Fixed row overlap issue with dynamic height measurement
  - **Manual enrichment**: User-controlled via button click
  - **Status tracking**: Real-time enrichment status UI with polling
  - **Cost-efficient**: ~$0.15 per movie per language, deduplicated

**Technical Implementation:**
- Backend: FastAPI BackgroundTasks for async enrichment
- Frontend: EnrichmentStatus component with 10-second polling
- Database: Prisma ORM with indexed queries
- Translation: Batch processing with rate limiting
- UI: TanStack Virtual with dynamic row heights, MUI Collapse for smooth animations

## Short-Term Priorities

### 1. Rate Limiting & Security
- [ ] Add rate limiting to auth endpoints (prevent brute force)
- [ ] Add rate limiting to translation endpoints (protect API quotas)
- [ ] Validate translation input length (max 500 chars)
- [ ] Implement request timeouts for external APIs

### 2. Error Monitoring
- [ ] Set up error monitoring (Sentry or similar)
- [ ] Add graceful error states in UI for failed translations
- [ ] Improve error messages for common failures

### 3. Search & Filter in Vocabulary
- [ ] Real-time search within vocabulary lists
- [ ] Filter by: saved, learned
- [ ] Sort options: alphabetical, frequency, confidence

### 4. Translation Language Sync
- [ ] Sync LanguageContext with user's native_language from profile
- [ ] Auto-set translation target language based on user preferences

### 5. Redis Cache Layer
- [ ] Replace database-based TranslationCache with Redis
- [ ] Enable distributed caching for horizontal scaling
- [ ] Add TTL-based cache expiration (30 days for translations)

### 6. IndexedDB Persistence
- [ ] Cache translations in IndexedDB (survive page refresh)
- [ ] Cache vocabulary data for offline access
- [ ] Sync with server on reconnection

### 7. Progress Dashboard
- [ ] Visual learning progress tracking
- [ ] Words learned over time charts
- [ ] Difficult words analysis (frequently translated)

### 8. Named Entity Recognition
- [ ] Better detection of proper nouns and character names
- [ ] Use spaCy NER or similar for accurate detection
- [ ] Reduce false positives in fantasy content

### 9. Test Suite
- [ ] Add comprehensive pytest test suite for backend
- [ ] Add Jest tests for frontend components
- [ ] Document all API endpoints with examples

### 10. Spaced Repetition System (SRS)
- [ ] Implement SM-2 or similar algorithm
- [ ] Schedule word reviews based on retention
- [ ] Gamification with streaks
