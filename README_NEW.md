# WordWise 🎬📚

> Learn English through movie scripts with interactive vocabulary tracking and personalized learning paths.

[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](https://github.com/yourusername/wordwise)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://reactjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.108-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![Prisma](https://img.shields.io/badge/Prisma-5.0-2D3748?logo=prisma)](https://www.prisma.io/)

---

## 📖 Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Development](#development)
- [Deployment](#deployment)
- [API Documentation](#api-documentation)
- [Contributing](#contributing)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## ✨ Features

### 🎯 Core Functionality
- **Movie-Based Learning**: Learn vocabulary from real movie scripts
- **Difficulty Levels**: Content categorized from A1 (beginner) to C2 (proficient)
- **Interactive Subtitles**: Click words for instant definitions and translations
- **Personal Word Lists**: Track words as "Learn Later", "Favorites", or "Mastered"
- **Progress Tracking**: Monitor your vocabulary growth over time

### 🔐 Authentication
- **Email/Password**: Traditional authentication
- **Google OAuth**: One-click sign-in with Google
- **Secure JWT**: Industry-standard token-based authentication

### 💻 Technical Features
- **Fast Performance**: React + Vite for instant page loads
- **Type Safety**: Full TypeScript coverage
- **Modern UI**: Material-UI (MUI) components
- **RESTful API**: Clean, documented FastAPI backend
- **Database**: PostgreSQL with Prisma ORM
- **Docker Support**: Containerized for easy deployment

---

## 🏗️ Architecture

### Technology Stack

**Frontend:**
- React 18 with TypeScript
- Vite (build tool)
- Material-UI (MUI) for components
- Redux Toolkit for state management
- React Router for navigation
- Axios for API calls

**Backend:**
- FastAPI (Python 3.11+)
- Prisma Client Python (ORM)
- PostgreSQL 15
- JWT authentication
- Google OAuth 2.0

**Infrastructure:**
- Docker & Docker Compose
- AWS RDS (production database)
- PostgreSQL (local development)

### Project Structure

```
wordwise/
├── frontend/                 # React + Vite application
│   ├── src/
│   │   ├── components/      # Reusable UI components
│   │   │   ├── common/      # Button, Input, Card, etc.
│   │   │   └── layout/      # AppBar, Footer, etc.
│   │   ├── pages/           # Route components
│   │   │   ├── auth/        # Login, Register
│   │   │   └── movies/      # Movies list, detail
│   │   ├── routes/          # React Router configuration
│   │   ├── services/        # API client
│   │   ├── store/           # Redux store & slices
│   │   ├── theme/           # MUI theme configuration
│   │   ├── types/           # TypeScript definitions
│   │   ├── App.tsx          # Root component
│   │   └── main.tsx         # Entry point
│   ├── public/              # Static assets
│   ├── index.html           # HTML template
│   ├── vite.config.ts       # Vite configuration
│   ├── tsconfig.json        # TypeScript config
│   └── package.json         # Dependencies
├── backend/                  # FastAPI application
│   ├── src/
│   │   ├── routes/          # API endpoints
│   │   │   ├── auth.py      # Email/password auth
│   │   │   ├── oauth.py     # Google OAuth
│   │   │   ├── movies.py    # Movie CRUD
│   │   │   └── users.py     # User management
│   │   ├── services/        # Business logic
│   │   ├── utils/           # Helper functions
│   │   ├── config.py        # Settings
│   │   ├── database.py      # Prisma client
│   │   └── main.py          # FastAPI app
│   ├── prisma/
│   │   └── schema.prisma    # Database schema
│   ├── requirements.txt     # Python dependencies
│   └── Dockerfile           # Backend container
├── docker-compose.yml        # Multi-container setup
├── .env.example             # Environment template
├── README.md                # This file
└── MIGRATION_GUIDE.md       # Upgrade instructions

```

---

## 🚀 Getting Started

### Prerequisites

Ensure you have the following installed:

```bash
# Check versions
node --version    # v18.0.0 or higher
python --version  # 3.11.0 or higher
docker --version  # 20.10.0 or higher
psql --version    # 15.0 or higher
```

### Quick Start (Local Development)

1. **Clone the repository:**

```bash
git clone https://github.com/yourusername/wordwise.git
cd wordwise
```

2. **Set up environment variables:**

```bash
# Backend
cp backend/.env.example backend/.env
# Edit backend/.env with your values

# Frontend
cp frontend/.env.example frontend/.env
# Edit frontend/.env with your values
```

3. **Start with Docker (Recommended):**

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

Access the application:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs

4. **Or run manually (without Docker):**

**Backend:**
```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Generate Prisma client
prisma generate

# Run migrations
prisma migrate dev

# Start server
uvicorn src.main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

---

## 💻 Development

### Database Migrations

WordWise uses Prisma for database management.

**Create a migration:**
```bash
cd backend
prisma migrate dev --name add_new_feature
```

**Apply migrations:**
```bash
# Development
prisma migrate dev

# Production
prisma migrate deploy
```

**View migration status:**
```bash
prisma migrate status
```

**Introspect existing database:**
```bash
prisma db pull
```

**Reset database (⚠️ DELETES ALL DATA):**
```bash
prisma migrate reset
```

### Adding a New Feature

1. **Update Prisma schema** (`backend/prisma/schema.prisma`)
2. **Create migration**: `prisma migrate dev --name feature_name`
3. **Generate client**: `prisma generate`
4. **Update API routes** in `backend/src/routes/`
5. **Add frontend components** in `frontend/src/`
6. **Test locally**
7. **Submit pull request**

### Code Style

**Frontend:**
- Use TypeScript for all files
- Follow React hooks patterns
- Use functional components
- Keep components small and focused

**Backend:**
- Follow PEP 8 style guide
- Use type hints
- Document all API endpoints
- Write docstrings for functions

### Running Tests

```bash
# Frontend
cd frontend
npm run test

# Backend
cd backend
pytest
```

---

## 🌐 Deployment

### Deploy to AWS

**Prerequisites:**
- AWS account
- AWS CLI configured
- RDS PostgreSQL instance created

**Step 1: Set up RDS Database**

```bash
# Create RDS PostgreSQL instance
aws rds create-db-instance \
  --db-instance-identifier wordwise-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 15.3 \
  --master-username admin \
  --master-user-password YOUR_PASSWORD \
  --allocated-storage 20
```

**Step 2: Run Migrations**

```bash
# Set DATABASE_URL to RDS endpoint
export DATABASE_URL="postgresql://admin:password@wordwise-db.xxxxx.rds.amazonaws.com:5432/wordwise"

# Run migrations
cd backend
prisma migrate deploy
```

**Step 3: Deploy Backend**

```bash
# Build Docker image
docker build -t wordwise-backend:latest ./backend

# Push to ECR
aws ecr get-login-password | docker login --username AWS --password-stdin YOUR_ECR_URL
docker tag wordwise-backend:latest YOUR_ECR_URL/wordwise-backend:latest
docker push YOUR_ECR_URL/wordwise-backend:latest

# Update ECS service
aws ecs update-service --cluster wordwise --service backend --force-new-deployment
```

**Step 4: Deploy Frontend**

```bash
# Build frontend
cd frontend
npm run build

# Deploy to S3
aws s3 sync dist/ s3://wordwise-frontend --delete

# Invalidate CloudFront
aws cloudfront create-invalidation --distribution-id YOUR_ID --paths "/*"
```

### Environment Variables (Production)

Store sensitive values in AWS Systems Manager:

```bash
# Database URL
aws ssm put-parameter \
  --name /wordwise/prod/DATABASE_URL \
  --value "postgresql://..." \
  --type SecureString

# JWT Secret
aws ssm put-parameter \
  --name /wordwise/prod/JWT_SECRET_KEY \
  --value "..." \
  --type SecureString

# Google OAuth
aws ssm put-parameter \
  --name /wordwise/prod/GOOGLE_CLIENT_ID \
  --value "..." \
  --type String
```

---

## 📚 API Documentation

### Authentication Endpoints

**Register with Email:**
```http
POST /auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "username": "johndoe",
  "password": "SecurePass123!"
}
```

**Login with Email:**
```http
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

**Google OAuth Login:**
```http
POST /auth/google/login
Content-Type: application/json

{
  "id_token": "google-id-token-here"
}
```

### Movie Endpoints

**Get All Movies:**
```http
GET /movies?difficulty=A1
Authorization: Bearer <jwt-token>
```

**Get Movie Details:**
```http
GET /movies/{id}
Authorization: Bearer <jwt-token>
```

### Interactive API Docs

Visit http://localhost:8000/docs for full Swagger documentation.

---

## 🤝 Contributing

We welcome contributions! Here's how:

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Make your changes**
4. **Commit**: `git commit -m 'Add amazing feature'`
5. **Push**: `git push origin feature/amazing-feature`
6. **Open a Pull Request**

### Contribution Guidelines

- Write clear, descriptive commit messages
- Add tests for new features
- Update documentation
- Follow existing code style
- One feature per pull request

---

## 🐛 Troubleshooting

### Frontend Issues

**Problem:** `import.meta.env is undefined`

**Solution:**
```bash
# Check .env file exists
ls frontend/.env

# Variables must start with VITE_
# Restart dev server
npm run dev
```

**Problem:** Build fails with TypeScript errors

**Solution:**
```bash
# Clear cache
rm -rf node_modules dist
npm install
npm run build
```

### Backend Issues

**Problem:** `Prisma Client could not locate the required engine`

**Solution:**
```bash
cd backend
prisma generate
```

**Problem:** Database connection refused

**Solution:**
```bash
# Check PostgreSQL is running
psql -h localhost -U wordwise_user -d wordwise_db

# Verify DATABASE_URL in .env
cat backend/.env | grep DATABASE_URL
```

### Docker Issues

**Problem:** Containers fail to start

**Solution:**
```bash
# Check logs
docker-compose logs

# Rebuild containers
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

**Problem:** Port already in use

**Solution:**
```bash
# Find process using port 3000
lsof -ti:3000 | xargs kill -9

# Or change port in docker-compose.yml
```

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `CORS policy error` | Frontend/backend port mismatch | Update `ALLOWED_ORIGINS` in backend/.env |
| `401 Unauthorized` | Invalid/expired JWT token | Re-login to get new token |
| `Google OAuth failed` | Wrong client ID or origin | Verify Google Console settings |
| `Migration failed` | Database schema conflict | Run `prisma migrate reset` (dev only) |

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [FastAPI](https://fastapi.tiangolo.com/) - Modern Python web framework
- [React](https://reactjs.org/) - UI library
- [Prisma](https://www.prisma.io/) - Next-generation ORM
- [Material-UI](https://mui.com/) - React component library
- [Vite](https://vitejs.dev/) - Lightning-fast build tool

---

## 📞 Support

- **Documentation**: [/docs](/docs)
- **Issues**: [GitHub Issues](https://github.com/yourusername/wordwise/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/wordwise/discussions)
- **Email**: support@wordwise.com

---

**Made with ❤️ by the WordWise Team**
