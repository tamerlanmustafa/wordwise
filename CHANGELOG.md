# Changelog

All notable changes to the WordWise project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Google Single Sign-On (OAuth 2.0) authentication
  - Google OAuth login and signup functionality
  - Backend Google ID token verification
  - JWT session management after OAuth login
  - Google user profile integration (name, email, profile picture)
- Database schema updates for OAuth support
  - Added `google_id` field to User model
  - Added `profile_picture_url` field to User model
  - Added `oauth_provider` field to track authentication method
  - Made `password_hash` optional for OAuth users
- Backend OAuth routes
  - `POST /auth/google` - Google OAuth login/signup endpoint
  - Google ID token verification utility
  - Automatic user creation for new Google accounts
- Frontend Google OAuth components
  - GoogleLoginButton component with Google branding
  - OAuth callback handler
  - Google OAuth configuration and state management
- Documentation
  - Google OAuth setup instructions
  - Environment variable configuration guide
  - Local development setup guide (non-Docker)
  - Database setup scripts for local development

### Changed
- User model now supports multiple authentication methods (email/password and Google OAuth)
- Authentication flow updated to handle both traditional and OAuth logins
- Environment configuration expanded to include Google OAuth credentials

### Fixed
- Missing `Optional` import in users route
- Circular import issue in auth middleware
- Missing `email-validator` dependency

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
