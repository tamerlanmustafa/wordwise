#!/bin/bash

# Script Ingestion System Setup Script
# This script sets up the complete multi-source script ingestion system

set -e

echo "========================================="
echo "WordWise Script Ingestion System Setup"
echo "========================================="

# Check if running inside Docker container
if [ -f /.dockerenv ]; then
    echo "Running inside Docker container"
    DOCKER_EXEC=""
else
    echo "Running on host, using docker exec"
    DOCKER_EXEC="docker exec wordwise_backend"
fi

echo ""
echo "Step 1: Installing Python dependencies..."
echo "-------------------------------------------"
$DOCKER_EXEC pip install pdfplumber==0.11.0 pypdf==4.0.1 beautifulsoup4==4.12.3 lxml==5.1.0 chardet==5.2.0

echo ""
echo "Step 2: Generating Prisma client with new schema..."
echo "-------------------------------------------"
$DOCKER_EXEC prisma generate

echo ""
echo "Step 3: Creating database migration..."
echo "-------------------------------------------"
# Note: This will create but not apply the migration
# You'll need to review and apply it manually
$DOCKER_EXEC prisma migrate dev --name add_movie_scripts_table

echo ""
echo "========================================="
echo "✓ Setup Complete!"
echo "========================================="
echo ""
echo "The script ingestion system is now ready!"
echo ""
echo "Available endpoints:"
echo "  POST /api/scripts/fetch  - Fetch or retrieve a script"
echo "  GET  /api/scripts/get    - Get cached script only"
echo "  GET  /api/scripts/search - Check if script is cached"
echo "  GET  /api/scripts/stats  - Get library statistics"
echo ""
echo "Next steps:"
echo "1. Restart the backend container: docker-compose restart backend"
echo "2. Test the endpoints using the API documentation at http://localhost:8000/docs"
echo "3. Try fetching a script: curl -X POST http://localhost:8000/api/scripts/fetch -H 'Content-Type: application/json' -d '{\"movie_title\": \"The Matrix\"}'"
echo ""
