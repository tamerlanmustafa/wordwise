# WordWise Migration Guide
## Next.js → React + Vite | SQLAlchemy → Prisma

**Version:** 2.0.0
**Date:** November 2025
**Author:** Migration Team

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Backend Migration (Prisma)](#backend-migration)
4. [Frontend Migration (Vite)](#frontend-migration)
5. [Docker Optimization](#docker-optimization)
6. [Environment Setup](#environment-setup)
7. [Deployment](#deployment)
8. [Troubleshooting](#troubleshooting)

---

## Overview

This migration transforms WordWise from a monolithic Next.js + SQLAlchemy stack to a modern, clean architecture:

**Before:**
- Frontend: Next.js 14 + TypeScript
- Backend: FastAPI + SQLAlchemy + Alembic
- Database: PostgreSQL (local)
- Docker: 5+ containers

**After:**
- Frontend: React 18 + Vite + TypeScript
- Backend: FastAPI + Prisma Client Python
- Database: PostgreSQL (AWS RDS + local sync)
- Docker: 3 containers (optimized)

---

## Prerequisites

```bash
# Check versions
node --version  # v18+
python --version  # 3.11+
docker --version  # 20+
psql --version  # 15+
```

---

## Backend Migration (SQLAlchemy → Prisma)

### Step 1: Backup Database

```bash
# Backup current database
PGPASSWORD=wordwise_password pg_dump -h localhost -U wordwise_user wordwise_db > backup_$(date +%Y%m%d).sql

# Verify backup
ls -lh backup_*.sql
```

### Step 2: Install Prisma

```bash
cd backend
source venv/bin/activate
pip install prisma==0.11.0
pip freeze > requirements.txt
```

### Step 3: Initialize Prisma

```bash
# Generate Prisma client
prisma generate

# Create initial migration from existing database
prisma db pull

# Or create migration from schema
prisma migrate dev --name init
```

### Step 4: Replace database.py

**File:** `backend/src/database.py`

```python
"""
Database connection using Prisma Client Python.
"""
from prisma import Prisma

# Global Prisma client
prisma = Prisma()

async def connect_db():
    """Connect to database on startup"""
    await prisma.connect()
    print("✅ Connected to Prisma")

async def disconnect_db():
    """Disconnect on shutdown"""
    await prisma.disconnect()
    print("❌ Disconnected from Prisma")

# For dependency injection
async def get_db() -> Prisma:
    return prisma
```

### Step 5: Update main.py

**File:** `backend/src/main.py`

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from .database import connect_db, disconnect_db
from .config import get_settings
from .routes import auth, oauth, movies, users

settings = get_settings()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await connect_db()
    yield
    # Shutdown
    await disconnect_db()

app = FastAPI(
    title="WordWise API",
    version="2.0.0",
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(oauth.router, prefix="/auth/google", tags=["oauth"])
app.include_router(movies.router, prefix="/movies", tags=["movies"])
app.include_router(users.router, prefix="/users", tags=["users"])

@app.get("/health")
async def health():
    return {"status": "healthy", "version": "2.0.0"}
```

### Step 6: Convert OAuth Route to Prisma

**File:** `backend/src/routes/oauth.py`

```python
from fastapi import APIRouter, HTTPException, status
from datetime import timedelta
from ..database import prisma
from ..schemas.oauth import GoogleLoginRequest, GoogleLoginResponse, UserInfo
from ..utils.google_auth import verify_google_token, generate_username_from_email
from ..utils.auth import create_access_token
from ..config import get_settings

router = APIRouter()
settings = get_settings()

@router.post("/login", response_model=GoogleLoginResponse)
async def google_login(request: GoogleLoginRequest):
    try:
        # Verify Google token
        google_user_info = verify_google_token(request.id_token, settings.google_client_id)

        if not google_user_info or not google_user_info.get('email_verified'):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email not verified with Google"
            )

        google_id = google_user_info['google_id']
        email = google_user_info['email']

        # Find or create user using Prisma
        user = await prisma.user.find_first(
            where={
                "OR": [
                    {"googleId": google_id},
                    {"email": email}
                ]
            }
        )

        if user:
            # Update existing user
            user = await prisma.user.update(
                where={"id": user.id},
                data={
                    "googleId": google_id,
                    "oauthProvider": "google",
                    "profilePictureUrl": google_user_info.get('picture')
                }
            )
        else:
            # Create new user
            username = generate_username_from_email(email)

            # Ensure unique username
            base_username = username
            counter = 1
            while await prisma.user.find_unique(where={"username": username}):
                username = f"{base_username}{counter}"
                counter += 1

            user = await prisma.user.create(
                data={
                    "email": email,
                    "username": username,
                    "googleId": google_id,
                    "oauthProvider": "google",
                    "profilePictureUrl": google_user_info.get('picture'),
                    "isActive": True
                }
            )

        # Generate JWT
        access_token_expires = timedelta(hours=settings.jwt_expiration_hours)
        access_token = create_access_token(
            data={"sub": user.id, "email": user.email},
            expires_delta=access_token_expires
        )

        return GoogleLoginResponse(
            access_token=access_token,
            token_type="bearer",
            user=UserInfo(
                id=user.id,
                email=user.email,
                username=user.username,
                oauth_provider=user.oauthProvider,
                profile_picture_url=user.profilePictureUrl
            )
        )

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Authentication failed: {str(e)}"
        )
```

### Step 7: Remove Alembic

```bash
# Remove Alembic
pip uninstall alembic -y

# Remove Alembic directory
rm -rf alembic/

# Remove from requirements.txt
sed -i '/alembic/d' requirements.txt
```

### Step 8: Prisma Migration Commands

```bash
# Generate Prisma client
prisma generate

# Create migration
prisma migrate dev --name <migration_name>

# Apply migrations in production
prisma migrate deploy

# Reset database (DANGER: deletes all data)
prisma migrate reset

# View migration status
prisma migrate status

# Introspect existing database
prisma db pull

# Push schema without migration
prisma db push
```

---

## Frontend Migration (Next.js → Vite)

### Step 1: Copy Existing Code

```bash
# Create new frontend
mkdir frontend-vite
cd frontend-vite

# Initialize Vite
npm create vite@latest . -- --template react-ts

# Install dependencies (from package.json above)
npm install
```

### Step 2: Port Pages to Components

**Example: LoginPage.tsx**

```tsx
// Before (Next.js): src/pages/auth/login.tsx
import { useRouter } from 'next/router'

// After (React): src/pages/auth/LoginPage.tsx
import { useNavigate } from 'react-router-dom'

export default function LoginPage() {
  const navigate = useNavigate()  // Changed from useRouter

  const handleLogin = async () => {
    // ... login logic
    navigate('/movies')  // Changed from router.push()
  }

  return (
    // Same JSX
  )
}
```

### Step 3: Update Image Tags

```tsx
// Before (Next.js)
import Image from 'next/image'
<Image src="/logo.png" alt="Logo" width={100} height={100} />

// After (React)
<img src="/logo.png" alt="Logo" style={{ width: 100, height: 100 }} />
```

### Step 4: Environment Variables

```bash
# Before (Next.js): .env.local
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_GOOGLE_CLIENT_ID=...

# After (Vite): .env
VITE_API_URL=http://localhost:8000
VITE_GOOGLE_CLIENT_ID=...
```

```ts
// Before (Next.js)
const apiUrl = process.env.NEXT_PUBLIC_API_URL

// After (Vite)
const apiUrl = import.meta.env.VITE_API_URL
```

### Step 5: Build & Run

```bash
# Development
npm run dev

# Production build
npm run build
npm run preview
```

---

## Docker Optimization

### Minimal docker-compose.yml

```yaml
version: '3.8'

services:
  # PostgreSQL Database
  postgres:
    image: postgres:15-alpine
    container_name: wordwise_postgres
    environment:
      POSTGRES_USER: wordwise_user
      POSTGRES_PASSWORD: wordwise_password
      POSTGRES_DB: wordwise_db
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U wordwise_user"]
      interval: 10s
      timeout: 5s
      retries: 5

  # FastAPI Backend
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: wordwise_backend
    command: uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
    volumes:
      - ./backend:/app
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgresql://wordwise_user:wordwise_password@postgres:5432/wordwise_db
      JWT_SECRET_KEY: ${JWT_SECRET_KEY}
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}
    depends_on:
      postgres:
        condition: service_healthy

  # React Frontend
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: wordwise_frontend
    command: npm run dev -- --host
    volumes:
      - ./frontend:/app
      - /app/node_modules
    ports:
      - "3000:3000"
    environment:
      VITE_API_URL: http://localhost:8000
      VITE_GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}
    depends_on:
      - backend

volumes:
  postgres_data:
```

### Optimized Backend Dockerfile

```dockerfile
# backend/Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Generate Prisma client
RUN prisma generate

EXPOSE 8000

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Optimized Frontend Dockerfile

```dockerfile
# frontend/Dockerfile
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Build for production
RUN npm run build

# Production image
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### .dockerignore Files

**backend/.dockerignore:**
```
__pycache__
*.pyc
*.pyo
*.pyd
.Python
env/
venv/
.venv/
.pytest_cache/
.coverage
htmlcov/
dist/
build/
*.egg-info/
.env
.env.local
```

**frontend/.dockerignore:**
```
node_modules/
.next/
out/
dist/
build/
.env
.env.local
.env.*.local
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.DS_Store
```

---

## Environment Setup

### Local Development

**backend/.env:**
```bash
DATABASE_URL=postgresql://wordwise_user:wordwise_password@localhost:5432/wordwise_db
JWT_SECRET_KEY=your-secret-key-change-in-production
JWT_ALGORITHM=HS256
JWT_EXPIRATION_HOURS=24
GOOGLE_CLIENT_ID=your-google-client-id
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

**frontend/.env:**
```bash
VITE_API_URL=http://localhost:8000
VITE_GOOGLE_CLIENT_ID=your-google-client-id
```

### AWS RDS Setup

1. **Create RDS PostgreSQL Instance:**
   - Engine: PostgreSQL 15
   - Instance class: db.t3.micro (free tier) or larger
   - Storage: 20 GB SSD
   - Enable public accessibility (temporarily for migration)
   - Security group: Allow port 5432 from your IP

2. **Update DATABASE_URL:**
```bash
DATABASE_URL=postgresql://admin:password@wordwise-db.xxxxx.us-east-1.rds.amazonaws.com:5432/wordwise
```

3. **Run Prisma Migrations:**
```bash
# Set production DATABASE_URL
export DATABASE_URL="postgresql://admin:password@rds-endpoint:5432/wordwise"

# Apply migrations
prisma migrate deploy
```

---

## Deployment

### Deploy to AWS

**Backend (AWS ECS/Fargate or EC2):**

```bash
# Build and push Docker image
docker build -t wordwise-backend:latest ./backend
docker tag wordwise-backend:latest your-ecr-repo/wordwise-backend:latest
docker push your-ecr-repo/wordwise-backend:latest

# Deploy to ECS
aws ecs update-service --cluster wordwise --service backend --force-new-deployment
```

**Frontend (AWS S3 + CloudFront or Amplify):**

```bash
# Build production
cd frontend
npm run build

# Deploy to S3
aws s3 sync dist/ s3://wordwise-frontend --delete

# Invalidate CloudFront cache
aws cloudfront create-invalidation --distribution-id YOUR_DIST_ID --paths "/*"
```

### Environment Variables in Production

Use AWS Systems Manager Parameter Store or Secrets Manager:

```bash
# Store secrets
aws ssm put-parameter --name /wordwise/DATABASE_URL --value "postgresql://..." --type SecureString
aws ssm put-parameter --name /wordwise/JWT_SECRET_KEY --value "..." --type SecureString
```

---

## Troubleshooting

### Prisma Issues

**Problem:** `Prisma Client could not locate the required engine`

**Solution:**
```bash
prisma generate
```

**Problem:** Migration conflicts

**Solution:**
```bash
# Reset and recreate
prisma migrate reset
prisma migrate dev --name init
```

### Frontend Issues

**Problem:** `import.meta.env is undefined`

**Solution:**
- Check `.env` file exists
- Restart Vite dev server
- Variables must start with `VITE_`

**Problem:** Routing doesn't work in production

**Solution:** Add `nginx.conf`:
```nginx
location / {
  try_files $uri $uri/ /index.html;
}
```

### Docker Issues

**Problem:** Slow builds

**Solution:**
- Add `.dockerignore` files
- Use Docker BuildKit: `DOCKER_BUILDKIT=1 docker build`
- Use layer caching

**Problem:** Database connection refused

**Solution:**
- Use service name in docker-compose: `postgres`, not `localhost`
- Check `depends_on` and `healthcheck`

---

## Migration Checklist

- [ ] Backup database
- [ ] Create feature branch
- [ ] Install Prisma
- [ ] Create Prisma schema
- [ ] Test Prisma migrations locally
- [ ] Convert backend routes to Prisma
- [ ] Remove SQLAlchemy/Alembic
- [ ] Create React + Vite project
- [ ] Port all pages/components
- [ ] Update environment variables
- [ ] Test Google OAuth
- [ ] Optimize Docker setup
- [ ] Update documentation
- [ ] Deploy to staging
- [ ] Run integration tests
- [ ] Deploy to production
- [ ] Monitor logs/metrics

---

**End of Migration Guide**
