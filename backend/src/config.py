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
    
    # External APIs
    oxford_api_key: str = ""
    oxford_app_id: str = ""
    google_translate_api_key: str = ""
    
    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    return Settings()


