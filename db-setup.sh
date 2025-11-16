#!/bin/bash
# Database setup script - run this once to set up the database
echo "🔧 Setting up PostgreSQL database for WordWise..."

# Drop and recreate for clean setup
sudo -u postgres psql << EOF
-- Drop existing (if any)
DROP DATABASE IF EXISTS wordwise_db;
DROP USER IF EXISTS wordwise_user;

-- Create user
CREATE USER wordwise_user WITH PASSWORD 'wordwise_password';

-- Create database
CREATE DATABASE wordwise_db OWNER wordwise_user;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE wordwise_db TO wordwise_user;

-- Connect and grant schema permissions
\c wordwise_db

GRANT ALL ON SCHEMA public TO wordwise_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO wordwise_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO wordwise_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO wordwise_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO wordwise_user;

EOF

echo ""
echo "✅ Database setup complete!"
echo ""
echo "Next step: Run migrations"
echo "  cd backend && source venv/bin/activate && alembic upgrade head"
