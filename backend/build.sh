#!/bin/bash
set -e

echo "Installing Python dependencies..."
pip install -r requirements.txt

echo "Generating Prisma client..."
prisma generate

echo "Downloading NLTK data..."
python -c "import nltk; nltk.download('wordnet', quiet=True); nltk.download('omw-1.4', quiet=True); nltk.download('punkt', quiet=True); print('NLTK data downloaded')"

echo "Build complete!"
