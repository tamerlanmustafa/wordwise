#!/bin/bash

echo "🔍 Testing database connection..."
echo ""

# Test 1: Check if PostgreSQL is running
echo "1. Checking PostgreSQL service..."
if pg_isready -h localhost > /dev/null 2>&1; then
    echo "✅ PostgreSQL is running"
else
    echo "❌ PostgreSQL is not running"
    echo "   Run: sudo service postgresql start"
    exit 1
fi

# Test 2: Check if user exists
echo ""
echo "2. Checking if wordwise_user exists..."
USER_EXISTS=$(sudo -u postgres psql -h localhost -tAc "SELECT 1 FROM pg_roles WHERE rolname='wordwise_user'" 2>/dev/null || echo "")
if [ "$USER_EXISTS" = "1" ]; then
    echo "✅ User wordwise_user exists"
else
    echo "❌ User wordwise_user does not exist"
    echo "   Run: sudo ./db-setup.sh"
    exit 1
fi

# Test 3: Check if database exists
echo ""
echo "3. Checking if wordwise_db exists..."
DB_EXISTS=$(sudo -u postgres psql -h localhost -tAc "SELECT 1 FROM pg_database WHERE datname='wordwise_db'" 2>/dev/null || echo "")
if [ "$DB_EXISTS" = "1" ]; then
    echo "✅ Database wordwise_db exists"
else
    echo "❌ Database wordwise_db does not exist"
    echo "   Run: sudo ./db-setup.sh"
    exit 1
fi

# Test 4: Test connection with password
echo ""
echo "4. Testing connection with password..."
if PGPASSWORD=wordwise_password psql -h localhost -U wordwise_user -d wordwise_db -c "SELECT 1" > /dev/null 2>&1; then
    echo "✅ Connection successful!"
else
    echo "❌ Connection failed"
    echo ""
    echo "Checking pg_hba.conf authentication..."
    sudo -u postgres psql -c "SHOW hba_file;"
    echo ""
    echo "Try updating PostgreSQL authentication:"
    echo "  1. sudo nano /etc/postgresql/*/main/pg_hba.conf"
    echo "  2. Change the line for 'local all all' from 'peer' to 'md5'"
    echo "  3. sudo service postgresql restart"
    exit 1
fi

echo ""
echo "🎉 All database checks passed!"
echo ""
echo "You can now run migrations:"
echo "  cd backend && source venv/bin/activate && alembic upgrade head"
