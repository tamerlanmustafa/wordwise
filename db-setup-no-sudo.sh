#!/bin/bash
# Database setup without needing postgres user access
echo "🔧 Setting up PostgreSQL database for WordWise (no sudo needed)..."

# Check if current user has createdb privileges
echo "Attempting to create database as current user..."

# Drop existing database and user if they exist
dropdb wordwise_db 2>/dev/null || true
dropuser wordwise_user 2>/dev/null || true

# Create user with password
echo "Creating database user..."
if createuser wordwise_user 2>/dev/null; then
    echo "✅ User created"
else
    echo "⚠️  User might already exist or you lack privileges"
fi

# Create database
echo "Creating database..."
if createdb -O wordwise_user wordwise_db 2>/dev/null; then
    echo "✅ Database created"
else
    echo "❌ Failed to create database"
    echo ""
    echo "You need to run the PostgreSQL setup commands manually:"
    echo "1. Edit pg_hba.conf: sudo nano /etc/postgresql/*/main/pg_hba.conf"
    echo "2. Change 'peer' to 'trust' for local connections"
    echo "3. Restart PostgreSQL: sudo service postgresql restart"
    echo "4. Run this script again"
    exit 1
fi

# Set password
echo "Setting password..."
psql -d wordwise_db -c "ALTER USER wordwise_user WITH PASSWORD 'wordwise_password';" 2>/dev/null

# Grant permissions
echo "Granting permissions..."
psql -d wordwise_db << 'EOF' 2>/dev/null
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
    echo "🎉 All set! Next step: Run migrations"
    echo "  cd backend && source venv/bin/activate && alembic upgrade head"
else
    echo "⚠️  Connection test failed"
    echo ""
    echo "The database was created but password authentication might not be enabled."
    echo "Fix by editing: sudo nano /etc/postgresql/*/main/pg_hba.conf"
    echo "Add this line: host    all             all             127.0.0.1/32            md5"
    echo "Then restart: sudo service postgresql restart"
fi
