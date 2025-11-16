#!/bin/bash
set -e

echo "🔧 Installing backend dependencies..."

cd backend

# Create venv if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate venv
source venv/bin/activate

# Upgrade pip for faster installation
echo "Upgrading pip..."
pip install --upgrade pip > /dev/null 2>&1

# Install dependencies with progress
echo "Installing Python packages (this may take 2-3 minutes)..."
pip install -r ../requirements.txt --no-cache-dir

# Download spaCy language model (small English model)
echo "Downloading spaCy language model..."
python -m spacy download en_core_web_sm

# Download NLTK data
echo "Downloading NLTK data..."
python -c "import nltk; nltk.download('punkt'); nltk.download('stopwords'); nltk.download('averaged_perceptron_tagger')"

echo ""
echo "✅ Backend dependencies installed successfully!"
echo ""
echo "Next steps:"
echo "  1. Run: ./db-setup.sh"
echo "  2. Run: cd backend && source venv/bin/activate && alembic upgrade head"
echo "  3. Start backend: ./start-backend.sh"
