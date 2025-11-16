#!/bin/bash
# Simple database setup - no password needed for postgres user
echo "🔧 Setting up PostgreSQL database for WordWise..."

# Use sudo to run as postgres user (peer authentication via Unix socket)
sudo -u postgres psql << 'EOF'
-- Drop existing (if any)
DROP DATABASE IF EXISTS wordwise_db;
DROP USER IF EXISTS wordwise_user;

-- Create user with password
CREATE USER wordwise_user WITH PASSWORD 'wordwise_password';

-- Create database
CREATE DATABASE wordwise_db OWNER wordwise_user;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE wordwise_db TO wordwise_user;
EOF

# Connect to the database and grant schema permissions
sudo -u postgres psql -d wordwise_db << 'EOF'
GRANT ALL ON SCHEMA public TO wordwise_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO wordwise_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO wordwise_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO wordwise_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO wordwise_user;
EOF

echo ""
echo "✅ Database setup complete!"
echo ""
echo "Verifying connection..."
if PGPASSWORD=wordwise_password psql -h localhost -U wordwise_user -d wordwise_db -c "SELECT 1" > /dev/null 2>&1; then
    echo "✅ Database connection test PASSED!"
    echo ""
    echo "Next step: Run migrations"
    echo "  cd backend && source venv/bin/activate && alembic upgrade head"
else
    echo "⚠️  Connection test failed. You may need to update pg_hba.conf"
    echo "Run: sudo nano /etc/postgresql/*/main/pg_hba.conf"
    echo "Add line: host    all             all             127.0.0.1/32            md5"
    echo "Then: sudo service postgresql restart"
fi
