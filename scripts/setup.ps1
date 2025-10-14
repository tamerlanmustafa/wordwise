# WordWise Setup Script for Windows PowerShell

Write-Host "🚀 WordWise Setup Script" -ForegroundColor Cyan
Write-Host "========================" -ForegroundColor Cyan
Write-Host ""

# Check if Docker is installed
try {
    docker --version | Out-Null
    Write-Host "✅ Docker is installed" -ForegroundColor Green
} catch {
    Write-Host "❌ Docker is not installed. Please install Docker Desktop first." -ForegroundColor Red
    exit 1
}

# Check if Docker Compose is installed
try {
    docker-compose --version | Out-Null
    Write-Host "✅ Docker Compose is installed" -ForegroundColor Green
} catch {
    Write-Host "❌ Docker Compose is not installed. Please install Docker Compose first." -ForegroundColor Red
    exit 1
}

Write-Host ""

# Create environment files
Write-Host "📝 Creating environment files..." -ForegroundColor Yellow

if (-not (Test-Path "backend\.env")) {
    Copy-Item "backend\env.example" "backend\.env"
    Write-Host "✅ Created backend\.env" -ForegroundColor Green
} else {
    Write-Host "⚠️  backend\.env already exists, skipping..." -ForegroundColor Yellow
}

if (-not (Test-Path "frontend\.env.local")) {
    Copy-Item "frontend\env.local.example" "frontend\.env.local"
    Write-Host "✅ Created frontend\.env.local" -ForegroundColor Green
} else {
    Write-Host "⚠️  frontend\.env.local already exists, skipping..." -ForegroundColor Yellow
}

Write-Host ""

# Build and start Docker containers
Write-Host "🐳 Building and starting Docker containers..." -ForegroundColor Yellow
docker-compose -f docker\docker-compose.yml up -d --build

Write-Host ""
Write-Host "⏳ Waiting for services to be ready..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

# Check if services are running
Write-Host ""
Write-Host "🔍 Checking service status..." -ForegroundColor Yellow

$services = docker-compose -f docker\docker-compose.yml ps
if ($services -match "Up") {
    Write-Host "✅ Services are running" -ForegroundColor Green
} else {
    Write-Host "❌ Some services failed to start" -ForegroundColor Red
    docker-compose -f docker\docker-compose.yml logs
    exit 1
}

Write-Host ""
Write-Host "📊 Service URLs:" -ForegroundColor Cyan
Write-Host "   Frontend:    http://localhost:3000"
Write-Host "   Backend API: http://localhost:8000"
Write-Host "   API Docs:    http://localhost:8000/docs"
Write-Host "   PostgreSQL:  localhost:5432"
Write-Host "   Redis:       localhost:6379"
Write-Host ""

# Run database migrations
Write-Host "🗄️  Running database migrations..." -ForegroundColor Yellow
docker-compose -f docker\docker-compose.yml exec backend alembic upgrade head

Write-Host ""
Write-Host "✅ Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "📚 Next steps:" -ForegroundColor Cyan
Write-Host "   1. Visit http://localhost:3000 to access the application"
Write-Host "   2. Register a new account"
Write-Host "   3. Start exploring movies!"
Write-Host ""
Write-Host "📖 Documentation:" -ForegroundColor Cyan
Write-Host "   - Setup Guide: docs\SETUP.md"
Write-Host "   - API Docs: http://localhost:8000/docs"
Write-Host "   - Architecture: docs\ARCHITECTURE.md"
Write-Host ""
Write-Host "🛑 To stop services:" -ForegroundColor Cyan
Write-Host "   docker-compose -f docker\docker-compose.yml down"
Write-Host ""
Write-Host "Happy coding! 🎉" -ForegroundColor Green


