from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    # Database
    database_url: str

    # JWT
    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    jwt_expiration_hours: int = 24
    # Refresh tokens outlive the access token so a client can mint a new
    # access token without forcing the user to log in again every day.
    jwt_refresh_expiration_days: int = 60

    #TMDB API
    tmdb_api_key: str

    # Application
    app_name: str = "WordWise"
    app_version: str = "1.0.0"
    # Default OFF so production never leaks tracebacks; set DEBUG=true in a
    # local .env for development.
    debug: bool = False

    # CORS
    allowed_origins: str = "http://localhost:3000"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # Rate limiting (issue #74): an app-wide abuse ceiling applied by
    # GlobalRateLimitMiddleware, keyed by authenticated user id (falls back to
    # client IP). Per-endpoint throttles in routes/ stack on top for
    # cost-incurring paths (translation, LLM enrichment). Set enabled=False or
    # per_minute=0 to disable the global limiter (e.g. for load tests).
    rate_limit_enabled: bool = True
    rate_limit_per_minute: int = 600

    # Sign in with Apple: identity tokens are verified against Apple's JWKS
    # with our bundle id as the required audience (utils/apple_auth.py).
    apple_bundle_id: str = "com.wordwise.mobile"

    # Google OAuth
    google_client_id: str
    google_client_id_prod: str = ""
    google_client_id_mobile: str = ""
    # Optional: auth uses Google ID-token verification (google_auth.py), which
    # only needs the client ID(s). No code reads the secret today; it's kept for
    # a future authorization-code flow. Defaulted so deploys don't require it.
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:3000/auth/callback"

    # External APIs
    oxford_api_key: str = ""
    oxford_app_id: str = ""
    google_translate_api_key: str = ""

    # STANDS4 Scripts API
    stands4_user_id: str = ""
    stands4_token: str = ""
    scripts_url: str = "https://www.stands4.com/services/v2/scripts.php"

    # DeepL Translation API
    deepl_api_key: str = ""
    deepl_plan: str = "free"

    # Google Cloud Translate API (fallback)
    google_application_credentials: str = ""
    google_translate_enabled: str = "false"

    # Anthropic (LLM example sentence generation)
    anthropic_api_key: str = ""
    # Haiku: ~3× cheaper than Sonnet and indistinguishable on this task
    # (short constrained example sentences) — see issue #86. Every model
    # named here must have a row in llm_sentence_service._PRICING or cost
    # tracking silently records $0.
    anthropic_sentence_model: str = "claude-haiku-4-5-20251001"
    # Hard ceiling on cumulative Anthropic spend (USD) recorded in
    # llm_usage_ledger. Before each LLM call we sum the ledger and refuse
    # to fire if we're already at or above this number. Set to 0 to disable.
    llm_cost_cap_usd: float = 50.0

    class Config:
        env_file = ".env"
        case_sensitive = False
        # Allow extra env vars if needed
        extra = "forbid"  # or "ignore" if you want to ignore unexpected keys


def docs_kwargs(debug: bool) -> dict[str, str | None]:
    """FastAPI kwargs that expose the interactive docs only when debug is on.

    Production serves the docs as None so the full route surface isn't
    publicly enumerable (DEPLOYMENT.md §9.4); locally they stay at their
    FastAPI defaults.
    """
    if not debug:
        return {"docs_url": None, "redoc_url": None, "openapi_url": None}
    return {"docs_url": "/docs", "redoc_url": "/redoc", "openapi_url": "/openapi.json"}


@lru_cache()
def get_settings() -> Settings:
    return Settings()
