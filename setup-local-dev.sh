#!/bin/bash

# WordWise Local Development Setup Script
echo "🚀 Setting up WordWise for local development..."

# Check and start Redis
echo ""
echo "1️⃣ Checking Redis..."
if ! command -v redis-server &> /dev/null; then
    echo "❌ Redis not installed. Installing..."
    sudo apt update
    sudo apt install -y redis-server
fi
sudo service redis-server start
if redis-cli ping > /dev/null 2>&1; then
    echo "✅ Redis is running"
else
    echo "⚠️ Redis installation needed - run: sudo apt install redis-server"
fi

# Check PostgreSQL
echo ""
echo "2️⃣ Checking PostgreSQL..."
if pg_isready -h localhost > /dev/null 2>&1; then
    echo "✅ PostgreSQL is running"
else
    echo "❌ PostgreSQL not running. Starting..."
    sudo service postgresql start
fi

# Create database and user
echo ""
echo "3️⃣ Setting up database..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = 'wordwise_db'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE DATABASE wordwise_db;"
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='wordwise_user'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE USER wordwise_user WITH PASSWORD 'wordwise_password';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE wordwise_db TO wordwise_user;"
echo "✅ Database setup complete"

# Install backend dependencies
echo ""
echo "4️⃣ Installing backend dependencies..."
cd backend
if [ ! -d "../.venv" ]; then
    python3 -m venv ../.venv
fi
source ../.venv/bin/activate
pip install -q -r ../requirements.txt
echo "✅ Backend dependencies installed"

# Run migrations
echo ""
echo "5️⃣ Running database migrations..."
alembic upgrade head
echo "✅ Migrations complete"

# Install frontend dependencies
echo ""
echo "6️⃣ Installing frontend dependencies..."
cd ../frontend
npm install --silent
echo "✅ Frontend dependencies installed"

echo ""
echo "✨ Setup complete! ✨"
echo ""
echo "To start development:"
echo ""
echo "Terminal 1 (Backend):"
echo "  cd backend && source ../.venv/bin/activate && uvicorn src.main:app --reload"
echo ""
echo "Terminal 2 (Frontend):"
echo "  cd frontend && npm run dev"
echo ""
echo "Access your app at: http://localhost:3000"
echo "API docs at: http://localhost:8000/docs"
