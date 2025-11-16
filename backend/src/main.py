from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import get_settings
from .database import engine, Base
from .routes import auth_router, movies_router, users_router,users_router, oauth_router 

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version, 
    debug=settings.debug
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
app.include_router(oauth_router)  # ADD THIS

@app.get("/")
def read_root():
    return {"message": "Welcome to WordWise API"}

@app.get("/health")
def health_check():
    return {"status": "healthy"}