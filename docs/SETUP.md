# WordWise Setup Guide

This guide will help you set up the WordWise development environment.

## Prerequisites

- Docker and Docker Compose
- Node.js 18+ (for local frontend development)
- Python 3.11+ (for local backend development)
- Git

## WSL (Windows Subsystem for Linux) Setup

If you're using WSL, you need to install Node.js directly in your WSL environment, not rely on Windows Node.js installation.

### Installing Node.js in WSL

**Option 1: Using nvm (Recommended)**

```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Reload your shell configuration
source ~/.bashrc  # or source ~/.zshrc if using zsh

# Install Node.js
nvm install 18
nvm use 18
nvm alias default 18

# Verify installation
node --version
npm --version
```

**Option 2: Using apt**

```bash
# Update package list
sudo apt update

# Install Node.js and npm
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

### Installing Claude CLI in WSL

After Node.js is installed in WSL:

```bash
# Install Claude CLI globally
npm install -g @anthropic-ai/claude-cli

# Verify installation
claude --version
```

### Common WSL Issues

**Issue: "node: not found" when running npm packages**

This happens when you have npm packages installed on Windows but are trying to run them from WSL. Solution: Install Node.js and the packages directly in WSL as shown above.

**Issue: Permission errors with npm global packages**

```bash
# Set up npm global directory in your home folder
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'

# Add to your PATH (add this to ~/.bashrc or ~/.zshrc)
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

## Quick Start with Docker (Recommended)

### 1. Clone the Repository

```bash
git clone <repository-url>
cd wordwise
```

### 2. Start All Services

```bash
docker compose up -d
```

This will start:
- PostgreSQL database (port 5432)
- Redis cache (port 6379)
- Backend API (port 8000)
- Frontend (port 3000)

### 3. Access the Application

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API Documentation: http://localhost:8000/docs

### 4. Run Database Migrations

```bash
docker compose exec backend alembic upgrade head
```

## Local Development Setup

### Backend Setup

1. **Create Virtual Environment**

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. **Install Dependencies**

```bash
pip install -r requirements.txt
```

3. **Set Up Environment Variables**

```bash
cp env.example .env
# Edit .env with your configuration
```

4. **Download NLTK Data**

```bash
python -c "import nltk; nltk.download('punkt'); nltk.download('stopwords'); nltk.download('wordnet'); nltk.download('averaged_perceptron_tagger')"
```

5. **Run Database Migrations**

```bash
alembic upgrade head
```

6. **Start the Development Server**

```bash
uvicorn src.main:app --reload
```

### Frontend Setup

1. **Install Dependencies**

```bash
cd frontend
npm install
```

2. **Set Up Environment Variables**

```bash
cp env.local.example .env.local
# Edit .env.local with your configuration
```

3. **Start the Development Server**

```bash
npm run dev
```

## Database Setup

### Using Docker PostgreSQL

The Docker Compose setup includes PostgreSQL. No additional setup is needed.

### Using Local PostgreSQL

1. Install PostgreSQL
2. Create a database:

```sql
CREATE DATABASE wordwise_db;
CREATE USER wordwise_user WITH PASSWORD 'wordwise_password';
GRANT ALL PRIVILEGES ON DATABASE wordwise_db TO wordwise_user;
```

3. Update `backend/.env` with your database URL:

```env
DATABASE_URL=postgresql://wordwise_user:wordwise_password@localhost:5432/wordwise_db
```

## Running Tests

### Backend Tests

```bash
cd backend
pytest
```

### Frontend Tests

```bash
cd frontend
npm test
```

## Common Issues

### Port Already in Use

If you get a "port already in use" error:

```bash
# Find and kill the process using the port
lsof -ti:8000 | xargs kill -9  # Backend
lsof -ti:3000 | xargs kill -9  # Frontend
```

### Database Connection Issues

Make sure PostgreSQL is running and accessible:

```bash
# Check if PostgreSQL is running
docker compose ps postgres

# Check database connection
docker compose exec backend psql -h postgres -U wordwise_user -d wordwise_db
```

### NLTK Data Not Found

If you get NLTK data errors:

```bash
python -c "import nltk; nltk.download('punkt'); nltk.download('stopwords'); nltk.download('wordnet'); nltk.download('averaged_perceptron_tagger')"
```

## Development Workflow

1. Make changes to the code
2. Backend changes are automatically reloaded (uvicorn --reload)
3. Frontend changes are automatically reloaded (Next.js hot reload)
4. Test your changes
5. Commit your changes

## Stopping the Services

```bash
# Stop all services
docker compose down

# Stop and remove volumes (WARNING: This will delete all data)
docker compose down -v
```

## Getting Help

If you encounter any issues:

1. Check the logs:
   ```bash
   docker compose logs backend
   docker compose logs frontend
   ```

2. Check the API documentation: http://localhost:8000/docs

3. Open an issue on GitHub


