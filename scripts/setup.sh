#!/bin/bash

echo "🚀 WordWise Setup Script"
echo "========================"
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

echo "✅ Docker and Docker Compose are installed"
echo ""

# Create environment files
echo "📝 Creating environment files..."

if [ ! -f backend/.env ]; then
    cp backend/env.example backend/.env
    echo "✅ Created backend/.env"
else
    echo "⚠️  backend/.env already exists, skipping..."
fi

if [ ! -f frontend/.env.local ]; then
    cp frontend/env.local.example frontend/.env.local
    echo "✅ Created frontend/.env.local"
else
    echo "⚠️  frontend/.env.local already exists, skipping..."
fi

echo ""

# Build and start Docker containers
echo "🐳 Building and starting Docker containers..."
docker-compose -f docker/docker-compose.yml up -d --build

echo ""
echo "⏳ Waiting for services to be ready..."
sleep 10

# Check if services are running
echo ""
echo "🔍 Checking service status..."

if docker-compose -f docker/docker-compose.yml ps | grep -q "Up"; then
    echo "✅ Services are running"
else
    echo "❌ Some services failed to start"
    docker-compose -f docker/docker-compose.yml logs
    exit 1
fi

echo ""
echo "📊 Service URLs:"
echo "   Frontend:    http://localhost:3000"
echo "   Backend API: http://localhost:8000"
echo "   API Docs:    http://localhost:8000/docs"
echo "   PostgreSQL:  localhost:5432"
echo "   Redis:       localhost:6379"
echo ""

# Run database migrations
echo "🗄️  Running database migrations..."
docker-compose -f docker/docker-compose.yml exec backend alembic upgrade head

echo ""
echo "✅ Setup complete!"
echo ""
echo "📚 Next steps:"
echo "   1. Visit http://localhost:3000 to access the application"
echo "   2. Register a new account"
echo "   3. Start exploring movies!"
echo ""
echo "📖 Documentation:"
echo "   - Setup Guide: docs/SETUP.md"
echo "   - API Docs: http://localhost:8000/docs"
echo "   - Architecture: docs/ARCHITECTURE.md"
echo ""
echo "🛑 To stop services:"
echo "   docker-compose -f docker/docker-compose.yml down"
echo ""
echo "Happy coding! 🎉"


