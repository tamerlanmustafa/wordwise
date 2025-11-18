# WordWise - Language Learning Through Movies

WordWise is an innovative language learning platform that helps users learn English vocabulary by analyzing movie scripts. Users can study words from their favorite movies, track their progress, and improve their language skills through engaging content.

## Features

- 🎬 Movie script analysis with word frequency tracking
- 📚 Personalized word lists (Learn Later, Favorites, Mastered)
- 🎯 Difficulty-based categorization (A1-C2 levels)
- 🔐 Google OAuth & traditional authentication
- 💾 PostgreSQL database with pgAdmin visualization
- 🎨 Beautiful, responsive UI with Tailwind CSS
- ⚡ Optimized frontend with Next.js Turbopack

## Tech Stack

### Backend
- Python 3.11+
- FastAPI - Modern, fast web framework
- SQLAlchemy - ORM for database operations
- PostgreSQL - Primary database
- Redis - Caching and session management
- NLTK & spaCy - Natural language processing
- Alembic - Database migrations

### Frontend
- Next.js 14.2 with Turbopack - React framework with ultra-fast HMR
- TypeScript - Type safety
- Tailwind CSS - Utility-first CSS
- Redux Toolkit - State management
- Axios - HTTP client
- Google OAuth - Social authentication

### Infrastructure
- Docker & Docker Compose - Containerization
- PostgreSQL - Primary database
- pgAdmin 4 - Database visualization tool
- Redis - Caching and sessions

## Quick Start

### Prerequisites
- Docker and Docker Compose (for Docker setup)
- Python 3.11+, Node.js 18+, PostgreSQL, Redis (for local setup)

### Using Helper Scripts (Recommended for Local Development)

**Start Backend:**
```bash
./start-backend.sh
```

**Start Frontend:**
```bash
./start-frontend.sh
```

**Access the application:**
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API Documentation: http://localhost:8000/docs
- pgAdmin: http://localhost:5050 (email: admin@wordwise.com, password: admin)

For detailed local setup instructions, see [README-LOCAL-DEV.md](README-LOCAL-DEV.md)

### Using Docker

1. Clone and start services:
```bash
git clone <repository-url>
cd wordwise
docker compose up -d
```

2. Run database migrations:
```bash
docker compose exec backend alembic upgrade head
```

3. Access the application at http://localhost:3000

### Common Docker Commands

```bash
# Start services
docker compose up -d

# Stop services
docker compose down

# View logs
docker compose logs -f

# Restart a service
docker compose restart backend
```

### Local Development

#### Backend Setup

1. Navigate to backend directory:
```bash
cd backend
```

2. Create virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

5. Run database migrations:
```bash
alembic upgrade head
```

6. Start the server:
```bash
uvicorn src.main:app --reload
```

#### Frontend Setup

1. Navigate to frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.local.example .env.local
# Edit .env.local with your configuration
```

4. Start the development server:
```bash
npm run dev
```

## Project Structure

```
wordwise/
├── backend/              # Python/FastAPI backend
│   ├── src/
│   │   ├── models/       # Database models
│   │   ├── routes/       # API routes
│   │   ├── services/     # Business logic
│   │   ├── middleware/   # Custom middleware
│   │   └── utils/        # Utility functions
│   ├── alembic/          # Database migrations
│   └── requirements.txt  # Python dependencies
├── frontend/             # Next.js frontend
│   ├── src/
│   │   ├── pages/        # Next.js pages
│   │   ├── components/   # React components
│   │   ├── services/     # API services
│   │   ├── store/        # Redux store
│   │   └── hooks/        # Custom hooks
│   └── package.json      # Node dependencies
├── shared/               # Shared types and constants
├── docker/               # Docker configuration
└── docs/                 # Documentation
```

## API Documentation

Once the backend is running, visit:
- **Swagger UI:** http://localhost:8000/docs
- **ReDoc:** http://localhost:8000/redoc

### Key API Endpoints

**Authentication:**
- `POST /auth/register` - Register with email/password
- `POST /auth/login` - Login with email/password
- `POST /auth/google/signup` - Sign up with Google OAuth
- `POST /auth/google/login` - Login with Google OAuth

**Database Visualization:**
- **pgAdmin:** http://localhost:5050
  - Email: admin@wordwise.com
  - Password: admin
  - Connect to: `postgres:5432` (wordwise_db)
  Host name/address: localhost
Port: 5432
Maintenance database: wordwise_db
Username: wordwise_user
Password: wordwise_password
☑ Save password

## Development Guidelines

- Follow PEP 8 for Python code
- Use TypeScript for all frontend code
- Frontend uses Turbopack for fast development (80% faster HMR)
- Write tests for critical functionality
- Use meaningful commit messages
- Update documentation when adding features

## Performance

The frontend is optimized for fast development:
- **Turbopack enabled** - Up to 700x faster hot module replacement
- **Optimized dependencies** - Only essential packages (19 vs 24 originally)
- **Fast startup** - ~30-40s initial (WSL2), ~3-8s on native filesystems
- **Hot reload** - 0.5-2s (80% faster than before)
- **Memory efficient** - Uses ~400MB (was 800MB)

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
