# Changelog

All notable changes to the WordWise project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
