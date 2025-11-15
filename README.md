# WordWise - Language Learning Through Movies

WordWise is an innovative language learning platform that helps users learn English vocabulary by analyzing movie scripts. Users can study words from their favorite movies, track their progress, and improve their language skills through engaging content.

## Features

- Movie script analysis with word frequency tracking
- Personalized word lists (Learn Later, Favorites, Mastered)
- Difficulty-based categorization (A1-C2 levels)
- User authentication and progress tracking
- Beautiful, responsive UI with Tailwind CSS

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
- Next.js 14 - React framework with SSR
- TypeScript - Type safety
- Tailwind CSS - Utility-first CSS
- Redux Toolkit - State management
- React Query - Server state management
- Axios - HTTP client

### Infrastructure
- Docker & Docker Compose - Containerization
- PostgreSQL - Database
- Redis - Cache

## Quick Start

### Prerequisites
- Docker and Docker Compose
- **WSL Users**: If you're using Windows Subsystem for Linux, see the [WSL Setup Guide](docs/SETUP.md#wsl-windows-subsystem-for-linux-setup) for important Node.js installation instructions.

### Using Docker (Recommended)

1. Clone the repository:
```bash
git clone <repository-url>
cd wordwise
```

2. Start all services:
```bash
docker compose up -d
```

3. Access the application:
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API Documentation: http://localhost:8000/docs

4. Run database migrations:
```bash
docker compose exec backend alembic upgrade head
```

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
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## Development Guidelines

- Follow PEP 8 for Python code
- Use TypeScript for all frontend code
- Write tests for critical functionality
- Use meaningful commit messages
- Update documentation when adding features

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
