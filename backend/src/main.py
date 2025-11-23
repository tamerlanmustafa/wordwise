from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from .config import get_settings
from .database import connect_db, disconnect_db
from .routes import auth_router, movies_router, users_router, oauth_router, scripts_router
from .services import fetch_movie_script
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s:%(name)s:%(message)s'
)
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
app.include_router(users_router)
app.include_router(oauth_router)
app.include_router(scripts_router)

@app.get("/")
def read_root():
    return {"message": "Welcome to WordWise API v2.0 (Prisma)"}

@app.get("/health")
async def health_check():
    return {"status": "healthy", "version": "2.0.0", "database": "Prisma"}
