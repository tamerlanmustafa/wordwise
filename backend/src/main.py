# Load backend/.env into the process environment BEFORE Prisma's client
# module imports — the Rust query-engine subprocess inherits this env and
# fails to start without DATABASE_URL. This makes `uvicorn src.main:app`
# work in a fresh shell that hasn't `source .env`'d.
from pathlib import Path as _Path
from dotenv import load_dotenv as _load_dotenv
_load_dotenv(_Path(__file__).parent.parent / '.env')

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from .config import get_settings
from .database import connect_db, disconnect_db
from .routes import auth_router, movies_router, oauth_router, scripts_router, cefr_router, translation_router, tmdb_router, user_words_router, admin_router, enrichment_router, reports_router, upload_router, books_router, interactions_router, srs_router, premium_router, feature_flags_router, billing_router, family_router, gamification_router, social_router, student_discount_router, quiz_router, reel_router, daily_router, consumables_router
from .services import fetch_movie_script
import logging

# Configure logging with rotating file handler
import logging.handlers
from pathlib import Path

# Ensure logs directory exists
logs_dir = Path(__file__).parent.parent / 'logs'
logs_dir.mkdir(exist_ok=True)

# Create formatter
formatter = logging.Formatter(
    '%(asctime)s - %(levelname)s - %(name)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

# Console handler (INFO level)
console_handler = logging.StreamHandler()
console_handler.setLevel(logging.INFO)
console_handler.setFormatter(formatter)

# File handler with rotation (DEBUG level)
file_handler = logging.handlers.RotatingFileHandler(
    logs_dir / 'wordwise.log',
    maxBytes=10 * 1024 * 1024,  # 10 MB
    backupCount=5
)
file_handler.setLevel(logging.DEBUG)
file_handler.setFormatter(formatter)

# Configure root logger
logging.basicConfig(
    level=logging.INFO,
    handlers=[console_handler, file_handler]
)

# Reduce noise from verbose libraries
logging.getLogger('httpx').setLevel(logging.WARNING)
logging.getLogger('httpcore').setLevel(logging.WARNING)
logging.getLogger('prisma').setLevel(logging.WARNING)
logging.getLogger('subliminal').setLevel(logging.WARNING)
logging.getLogger('subliminal.core').setLevel(logging.WARNING)
logging.getLogger('subliminal.score').setLevel(logging.WARNING)
logging.getLogger('subliminal.providers').setLevel(logging.WARNING)

# Suppress BeautifulSoup warnings
import warnings
from bs4 import MarkupResemblesLocatorWarning
warnings.filterwarnings('ignore', category=MarkupResemblesLocatorWarning)

logger = logging.getLogger(__name__)

settings = get_settings()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await connect_db()
    yield
    # Shutdown
    await disconnect_db()

app = FastAPI(
    title=settings.app_name,
    version="2.0.0",  # Updated version with Prisma
    debug=settings.debug,
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth_router)
app.include_router(movies_router)
app.include_router(oauth_router)
app.include_router(scripts_router)
app.include_router(cefr_router)
app.include_router(translation_router)
app.include_router(tmdb_router)
app.include_router(user_words_router)
app.include_router(admin_router)
app.include_router(enrichment_router)
app.include_router(reports_router)
app.include_router(upload_router)
app.include_router(books_router)
app.include_router(interactions_router)
app.include_router(srs_router)
app.include_router(premium_router)
app.include_router(feature_flags_router)
app.include_router(billing_router)
app.include_router(family_router)
app.include_router(gamification_router)
app.include_router(social_router)
app.include_router(student_discount_router)
app.include_router(quiz_router)
app.include_router(reel_router)
app.include_router(daily_router)
app.include_router(consumables_router)

@app.get("/")
def read_root():
    return {"message": "Welcome to WordWise API v2.0 (Prisma)"}

@app.get("/health")
async def health_check():
    return {"status": "healthy", "version": "2.0.0", "database": "Prisma"}
