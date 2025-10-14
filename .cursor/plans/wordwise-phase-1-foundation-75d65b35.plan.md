<!-- 75d65b35-22ad-4224-848a-792b1b62a056 701a8a9b-84ae-4922-a97a-67c4d5bde82a -->
# WordWise Phase 1: Foundation Setup

## Overview

Build the foundational infrastructure for WordWise - a language learning platform that analyzes movie scripts to help users learn vocabulary. This phase focuses on creating a solid, scalable foundation with proper architecture, authentication, and basic script parsing capabilities.

## Project Structure Setup

Create the monorepo structure for WordWise:

```
wordwise/
├── backend/              # Python/FastAPI backend
├── frontend/             # React/Next.js frontend
├── shared/               # Shared types and constants
├── docker/               # Docker configuration
├── scripts/              # Setup and utility scripts
└── docs/                 # Documentation
```

## Backend Development (Python/FastAPI)

**Key Files:**

- `backend/src/main.py` - FastAPI application entry point
- `backend/src/models/` - SQLAlchemy database models (User, Movie, Word, UserWordList)
- `backend/src/routes/` - API endpoints (auth, movies, words, users)
- `backend/src/services/script_parser.py` - Basic script parsing logic
- `backend/src/middleware/auth.py` - JWT authentication middleware
- `backend/requirements.txt` - Python dependencies (FastAPI, SQLAlchemy, psycopg2, python-jose, bcrypt, NLTK, spaCy)

**Database Models:**

- User (id, email, password_hash, language_preference, proficiency_level)
- Movie (id, title, year, difficulty_level, script_text, word_count)
- Word (id, word, definition, difficulty_level, frequency)
- UserWordList (user_id, word_id, list_type: learn_later/favorites/mastered)

**API Endpoints:**

- POST /auth/register - User registration
- POST /auth/login - User login with JWT
- GET /movies - List movies with pagination
- POST /movies - Upload movie script (admin)
- GET /movies/{id} - Get movie details with word analysis
- POST /users/words - Add word to user list
- GET /users/me/words - Get user's word lists

## Frontend Development (React/Next.js)

**Key Files:**

- `frontend/src/pages/_app.tsx` - Next.js app wrapper
- `frontend/src/pages/index.tsx` - Landing page
- `frontend/src/pages/auth/login.tsx` - Login page
- `frontend/src/pages/auth/register.tsx` - Registration page
- `frontend/src/pages/movies/index.tsx` - Movies list page
- `frontend/src/components/common/` - Reusable components (Button, Input, Card)
- `frontend/src/services/api.ts` - Axios API client with interceptors
- `frontend/src/store/` - Redux slices (auth, movies, user)
- `frontend/tailwind.config.js` - Tailwind CSS configuration

**Key Features:**

- Authentication flow (login/register/logout)
- Movie browsing with difficulty filters
- Responsive design with Tailwind CSS
- JWT token management with automatic refresh

## Database Setup (PostgreSQL)

**Key Files:**

- `backend/alembic/` - Database migrations
- `backend/src/database.py` - Database connection and session management
- `docker/docker-compose.yml` - PostgreSQL service configuration

**Initial Schema:**

- Users table with authentication fields
- Movies table with script content
- Words table with definitions and difficulty levels
- User_word_lists junction table

## Docker Configuration

**Key Files:**

- `docker/Dockerfile.backend` - Python/FastAPI container
- `docker/Dockerfile.frontend` - Node.js/Next.js container
- `docker/docker-compose.yml` - Multi-container setup (backend, frontend, PostgreSQL, Redis)
- `.dockerignore` - Exclude unnecessary files

**Services:**

- backend: FastAPI on port 8000
- frontend: Next.js on port 3000
- postgres: PostgreSQL on port 5432
- redis: Redis on port 6379 (for future caching)

## Configuration & Environment

**Key Files:**

- `backend/.env.example` - Backend environment variables template
- `frontend/.env.local.example` - Frontend environment variables template
- `.gitignore` - Ignore node_modules, .env, **pycache**, etc.

**Environment Variables:**

- DATABASE_URL, JWT_SECRET_KEY, JWT_ALGORITHM
- NEXT_PUBLIC_API_URL

## Basic Script Parsing

**Key Files:**

- `backend/src/services/script_parser.py` - Parse movie scripts (SRT, TXT formats)
- `backend/src/services/word_analyzer.py` - Tokenize and analyze word frequency using NLTK

**Functionality:**

- Extract dialogue from script files
- Tokenize text into words
- Calculate word frequency
- Basic difficulty estimation (using wordfreq library)

## Documentation

**Key Files:**

- `README.md` - Project overview and setup instructions
- `docs/API.md` - API endpoint documentation
- `docs/SETUP.md` - Development environment setup guide
- `docs/ARCHITECTURE.md` - System architecture overview

## Implementation Steps

1. Initialize project structure and Git repository
2. Set up backend with FastAPI, SQLAlchemy, and Alembic
3. Create database models and initial migration
4. Implement JWT authentication endpoints
5. Set up frontend with Next.js, TypeScript, and Tailwind CSS
6. Create authentication UI components and pages
7. Implement basic movie CRUD endpoints
8. Build script parser service with NLTK
9. Create Docker configuration for all services
10. Set up docker-compose for local development
11. Write documentation and setup guides
12. Test end-to-end authentication and movie upload flow

## Success Criteria

- User can register and login with JWT authentication
- Admin can upload movie scripts via API
- Scripts are parsed and stored in PostgreSQL
- Basic word frequency analysis works
- Frontend displays movies list
- All services run via docker-compose
- API documentation is complete
- Setup guide allows new developers to run locally

### To-dos

- [ ] Create WordWise monorepo structure with backend, frontend, shared, docker, scripts, and docs directories
- [ ] Initialize Python/FastAPI backend with requirements.txt, main.py, and folder structure
- [ ] Create SQLAlchemy models for User, Movie, Word, and UserWordList with Alembic migrations
- [ ] Implement JWT authentication endpoints (register, login) with password hashing
- [ ] Create movie CRUD endpoints (list, get, create) with pagination
- [ ] Build script parser service using NLTK for tokenization and word frequency analysis
- [ ] Initialize Next.js frontend with TypeScript, Tailwind CSS, and Redux Toolkit
- [ ] Create login and registration pages with form validation and JWT token management
- [ ] Build movies list page with filtering and movie detail view
- [ ] Create Dockerfiles for backend and frontend, and docker-compose.yml with PostgreSQL and Redis
- [ ] Write README, API documentation, setup guide, and architecture overview
- [ ] Test end-to-end flow: user registration, login, movie upload, and script parsing