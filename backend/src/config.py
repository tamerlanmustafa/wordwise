from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    # Database
    database_url: str

    # JWT
    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    jwt_expiration_hours: int = 24

    # Application
    app_name: str = "WordWise"
    app_version: str = "1.0.0"
    debug: bool = True

    # CORS
    allowed_origins: str = "http://localhost:3000"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # Google OAuth
    google_client_id: str
    google_client_secret: str
    google_redirect_uri: str = "http://localhost:3000/auth/callback"

    # External APIs
    oxford_api_key: str = ""
    oxford_app_id: str = ""
    google_translate_api_key: str = ""

    # STANDS4 Scripts API
    user_id: str = ""
    token: str = ""
    scripts_url: str = "https://www.stands4.com/services/v2/scripts.php"

    class Config:
        env_file = ".env"
        case_sensitive = False
        # Allow extra env vars if needed
        extra = "forbid"  # or "ignore" if you want to ignore unexpected keys


@lru_cache()
def get_settings() -> Settings:
    return Settings()
