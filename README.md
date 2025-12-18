# WordWise - Language Learning Through Movies

WordWise is a vocabulary learning platform that helps users learn English by analyzing movie scripts. Users can study words from their favorite movies, track their progress, and improve their language skills through engaging content.

## Features

- **Movie Script Analysis** - Automatic download from subtitles (Subliminal) and STANDS4 PDFs
- **Hybrid CEFR Classifier** - Multi-source word difficulty classification (A1-C2)
  - CEFR wordlists (Oxford 3000/5000, EFLLex, EVP)
  - Frequency-based backoff (wordfreq)
  - Lemmatization with NLTK WordNet
  - Genre-aware classification (kids/family movies get conservative levels)
  - Foreign word filtering (Italian, Spanish, French, etc.)
  - Contraction fragment filtering
- **Idiom & Phrasal Verb Detection** - Context-aware translation
  - 350+ idioms and phrasal verbs detected automatically
  - Dedicated "Idioms" tab showing all detected expressions
  - Shows both literal translation and idiomatic meaning
  - CEFR level badges for expressions (purple=idiom, teal=phrasal verb)
  - O(1) lookup via word→idiom Map in Web Worker
- **Sentence Examples Enrichment** - Learn words in context
  - Manual enrichment via "Enrich with sentence examples" button
  - Extracts representative sentences from movie scripts
  - Batch translation with rate limiting (~$0.15/movie/language)
  - Real-time status tracking (not_started → enriching → ready)
- **Personalized Word Lists** - Learn Later, Favorites, Mastered
- **Translation System** - Hybrid DeepL + Google Translate with caching
- **User Language Preferences** - Native language and learning language selection
- **Google OAuth Authentication** - Secure login without passwords
- **PostgreSQL + Prisma ORM** - Type-safe database operations
- **Web Worker Vocabulary Engine** - 10-100x faster rendering with TanStack Virtual
- **Material-UI** - Beautiful, responsive interface with smooth animations
- **MUI-Based Word Rows** - Card design with smooth expand/collapse via MUI Collapse

## Tech Stack

### Backend
- Python 3.11+
- FastAPI - Modern, fast web framework
- Prisma - Type-safe database ORM
- PostgreSQL - Primary database
- NLTK WordNet - Lemmatization
- wordfreq - Frequency-based word classification
- DeepL API - Primary translation provider
- Google Cloud Translate - Fallback translation provider
- pdfplumber - PDF text extraction
- Subliminal - Subtitle downloading

### Frontend
- React 19 - UI library
- Vite 7 - Build tool and dev server
- TypeScript - Type safety
- Material-UI - Component library
- TanStack Virtual - High-performance list virtualization
- Web Workers - Off-thread vocabulary processing
- Axios - HTTP client
- React Router - Client-side routing

### Infrastructure
- PostgreSQL 15 - Primary database
- Docker & Docker Compose - Optional containerization

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 20+
- PostgreSQL 15+

### Local Development

#### Backend

```bash
cd backend

# Install dependencies
pip install -r requirements.txt

# Download NLTK data
python -c "import nltk; nltk.download('wordnet'); nltk.download('omw-1.4')"

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Generate Prisma client
prisma generate

# Apply database schema
prisma db push

# (Optional) Download CEFR wordlists
python -m src.utils.download_cefr_data

# Start the server
uvicorn src.main:app --reload --port 8000
```

#### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Start dev server
npm run dev
```

## Project Structure

```
wordwise/
├── backend/
│   ├── prisma/
│   │   └── schema.prisma           # Database schema
│   ├── data/
│   │   └── cefr/                   # CEFR wordlist files
│   ├── src/
│   │   ├── routes/
│   │   │   ├── auth.py             # Email authentication
│   │   │   ├── oauth.py            # Google OAuth
│   │   │   ├── movies.py           # Movie endpoints
│   │   │   ├── scripts.py          # Script fetching
│   │   │   ├── cefr.py             # CEFR classification
│   │   │   ├── translation.py      # Translation API
│   │   │   ├── enrichment.py       # Sentence examples enrichment
│   │   │   ├── user_words.py       # Saved/learned words
│   │   │   └── tmdb.py             # TMDB integration
│   │   ├── services/
│   │   │   ├── cefr_classifier.py  # CEFR classification logic
│   │   │   ├── difficulty_scorer.py # Movie difficulty scoring
│   │   │   ├── translation_service.py # Translation with caching
│   │   │   ├── script_ingestion_service.py # Script fetching
│   │   │   ├── sentence_example_service.py # Sentence extraction
│   │   │   ├── example_translation_service.py # Batch sentence translation
│   │   │   └── external/           # External API integrations
│   │   ├── schemas/                # Pydantic models
│   │   ├── middleware/             # Auth middleware
│   │   ├── utils/
│   │   │   ├── tmdb_client.py      # TMDB API client
│   │   │   ├── deepl_client.py     # DeepL API client
│   │   │   ├── google_translate_client.py
│   │   │   └── subtitle_parser.py  # SRT parsing
│   │   ├── config.py               # Environment config
│   │   ├── database.py             # Prisma connection
│   │   └── main.py                 # FastAPI app
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── HomePage.tsx        # Landing page
│   │   │   ├── MovieSearchPage.tsx # Search movies
│   │   │   ├── MovieDetailPage.tsx # Movie vocabulary view
│   │   │   ├── SavedWordsPage.tsx  # Saved words list
│   │   │   ├── LoginPage.tsx       # Login form
│   │   │   └── SignUpPage.tsx      # Registration form
│   │   ├── components/
│   │   │   ├── VocabularyView.tsx  # Main vocabulary display
│   │   │   ├── WordListWorkerBased.tsx # Worker-powered word list
│   │   │   ├── VirtualizedWordList.tsx # TanStack Virtual list
│   │   │   ├── WordRow.tsx         # Expandable word row with MUI Collapse
│   │   │   ├── EnrichmentStatus.tsx # Sentence enrichment status/button
│   │   │   ├── TopBar.tsx          # Navigation bar
│   │   │   └── LanguageSelector.tsx # Language picker
│   │   ├── workers/
│   │   │   └── vocabulary.worker.ts # Web Worker for processing
│   │   ├── hooks/
│   │   │   ├── useVocabularyWorker.ts
│   │   │   ├── useTranslationQueue.ts
│   │   │   └── useUserWords.ts
│   │   ├── contexts/
│   │   │   ├── AuthContext.tsx     # Authentication state
│   │   │   ├── LanguageContext.tsx # Language preferences
│   │   │   └── ThemeContext.tsx    # Dark/light mode
│   │   ├── services/               # API service functions
│   │   ├── types/                  # TypeScript interfaces
│   │   ├── App.tsx                 # Router configuration
│   │   └── main.tsx                # Entry point
│   ├── vite.config.ts
│   └── package.json
├── docker/
│   ├── Dockerfile.backend
│   ├── Dockerfile.frontend
│   └── nginx.conf
├── docker-compose.yml
├── CHANGELOG.md
└── ROADMAP.md
```

## API Documentation

Once the backend is running, visit:
- **Swagger UI:** http://localhost:8000/docs
- **ReDoc:** http://localhost:8000/redoc

### Key API Endpoints

**Authentication:**
- `POST /auth/register` - Register with email/password
- `POST /auth/login` - Login with email/password
- `POST /auth/google/login` - Login/signup with Google OAuth
- `GET /auth/me` - Get current user
- `PATCH /auth/me` - Update user profile (language preferences)
- `GET /auth/languages` - Get supported languages list

**Movies:**
- `GET /movies/search` - Search movies via TMDB
- `GET /movies/{id}` - Get movie details
- `GET /movies/{id}/vocabulary/full` - Get classified vocabulary

**Scripts:**
- `POST /api/scripts/fetch` - Fetch movie script (subtitles → STANDS4)

**CEFR Classification:**
- `POST /api/cefr/classify-word` - Classify a single word
- `POST /api/cefr/classify-text` - Classify all words in text
- `GET /api/cefr/statistics/{movie_id}` - Get classification statistics
- `GET /api/cefr/health` - Check classifier status

**Translation:**
- `POST /translate` - Translate single word
- `POST /translate/batch` - Translate multiple words
- `GET /translate/user/{user_id}/difficult-words` - Get frequently translated words
- `GET /translate/user/{user_id}/stats` - Get translation statistics

**Enrichment (Sentence Examples):**
- `GET /api/enrichment/movies/{movie_id}/status` - Check enrichment status
- `POST /api/enrichment/movies/{movie_id}/start` - Start background enrichment
- `GET /api/enrichment/movies/{movie_id}/examples` - Get all word examples for movie
- `GET /api/enrichment/movies/{movie_id}/examples/{word}` - Get examples for specific word

**User Words:**
- `GET /user/words` - Get all saved words
- `POST /user/words` - Save a word
- `DELETE /user/words/{word}` - Remove saved word
- `POST /user/words/{word}/learned` - Mark word as learned

## Database

### Prisma Commands

```bash
# Generate Prisma client
prisma generate

# Apply schema changes
prisma db push

# Open Prisma Studio (database GUI)
prisma studio

# Create migration (for production)
prisma migrate dev --name migration_name
```

### Key Models

- **User** - OAuth profiles, language preferences (nativeLanguage, learningLanguage)
- **Movie** - Movie metadata from TMDB
- **MovieScript** - Full script text from subtitles/STANDS4
- **WordClassification** - CEFR levels for all words in scripts
- **WordSentenceExample** - Sentence examples with translations for vocabulary words
- **UserWord** - User's saved words with movie associations
- **TranslationCache** - Cached translations by language pair
- **UserTranslationHistory** - Track translations for learning analytics

## Performance

### CEFR Classifier
- Single word: <1ms
- Short text (100 words): ~50ms
- Full movie script (10K words): 1-2 seconds

### Frontend (Web Worker System)
- Initial render (5K words): ~45ms (10x faster than before)
- Tab switch: ~12ms (23x faster)
- Scroll: 60fps (smooth)
- DOM nodes: ~15 (8x fewer than before)

## Environment Variables

### Backend (.env)
```bash
DATABASE_URL="postgresql://user:password@localhost:5432/wordwise_db"
JWT_SECRET_KEY="your-secret-key"
GOOGLE_CLIENT_ID="your-google-client-id"
DEEPL_API_KEY="your-deepl-api-key"
GOOGLE_TRANSLATE_CREDENTIALS="path/to/credentials.json"
STANDS4_USER_ID="your-stands4-user-id"
STANDS4_TOKEN="your-stands4-token"
```

### Frontend (.env)
```bash
VITE_API_URL="http://localhost:8000"
VITE_GOOGLE_CLIENT_ID="your-google-client-id"
VITE_TMDB_API_KEY="your-tmdb-api-key"
```

## Development Guidelines

- Follow PEP 8 for Python code
- Use TypeScript for all frontend code
- Write tests for critical functionality
- Use meaningful commit messages
- No Docker required (direct Python/Node development)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Write tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues and questions, please open an issue on GitHub.
