# WordWise Quick Start Guide

Get WordWise up and running in 5 minutes!

## Prerequisites

- Docker Desktop installed and running
- Git (optional, for cloning)

## Quick Start (Docker)

### Option 1: Automated Setup (Recommended)

**Linux/Mac:**
```bash
./scripts/setup.sh
```

**Windows (PowerShell):**
```powershell
.\scripts\setup.ps1
```

### Option 2: Manual Setup

1. **Start all services:**
   ```bash
   docker-compose -f docker/docker-compose.yml up -d
   ```

2. **Run database migrations:**
   ```bash
   docker-compose -f docker/docker-compose.yml exec backend alembic upgrade head
   ```

3. **Access the application:**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:8000
   - API Docs: http://localhost:8000/docs

## First Steps

1. **Register an account:**
   - Go to http://localhost:3000
   - Click "Get Started" or "Sign up"
   - Fill in your details and create an account

2. **Explore movies:**
   - After login, you'll see the movies page
   - Browse available movies
   - Filter by difficulty level (A1-C2)

3. **Try the API:**
   - Visit http://localhost:8000/docs
   - Try the interactive API documentation
   - Test endpoints directly from the browser

## Common Commands

### Start services
```bash
docker-compose -f docker/docker-compose.yml up -d
```

### Stop services
```bash
docker-compose -f docker/docker-compose.yml down
```

### View logs
```bash
# All services
docker-compose -f docker/docker-compose.yml logs -f

# Specific service
docker-compose -f docker/docker-compose.yml logs -f backend
```

### Restart a service
```bash
docker-compose -f docker/docker-compose.yml restart backend
```

### Access database
```bash
docker-compose -f docker/docker-compose.yml exec postgres psql -U wordwise_user -d wordwise_db
```

## Troubleshooting

### Port already in use
If you get a "port already in use" error:

**Linux/Mac:**
```bash
# Find and kill process on port 8000
lsof -ti:8000 | xargs kill -9

# Find and kill process on port 3000
lsof -ti:3000 | xargs kill -9
```

**Windows:**
```powershell
# Find and kill process on port 8000
netstat -ano | findstr :8000
taskkill /PID <PID> /F

# Find and kill process on port 3000
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

### Services not starting
Check the logs:
```bash
docker-compose -f docker/docker-compose.yml logs
```

### Database connection issues
Make sure PostgreSQL is running:
```bash
docker-compose -f docker/docker-compose.yml ps postgres
```

### Reset everything
To start fresh (WARNING: This will delete all data):
```bash
docker-compose -f docker/docker-compose.yml down -v
docker-compose -f docker/docker-compose.yml up -d --build
docker-compose -f docker/docker-compose.yml exec backend alembic upgrade head
```

## Next Steps

- Read the full [Setup Guide](docs/SETUP.md)
- Explore the [API Documentation](docs/API.md)
- Understand the [Architecture](docs/ARCHITECTURE.md)
- Check out the [README](README.md)

## Need Help?

- Check the [documentation](docs/)
- Review the [API docs](http://localhost:8000/docs)
- Open an issue on GitHub

## Development

### Local Development (Without Docker)

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

## Features

✅ User authentication (register/login)  
✅ Movie browsing with difficulty filters  
✅ Word lists (Learn Later, Favorites, Mastered)  
✅ RESTful API with OpenAPI documentation  
✅ PostgreSQL database  
✅ Redis caching  
✅ Docker containerization  
✅ Responsive UI with Tailwind CSS  
✅ JWT authentication  
✅ Password hashing with bcrypt  

## Coming Soon

- Movie script upload and parsing
- Word frequency analysis
- Translation support
- Progress tracking
- Chrome extension
- Mobile app

---

**Happy Learning! 🎬📚**


