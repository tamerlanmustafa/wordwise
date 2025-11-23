# WordWise - Language Learning Through Movies

WordWise is an innovative language learning platform that helps users learn English vocabulary by analyzing movie scripts. Users can study words from their favorite movies, track their progress, and improve their language skills through engaging content.

## Features

- 🎬 **Movie Script Analysis** - Automatic download and extraction from STANDS4 PDFs
- 📊 **Hybrid CEFR Classifier** - Multi-source word difficulty classification (A1-C2)
  - CEFR wordlists (Oxford 3000/5000, EFLLex, EVP)
  - Frequency-based backoff (wordfreq)
  - ML-powered embedding classifier (sentence-transformers)
  - Lemmatization with spaCy
- 📚 **Personalized Word Lists** - Learn Later, Favorites, Mastered
- 🔐 **Google OAuth Authentication** - Secure login without passwords
- 💾 **PostgreSQL + Prisma ORM** - Type-safe database operations
- 🎨 **Material-UI** - Beautiful, responsive interface

## Tech Stack

### Backend
- Python 3.11+
- FastAPI - Modern, fast web framework
- Prisma - Type-safe database ORM
- PostgreSQL - Primary database
- spaCy - Lemmatization and NLP
- wordfreq - Frequency-based word classification
- sentence-transformers - ML word embeddings
- scikit-learn - CEFR classification models
- pdfplumber - PDF text extraction

### Frontend
- React 19 - UI library
- Vite 7 - Build tool and dev server
- TypeScript - Type safety
- Material-UI - Component library
- Redux Toolkit - State management
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

# Download spaCy model
python -m spacy download en_core_web_sm

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Generate Prisma client
prisma generate

# Apply database schema
prisma db push

# (Optional) Download CEFR wordlists
python -m src.utils.download_cefr_data

# (Optional) Train embedding classifier
python -m src.utils.train_embedding_classifier --model all

# Start the server
uvicorn src.main:app --reload --port 8000
```

**CEFR Classifier Setup:**
1. Populate CEFR wordlists in `backend/data/cefr/` (Oxford 3000/5000, EFLLex, EVP)
2. Train the embedding classifier (optional, for rare words)
3. Adjust frequency thresholds via API if needed

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
│   │   └── schema.prisma    # Database schema
│   ├── src/
│   │   ├── routes/          # API routes
│   │   ├── services/        # Business logic
│   │   ├── middleware/      # Custom middleware
│   │   ├── database.py      # Prisma connection
│   │   └── main.py          # FastAPI app
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/           # React pages
│   │   ├── components/      # React components
│   │   ├── services/        # API services
│   │   ├── store/           # Redux store
│   │   ├── App.tsx          # Router configuration
│   │   └── main.tsx         # Entry point
│   ├── vite.config.ts
│   └── package.json
├── docker/
│   ├── Dockerfile.backend   # Backend Docker image
│   ├── Dockerfile.frontend  # Frontend Docker image
│   └── nginx.conf           # Production nginx config
└── docker-compose.yml
```

## API Documentation

Once the backend is running, visit:
- **Swagger UI:** http://localhost:8000/docs
- **ReDoc:** http://localhost:8000/redoc

### Key API Endpoints

**Authentication:**
- `POST /auth/google/login` - Login with Google OAuth
- `POST /auth/google/signup` - Sign up with Google OAuth

**Movie Scripts:**
- `POST /api/scripts/fetch` - Fetch and save movie script from STANDS4

**CEFR Classification:**
- `POST /api/cefr/classify-word` - Classify a single word
- `POST /api/cefr/classify-text` - Classify all words in text
- `POST /api/cefr/classify-script` - Classify entire movie script
- `GET /api/cefr/statistics/{movie_id}` - Get cached classification statistics
- `PUT /api/cefr/update-thresholds` - Adjust frequency thresholds
- `GET /api/cefr/health` - Check classifier status

**General:**
- `GET /health` - API health check

## Database

### Prisma Commands

```bash
# Generate Prisma client
prisma generate

# Apply schema changes (no migrations)
prisma db push

# Open Prisma Studio (database GUI)
prisma studio

# (Optional) Create migration
prisma migrate dev --name migration_name
```

### Database Schema

The database includes:
- **Users** - OAuth profiles and preferences
- **Movies** - Movie metadata
- **MovieScripts** - Full script text from STANDS4 PDFs
- **WordClassification** - CEFR levels for all words in scripts
- **Words** - Vocabulary with definitions
- **UserWordLists** - Personalized word collections

## Development Guidelines

- Follow PEP 8 for Python code
- Use TypeScript for all frontend code
- Write tests for critical functionality
- Use meaningful commit messages
- No Docker required (direct Python/Node development)

## Performance

- **Vite dev server:** 10x faster than Next.js
- **Docker builds:** 60-87% faster with multi-stage caching
- **Image sizes:** 75-94% smaller with optimized builds
- **Hot reload:** Instant with Vite HMR

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
