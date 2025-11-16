# Quick Start - Local Development

## ✅ Setup Complete!

Your local development environment is ready. No more Docker rebuilds needed!

## First Time Setup (Already Done!)

- ✅ PostgreSQL database configured
- ✅ Database user created
- ✅ Backend dependencies installed
- ✅ Database migrations run
- ✅ Environment files created
- ✅ Code issues fixed

## Start Development (Every Time)

### Terminal 1 - Start Backend
```bash
./start-backend.sh
```
Backend runs at: **http://localhost:8000**
API docs at: **http://localhost:8000/docs**

### Terminal 2 - Start Frontend
```bash
./start-frontend.sh
```
Frontend runs at: **http://localhost:3000**

## That's It! 🎉

Your app is now running locally without Docker.

## Quick Commands

```bash
# Start Redis & PostgreSQL (if not running)
sudo service redis-server start
sudo service postgresql start

# Check services
redis-cli ping              # Should return PONG
pg_isready -h localhost     # Should show "accepting connections"

# Run migrations
cd backend && source venv/bin/activate && alembic upgrade head
```

## Files Created for You

✅ `backend/.env` - Backend configuration
✅ `frontend/.env.local` - Frontend configuration
✅ `start-backend.sh` - Quick backend startup
✅ `start-frontend.sh` - Quick frontend startup
✅ `db-setup.sh` - Database initialization

See [README-LOCAL-DEV.md](README-LOCAL-DEV.md) for detailed documentation.
