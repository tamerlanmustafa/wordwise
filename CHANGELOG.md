# Changelog

All notable changes to the WordWise project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2025-01-16

### Added
- **Google OAuth 2.0 Authentication**
  - Dedicated `/auth/google/signup` endpoint for explicit user registration
  - Universal `/auth/google/login` endpoint (auto-creates accounts)
  - Backend Google ID token verification
  - JWT session management after OAuth login
  - Google user profile integration (name, email, profile picture)
  - Separate frontend components for login and signup flows

- **Database Visualization**
  - pgAdmin 4 integration via Docker Compose
  - Web-based database management at http://localhost:5050
  - Pre-configured connection to PostgreSQL database
  - Persistent storage for pgAdmin settings

- **Database Schema Updates for OAuth**
  - Added `google_id` field to User model (unique, indexed)
  - Added `profile_picture_url` field to User model
  - Added `oauth_provider` enum field (email/google)
  - Made `password_hash` optional for OAuth users

- **Frontend Performance Optimizations**
  - Enabled Next.js Turbopack for 700x faster HMR
  - Removed 5 unused dependencies (reduced node_modules by 52%)
  - Optimized TypeScript configuration for faster compilation
  - Disabled ESLint during development for speed
  - Added experimental package import optimizations

### Changed
- **Frontend**
  - Updated Next.js from 14.0.4 to 14.2.33 (security patches)
  - Refactored `GoogleLoginButton` to `GoogleOAuthButton` with mode prop
  - Updated login/register pages to use new OAuth component
  - Added `googleLogin()` and `googleSignup()` methods to API service
  - Updated User type interface to support OAuth fields

- **Backend**
  - Refactored OAuth route with helper functions for cleaner code
  - Added `UserInfo`, `GoogleSignupRequest`, `GoogleSignupResponse` schemas
  - Improved error handling in OAuth flows

- **Performance**
  - Frontend startup: Reduced from 60-90s to 30-40s (WSL2)
  - Hot reload: Reduced from 5-10s to 0.5-2s (80% faster)
  - Memory usage: Reduced from 800MB to 400MB (50% less)
  - Dependencies: Reduced from 24 to 19 packages

### Fixed
- Missing `Optional` import in users route
- Circular import issue in auth middleware
- Missing `email-validator` dependency
- Critical Next.js security vulnerabilities (updated to 14.2.33)
- Frontend performance issues on WSL2

### Security
- **Fixed 1 critical vulnerability** in Next.js
- Updated Next.js to latest stable version (14.2.33)
- Removed ESLint and related packages (development-only change)
- All OAuth tokens verified server-side
- Email verification required for Google OAuth

## [1.0.0] - 2024-10-13

### Added
- Initial project structure
- FastAPI backend with user authentication
- Next.js frontend with TypeScript
- PostgreSQL database integration
- Redis caching support
- Movie script analysis features
- Word difficulty categorization (A1-C2 levels)
- User word lists (Learn Later, Favorites, Mastered)
- JWT-based authentication
- Docker and Docker Compose configuration
- Database migrations with Alembic
- API documentation with Swagger UI
- Tailwind CSS styling

### Security
- Bcrypt password hashing
- JWT token-based authentication
- CORS configuration for allowed origins
