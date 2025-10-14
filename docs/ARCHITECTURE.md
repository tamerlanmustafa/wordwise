# WordWise Architecture

## System Overview

WordWise is a language learning platform that helps users learn English vocabulary by analyzing movie scripts. The system is built with a microservices architecture using modern web technologies.

## Technology Stack

### Backend
- **Framework:** FastAPI (Python)
- **Database:** PostgreSQL
- **Cache:** Redis
- **ORM:** SQLAlchemy
- **Migrations:** Alembic
- **NLP:** NLTK, spaCy, wordfreq
- **Authentication:** JWT (python-jose)

### Frontend
- **Framework:** Next.js 14 (React)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **State Management:** Redux Toolkit
- **HTTP Client:** Axios
- **Forms:** React Hook Form + Zod

### Infrastructure
- **Containerization:** Docker
- **Orchestration:** Docker Compose
- **Version Control:** Git

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Next.js    │  │   Redux      │  │   Tailwind   │      │
│  │   (React)    │  │   Toolkit    │  │     CSS      │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP/REST
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                         Backend                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   FastAPI    │  │   Routes     │  │  Services    │      │
│  │   (Python)   │  │   (REST)     │  │  (Business)  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Models     │  │ Middleware   │  │   Utils      │      │
│  │ (SQLAlchemy) │  │  (Auth)      │  │  (Helpers)   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└──────┬──────────────────┬──────────────────┬───────────────┘
       │                  │                  │
       ▼                  ▼                  ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  PostgreSQL  │  │    Redis     │  │  External    │
│  (Database)  │  │   (Cache)    │  │     APIs     │
└──────────────┘  └──────────────┘  └──────────────┘
```

## Component Architecture

### Backend Components

#### 1. API Layer (FastAPI)
- **Purpose:** Handle HTTP requests and responses
- **Location:** `backend/src/main.py`
- **Responsibilities:**
  - Request routing
  - Request validation
  - Response formatting
  - Error handling

#### 2. Routes
- **Purpose:** Define API endpoints
- **Location:** `backend/src/routes/`
- **Endpoints:**
  - `/auth/*` - Authentication
  - `/movies/*` - Movie management
  - `/users/*` - User word lists

#### 3. Models (SQLAlchemy)
- **Purpose:** Database schema and ORM
- **Location:** `backend/src/models/`
- **Entities:**
  - User
  - Movie
  - Word
  - UserWordList

#### 4. Services
- **Purpose:** Business logic
- **Location:** `backend/src/services/`
- **Services:**
  - ScriptParser - Parse movie scripts
  - WordAnalyzer - Analyze word frequency and difficulty

#### 5. Middleware
- **Purpose:** Cross-cutting concerns
- **Location:** `backend/src/middleware/`
- **Middleware:**
  - Authentication (JWT verification)
  - Error handling
  - CORS

#### 6. Schemas (Pydantic)
- **Purpose:** Request/response validation
- **Location:** `backend/src/schemas/`
- **Schemas:**
  - UserCreate, UserResponse
  - MovieCreate, MovieResponse
  - WordResponse
  - UserWordListCreate, UserWordListResponse

### Frontend Components

#### 1. Pages
- **Purpose:** Route handlers and page components
- **Location:** `frontend/src/pages/`
- **Pages:**
  - `/` - Landing page
  - `/auth/login` - Login page
  - `/auth/register` - Registration page
  - `/movies` - Movies list page

#### 2. Components
- **Purpose:** Reusable UI components
- **Location:** `frontend/src/components/`
- **Components:**
  - Button
  - Input
  - Card

#### 3. Store (Redux)
- **Purpose:** Global state management
- **Location:** `frontend/src/store/`
- **Slices:**
  - authSlice - Authentication state
  - moviesSlice - Movies state

#### 4. Services
- **Purpose:** API communication
- **Location:** `frontend/src/services/`
- **Services:**
  - api.ts - Axios client with interceptors

## Data Flow

### User Registration Flow

```
User → Frontend → API Service → Backend → Database
  ↓
Frontend ← API Service ← Backend ← Database
```

1. User fills registration form
2. Frontend validates input
3. Frontend sends POST request to `/auth/register`
4. Backend validates data
5. Backend hashes password
6. Backend creates user in database
7. Backend returns user data
8. Frontend stores user in Redux
9. Frontend redirects to movies page

### Movie List Flow

```
User → Frontend → API Service → Backend → Database
  ↓
Frontend ← API Service ← Backend ← Database
```

1. User navigates to movies page
2. Frontend dispatches action to load movies
3. Frontend sends GET request to `/movies/`
4. Backend queries database
5. Backend returns movies list
6. Frontend updates Redux state
7. Frontend renders movies

## Database Schema

### Users Table
- id (PK)
- email (unique)
- username (unique)
- password_hash
- language_preference
- proficiency_level
- is_active
- is_admin
- created_at
- updated_at

### Movies Table
- id (PK)
- title
- year
- genre
- difficulty_level
- script_text
- word_count
- description
- poster_url
- created_at
- updated_at

### Words Table
- id (PK)
- word
- definition
- difficulty_level
- frequency
- part_of_speech
- example_sentence
- translation
- movie_id (FK)

### User_Word_Lists Table
- id (PK)
- user_id (FK)
- word_id (FK)
- list_type
- added_at

## Security

### Authentication
- JWT tokens for session management
- Password hashing with bcrypt
- Token expiration (24 hours by default)

### Authorization
- Role-based access control (admin/user)
- Protected routes with middleware
- User-specific data isolation

### Data Protection
- Input validation with Pydantic
- SQL injection prevention with SQLAlchemy ORM
- XSS protection with React
- CORS configuration

## Scalability

### Horizontal Scaling
- Stateless backend (can run multiple instances)
- Database connection pooling
- Redis for session management

### Performance Optimization
- Database indexing
- Query optimization
- Caching with Redis
- CDN for static assets (future)

## Monitoring & Logging

### Logging
- Application logs
- Error tracking
- Request/response logging

### Health Checks
- `/health` endpoint
- Database connectivity checks
- Service status monitoring

## Future Enhancements

1. **Microservices Architecture**
   - Separate authentication service
   - Separate script processing service
   - Message queue for async tasks

2. **Advanced Features**
   - Real-time notifications
   - WebSocket support
   - Mobile app
   - Chrome extension

3. **Infrastructure**
   - Kubernetes deployment
   - CI/CD pipeline
   - Automated testing
   - Load balancing

## Development Guidelines

### Code Style
- Python: PEP 8
- TypeScript: ESLint + Prettier
- Consistent naming conventions

### Testing
- Unit tests for business logic
- Integration tests for API endpoints
- E2E tests for critical flows

### Documentation
- API documentation with Swagger
- Code comments for complex logic
- README files for setup


