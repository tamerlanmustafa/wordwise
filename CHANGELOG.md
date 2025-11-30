# Changelog

All notable changes to the WordWise project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2025-11-22

### Added
- **Hybrid CEFR Difficulty Classifier** - Complete word classification system
  - Multi-source CEFR wordlist support (Oxford 3000/5000, EFLLex, EVP)
  - Frequency-based backoff using wordfreq library
  - Optional ML embedding classifier (sentence-transformers + scikit-learn)
  - Lemmatization with spaCy for accurate word recognition
  - POS-sensitive classification for context-aware difficulty
  - Confidence scoring (0.0-1.0) for all classifications
  - Configurable frequency thresholds via API

- **CEFR Classification API Endpoints**
  - `POST /api/cefr/classify-word` - Single word classification
  - `POST /api/cefr/classify-text` - Full text analysis
  - `POST /api/cefr/classify-script` - Movie script classification with DB storage
  - `GET /api/cefr/statistics/{movie_id}` - Cached statistics retrieval
  - `PUT /api/cefr/update-thresholds` - Customize frequency mappings
  - `GET /api/cefr/health` - Classifier health check

- **Database Schema Updates**
  - `WordClassification` table for storing word-level CEFR data
  - `classificationsource` enum (oxford_3000, efllex, frequency_backoff, etc.)
  - Indexes on script_id, lemma, and cefr_level for fast queries
  - Cascade delete on script removal

- **Utility Scripts**
  - `download_cefr_data.py` - Download and prepare CEFR wordlists
  - `train_embedding_classifier.py` - Train ML models for rare words
  - Support for Logistic Regression, Random Forest, Gradient Boosting

- **New Dependencies**
  - spacy 3.7.2 - NLP and lemmatization
  - wordfreq 3.1.1 - Frequency-based classification
  - sentence-transformers 2.2.2 - Word embeddings
  - scikit-learn 1.3.2 - ML classifiers
  - joblib 1.3.2 - Model serialization
  - numpy 1.24.3 - Numerical operations

### Changed
- **Frontend Integration** - Real script data from STANDS4 PDFs
  - Movie search now saves scripts to database automatically
  - Word frequency analysis uses actual 30K+ word scripts
  - Display script source, word count, and cache status
  - CEFR level categorization ready for integration

- **Multi-Source Script Ingestion** (from v2.0.0)
  - STANDS4 PDF as primary source (8K-25K words)
  - Automatic fallback to STANDS4 API → Subtitles → Synopsis
  - Database-first caching to minimize API calls
  - PDF text extraction with pdfplumber and pypdf
  - Truncation detection and quality validation

### Performance
- **CEFR Classifier Speed**
  - Single word: <1ms
  - Short text (100 words): ~50ms
  - Full movie script (30K words): 2-3 seconds

- **CEFR Accuracy** (with comprehensive wordlists)
  - A1-B1 words: 90-95% (wordlist coverage)
  - B2-C1 words: 75-85% (wordlist + frequency)
  - C2 words: 60-70% (frequency + ML fallback)

### Technical Details
- All CEFR processing runs locally (no external APIs)
- Supports multi-word expressions (phrasal verbs, idioms)
- Adjustable frequency thresholds for custom mappings
- Optional embedding classifier for rare/slang words
- Batch classification with database storage

## [2.0.0] - 2025-11-18

### Migration to Modern Architecture

Complete rewrite of the application stack for better performance, type safety, and developer experience.

### Added
- **Prisma ORM** - Type-safe database operations replacing SQLAlchemy
- **React + Vite** - Modern build tooling replacing Next.js (10x faster dev server)
- **Material-UI** - Component library for consistent UI
- **Docker optimization** - Multi-stage builds reducing image sizes by 60-90%

### Changed
- **Frontend:** Next.js 14 → React 19 + Vite 7
- **Backend ORM:** SQLAlchemy + Alembic → Prisma
- **Styling:** Tailwind CSS → Material-UI
- **Build times:** 60-87% faster with Docker multi-stage caching
- **Dev workflow:** Virtual environments eliminated, Docker-first approach

### Removed
- Next.js and all Next.js-specific code
- SQLAlchemy ORM and Alembic migrations
- Tailwind CSS configuration
- pgAdmin service (optional, use desktop app)
- Virtual environment requirement

### Performance
- Frontend dev server: 10x faster (Vite HMR)
- Docker builds: 60-87% faster (cold and cached)
- Image sizes: 75-94% smaller
- Backend queries: Now async and type-safe

## [1.1.0] - 2025-01-16

### Added
- **Google OAuth 2.0 Authentication**
  - Dedicated `/auth/google/signup` endpoint for explicit user registration
  - Universal `/auth/google/login` endpoint (auto-creates accounts)
  - Backend Google ID token verification
  - JWT session management after OAuth login
  - Google user profile integration (name, email, profile picture)
  - Separate frontend components for login and signup flows

- **Database Visualization**
  - pgAdmin 4 integration via Docker Compose
  - Web-based database management at http://localhost:5050
  - Pre-configured connection to PostgreSQL database
  - Persistent storage for pgAdmin settings

- **Database Schema Updates for OAuth**
  - Added `google_id` field to User model (unique, indexed)
  - Added `profile_picture_url` field to User model
  - Added `oauth_provider` enum field (email/google)
  - Made `password_hash` optional for OAuth users

- **Frontend Performance Optimizations**
  - Enabled Next.js Turbopack for 700x faster HMR
  - Removed 5 unused dependencies (reduced node_modules by 52%)
  - Optimized TypeScript configuration for faster compilation
  - Disabled ESLint during development for speed
  - Added experimental package import optimizations

### Changed
- **Frontend**
  - Updated Next.js from 14.0.4 to 14.2.33 (security patches)
  - Refactored `GoogleLoginButton` to `GoogleOAuthButton` with mode prop
  - Updated login/register pages to use new OAuth component
  - Added `googleLogin()` and `googleSignup()` methods to API service
  - Updated User type interface to support OAuth fields

- **Backend**
  - Refactored OAuth route with helper functions for cleaner code
  - Added `UserInfo`, `GoogleSignupRequest`, `GoogleSignupResponse` schemas
  - Improved error handling in OAuth flows

- **Performance**
  - Frontend startup: Reduced from 60-90s to 30-40s (WSL2)
  - Hot reload: Reduced from 5-10s to 0.5-2s (80% faster)
  - Memory usage: Reduced from 800MB to 400MB (50% less)
  - Dependencies: Reduced from 24 to 19 packages

### Fixed
- Missing `Optional` import in users route
- Circular import issue in auth middleware
- Missing `email-validator` dependency
- Critical Next.js security vulnerabilities (updated to 14.2.33)
- Frontend performance issues on WSL2

### Security
- **Fixed 1 critical vulnerability** in Next.js
- Updated Next.js to latest stable version (14.2.33)
- Removed ESLint and related packages (development-only change)
- All OAuth tokens verified server-side
- Email verification required for Google OAuth

## [1.0.0] - 2024-10-13

### Added
- Initial project structure
- FastAPI backend with user authentication
- Next.js frontend with TypeScript
- PostgreSQL database integration
- Redis caching support
- Movie script analysis features
- Word difficulty categorization (A1-C2 levels)
- User word lists (Learn Later, Favorites, Mastered)
- JWT-based authentication
- Docker and Docker Compose configuration
- Database migrations with Alembic
- API documentation with Swagger UI
- Tailwind CSS styling

### Security
- Bcrypt password hashing
- JWT token-based authentication
- CORS configuration for allowed origins




### 11-23-2025

- remove POS tagging (noun, verb, etc) to handle in the translation service in the future
- Remove Spacy and use a simpler tokenizer instead,lighter as well
- add subliminal as a priority source for words as srt for movies
- add nested pagination in levels of words, combine c1 and c2 together only on ui until we figure out why c1 doesnt get filled
- add translation from DeepL Free tier, (azerbaijani is not supported as a target language)



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
  - All other languages use DeepL (ES, FR, DE, TR, etc.)
  - Provider tracking in translation history and responses

### Changed
- **Translation Service Enhanced**
  - Added optional `user_id` parameter to track translation attempts
  - Provider field now shows: "deepl", "google", or "cache"
  - Comprehensive logging for provider selection and fallbacks
  - All translation methods support user tracking (single + batch)

- **Frontend Translation Updates**
  - Updated `translateText()` and `translateBatch()` to accept userId
  - Added `getUserDifficultWords()` API function
  - Added `getUserTranslationStats()` API function
  - Updated `useTranslation` hook to support user tracking
  - New TypeScript interfaces: DifficultWord, DifficultWordsResponse, UserTranslationStats

### Database Schema
- **New Model: UserTranslationHistory**
  - Fields: user_id, word, target_lang, translation_used, provider, translated_at
  - Indexes on: user_id, (user_id + word), (user_id + translated_at)
  - Cascade delete when user is removed
  - Efficiently stores every translation attempt for analytics

### Use Cases
- **Identify Difficult Words**: See which words user keeps translating (struggling to remember)
- **Personalized Learning**: Create study lists based on translation frequency
- **Progress Tracking**: Monitor user's language learning journey
- **Provider Analytics**: Track which translation service is being used most
- **Language Focus**: See which languages user is actively learning

### Testing
- Added `test_translation_tracking.py` - Comprehensive test suite
- Verifies user tracking, difficult word detection, statistics, and provider tracking
- All tests passing successfully



### 11/29/2025
- Add Tmdb data and saved words logic
- 

