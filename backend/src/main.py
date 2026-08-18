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
from .config import docs_kwargs, get_settings
from .database import connect_db, disconnect_db
from .logging_config import configure_logging
from .middleware import RequestIDMiddleware
from .utils.rate_limit import GlobalRateLimitMiddleware
from .routes import auth_router, movies_router, oauth_router, apple_oauth_router, scripts_router, cefr_router, translation_router, tmdb_router, user_words_router, admin_router, enrichment_router, reports_router, upload_router, books_router, interactions_router, srs_router, premium_router, feature_flags_router, billing_router, family_router, gamification_router, social_router, student_discount_router, quiz_router, reel_router, daily_router, consumables_router, lists_router
from .services import fetch_movie_script
from .services.event_loop_lag import start_watchdog
import asyncio
import logging
from pathlib import Path

settings = get_settings()

# Structured (JSON) logging + per-request correlation ids for the whole app.
# Console emits DEBUG when settings.debug is on, INFO otherwise (prod default);
# the rotating file keeps DEBUG for post-mortems.
logs_dir = Path(__file__).parent.parent / 'logs'
configure_logging(
    debug=settings.debug,
    service="api",
    log_file=logs_dir / 'wordwise.log',
)

# Suppress BeautifulSoup warnings
import warnings
from bs4 import MarkupResemblesLocatorWarning
warnings.filterwarnings('ignore', category=MarkupResemblesLocatorWarning)

logger = logging.getLogger(__name__)

async def _warm_nlp_model():
    """
    Load the spaCy model on the NLP worker thread at boot.

    The model is lazily loaded on first use and takes ~1.8s to build, so
    without this that cost lands on whichever user request happens to arrive
    first after a deploy or a restart (issue #106, option 3). Doing it here
    means it lands on nobody.

    Deliberately fire-and-forget: it must not delay the server accepting
    traffic, and it must not stop the app booting in environments where spaCy
    isn't installed (CI, the test env) — hence the broad except.
    """
    try:
        from .services.lemmatization_service import get_nlp
        from .utils.nlp_executor import run_nlp

        await run_nlp(get_nlp)
        logger.info("spaCy model warmed on the NLP worker thread")
    except Exception as e:
        logger.warning(f"spaCy warmup skipped: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await connect_db()
    warmup = asyncio.create_task(_warm_nlp_model())
    # The event-loop lag watchdog (issue #146). Blocking work inside an
    # `async def` is invisible to the linter, to a single-user test and to code
    # review; this probe is the layer that notices it at runtime, by measuring
    # how late its own sleep comes back. Started here so it covers the whole
    # serving lifetime, including the warmup above.
    watchdog = start_watchdog() if settings.event_loop_watchdog_enabled else None
    yield
    # Shutdown
    warmup.cancel()
    if watchdog is not None:
        watchdog.cancel()
    await disconnect_db()

app = FastAPI(
    title=settings.app_name,
    version="2.0.0",  # Updated version with Prisma
    debug=settings.debug,
    lifespan=lifespan,
    **docs_kwargs(settings.debug),
)

# App-wide rate limit (issue #74). Added first so it sits innermost — inside
# CORS, so 429 responses still carry CORS headers for browser clients, and
# inside RequestIDMiddleware, so every throttled request is still logged with a
# correlation id. Per-endpoint throttles in routes/ stack on top for
# cost-incurring paths (translation, LLM enrichment).
if settings.rate_limit_enabled and settings.rate_limit_per_minute > 0:
    app.add_middleware(
        GlobalRateLimitMiddleware,
        limit=settings.rate_limit_per_minute,
        window_seconds=60.0,
    )

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # Let browser clients read the correlation id off the response.
    expose_headers=["X-Request-ID"],
)

# Added last so it sits outermost: every request gets a correlation id before
# CORS/routing runs, and the id is stamped onto all logs for that request.
app.add_middleware(RequestIDMiddleware)

# Routers
app.include_router(auth_router)
app.include_router(movies_router)
app.include_router(oauth_router)
app.include_router(apple_oauth_router)
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
app.include_router(lists_router)

@app.get("/")
def read_root():
    return {"message": "Welcome to WordWise API v2.0 (Prisma)"}

@app.get("/health")
async def health_check():
    return {"status": "healthy", "version": "2.0.0", "database": "Prisma"}
