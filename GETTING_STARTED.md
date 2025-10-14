# Getting Started with WordWise

Welcome to WordWise! This guide will help you get started with the application.

## What is WordWise?

WordWise is a language learning platform that helps you learn English vocabulary by analyzing movie scripts. You can:

- Browse movies by difficulty level (A1-C2)
- Study vocabulary from your favorite films
- Create personalized word lists (Learn Later, Favorites, Mastered)
- Track your learning progress

## Quick Start

### 1. Start the Application

**Using Docker (Recommended):**

```bash
# Linux/Mac
./scripts/setup.sh

# Windows (PowerShell)
.\scripts\setup.ps1
```

**Or manually:**
```bash
docker-compose -f docker/docker-compose.yml up -d
```

### 2. Access the Application

Open your browser and go to:
- **Frontend:** http://localhost:3000
- **API Docs:** http://localhost:8000/docs

### 3. Create an Account

1. Click "Get Started" or "Sign up"
2. Fill in your details:
   - Email
   - Username
   - Password
3. Click "Create Account"

### 4. Start Learning

1. Browse available movies
2. Filter by difficulty level
3. Click on a movie to view details
4. Add words to your lists

## Features Guide

### Movies Page

The movies page shows all available movies. You can:

- **Filter by difficulty:** Click on A1, A2, B1, B2, C1, or C2 buttons
- **View details:** Click "View Details" on any movie card
- **See word count:** Each movie shows the number of words

### Word Lists

You can organize words into three lists:

- **Learn Later:** Words you want to study later
- **Favorites:** Your favorite words
- **Mastered:** Words you've learned

### Difficulty Levels

Movies and words are categorized by difficulty:

- **A1 (Beginner):** Basic words for everyday use
- **A2 (Elementary):** Common words for simple conversations
- **B1 (Intermediate):** Words for general topics
- **B2 (Upper Intermediate):** More complex vocabulary
- **C1 (Advanced):** Sophisticated language
- **C2 (Proficient):** Near-native vocabulary

## Using the API

### Interactive Documentation

Visit http://localhost:8000/docs to explore the API interactively.

### Authentication

Most API endpoints require authentication. To authenticate:

1. Register or login to get a JWT token
2. Include the token in the Authorization header:

```
Authorization: Bearer <your_token>
```

### Example API Calls

**Register a new user:**
```bash
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "username": "johndoe",
    "password": "password123"
  }'
```

**Login:**
```bash
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'
```

**Get movies:**
```bash
curl http://localhost:8000/movies/
```

**Get movies by difficulty:**
```bash
curl http://localhost:8000/movies/?difficulty=B2
```

## Development

### Project Structure

```
wordwise/
├── backend/          # Python/FastAPI backend
├── frontend/         # Next.js frontend
├── docker/           # Docker configuration
├── docs/             # Documentation
└── scripts/          # Setup scripts
```

### Running Locally (Without Docker)

**Backend:**
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp env.example .env
uvicorn src.main:app --reload
```

**Frontend:**
```bash
cd frontend
npm install
cp env.local.example .env.local
npm run dev
```

### Database Migrations

**Create a new migration:**
```bash
docker-compose -f docker/docker-compose.yml exec backend alembic revision --autogenerate -m "description"
```

**Apply migrations:**
```bash
docker-compose -f docker/docker-compose.yml exec backend alembic upgrade head
```

**Rollback last migration:**
```bash
docker-compose -f docker/docker-compose.yml exec backend alembic downgrade -1
```

## Troubleshooting

### Port Already in Use

If you get a "port already in use" error:

**Linux/Mac:**
```bash
lsof -ti:8000 | xargs kill -9  # Backend
lsof -ti:3000 | xargs kill -9  # Frontend
```

**Windows:**
```powershell
netstat -ano | findstr :8000
taskkill /PID <PID> /F
```

### Services Not Starting

Check the logs:
```bash
docker-compose -f docker/docker-compose.yml logs
```

### Database Connection Issues

Make sure PostgreSQL is running:
```bash
docker-compose -f docker/docker-compose.yml ps postgres
```

### Reset Everything

To start fresh (WARNING: Deletes all data):
```bash
docker-compose -f docker/docker-compose.yml down -v
docker-compose -f docker/docker-compose.yml up -d --build
docker-compose -f docker/docker-compose.yml exec backend alembic upgrade head
```

## Common Commands

### Docker Commands

```bash
# Start services
docker-compose -f docker/docker-compose.yml up -d

# Stop services
docker-compose -f docker/docker-compose.yml down

# View logs
docker-compose -f docker/docker-compose.yml logs -f

# Restart a service
docker-compose -f docker/docker-compose.yml restart backend

# Access database
docker-compose -f docker/docker-compose.yml exec postgres psql -U wordwise_user -d wordwise_db
```

### Development Commands

```bash
# Backend
cd backend
uvicorn src.main:app --reload

# Frontend
cd frontend
npm run dev

# Run tests (future)
pytest  # Backend
npm test  # Frontend
```

## Next Steps

1. **Explore the API:** Visit http://localhost:8000/docs
2. **Read the documentation:**
   - [Setup Guide](docs/SETUP.md)
   - [API Documentation](docs/API.md)
   - [Architecture](docs/ARCHITECTURE.md)
3. **Try the features:**
   - Register and login
   - Browse movies
   - Create word lists
   - Test the API

## Resources

- **Documentation:** [docs/](docs/)
- **API Docs:** http://localhost:8000/docs
- **Project Summary:** [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md)
- **Quick Start:** [QUICKSTART.md](QUICKSTART.md)

## Support

If you encounter any issues:

1. Check the [troubleshooting section](#troubleshooting)
2. Review the [documentation](docs/)
3. Check the [API docs](http://localhost:8000/docs)
4. Open an issue on GitHub

## Contributing

We welcome contributions! To contribute:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**Happy Learning! 🎬📚**

For more information, visit the [documentation](docs/) or check out the [project summary](PROJECT_SUMMARY.md).


