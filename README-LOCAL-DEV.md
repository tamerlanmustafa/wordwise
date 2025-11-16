# Local Development Setup (No Docker)

This guide helps you run WordWise locally without Docker for faster development.

## One-Time Setup

### 1. Install Redis
```bash
sudo apt update
sudo apt install -y redis-server
sudo service redis-server start
```

### 2. Setup Database
```bash
./db-setup.sh
```

This creates the PostgreSQL database and user.

### 3. Run Migrations
```bash
cd backend
source venv/bin/activate
alembic upgrade head
```

## Daily Development Workflow

### Option A: Use the Helper Scripts

**Terminal 1 - Backend:**
```bash
./start-backend.sh
```

**Terminal 2 - Frontend:**
```bash
./start-frontend.sh
```

### Option B: Manual Commands

**Terminal 1 - Backend:**
```bash
cd backend
source ../.venv/bin/activate
uvicorn src.main:app --reload
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

## Access Your App

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs

## Troubleshooting

### Redis not running
```bash
sudo service redis-server start
redis-cli ping  # Should return PONG
```

### PostgreSQL not running
```bash
sudo service postgresql start
pg_isready -h localhost  # Should show "accepting connections"
```

### Database migrations failing
```bash
cd backend
source ../.venv/bin/activate
alembic downgrade -1
alembic upgrade head
```

### Port already in use
```bash
# Kill process on port 8000 (backend)
lsof -ti:8000 | xargs kill -9

# Kill process on port 3000 (frontend)
lsof -ti:3000 | xargs kill -9
```

## Environment Files Created

- ✅ `backend/.env` - Backend configuration
- ✅ `frontend/.env.local` - Frontend configuration

These files are already set up for local development!

## Benefits of Local Development

- ⚡ **Faster** - No Docker overhead
- 🔍 **Better debugging** - Direct access to processes
- 🔄 **Instant reloads** - Changes reflect immediately
- 🛠️ **IDE integration** - Full debugging support

## Need Docker Again?

If you need to switch back to Docker:
```bash
docker compose up -d
```

Your local setup won't conflict with Docker!
