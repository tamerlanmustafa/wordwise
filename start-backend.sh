#!/bin/bash
cd "$(dirname "$0")/backend"
source venv/bin/activate
echo "🚀 Starting backend server at http://localhost:8000"
echo "📚 API docs at http://localhost:8000/docs"
uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
