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

    # How many characters one account may submit to the translate endpoints
    # per UTC day (issue #152). Providers bill per character, so this is the
    # limit that bounds *cost*; the per-minute throttles above only bound
    # request count, which is meaningless while request size is unbounded.
    #
    # Configurable rather than a constant because the shipping app's sentence
    # translations (TodayWordCard) have no usage history to size against yet —
    # if a real user is ever cut off, this can be raised in Railway without a
    # deploy. See routes/translation.py for how the default was chosen.
    translation_daily_char_budget: int = 50_000

    # Event-loop lag watchdog (issue #146): a background probe that measures
    # how late `asyncio.sleep` comes back, which is exactly how long the loop
    # spent blocked and unavailable to every other request. Feeds
    # GET /admin/health/event-loop and logs a WARNING per stall. Costs ~20
    # no-op wakeups a second; the switch exists so it can be turned off
    # without a code change, not because it is expected to be.
    event_loop_watchdog_enabled: bool = True

    # How many proxies sit between the caller and this process, each appending
    # to X-Forwarded-For. The caller's address is that many entries from the
    # RIGHT of the header; counting from the right is what stops a caller
    # forging their own identity by prepending to it.
    #
    # 0 (the default) ignores the header and keys on the socket peer — right
    # for a directly-exposed process, and a safe default because it fails
    # closed: callers share a bucket rather than each minting their own.
    #
    # Prod deliberately leaves this UNSET (issue #139). Railway discards the
    # X-Forwarded-For that Cloudflare sends and rebuilds its own, so the caller
    # is at no index of the header there: 1 resolves to the Railway edge pool
    # and 2 to a Cloudflare egress address, neither of which is per-caller.
    # Setting it on Railway buys nothing and a value that is too high hands out
    # spoofable identities. Use `trusted_client_ip_header` below instead.
    trusted_proxy_hops: int = 0

    # Where the caller's address actually is on a CDN-fronted deployment
    # (issue #139). A CDN that terminates the connection knows the real client
    # and puts it in a single-value header of its own — Cloudflare uses
    # `CF-Connecting-IP` — which survives Railway rewriting X-Forwarded-For.
    #
    # Empty (the default) ignores it and falls back to `trusted_proxy_hops`,
    # so an environment with no CDN in front is unaffected.
    trusted_client_ip_header: str = ""
    # ...but a header is only as trustworthy as the guarantee that it came from
    # the CDN. The Railway origin still answers requests that never went
    # through Cloudflare, so trusting the header on its own would let anyone
    # mint an identity by hitting the origin directly — strictly worse than
    # sharing a bucket. The CDN therefore has to prove it is the CDN: a
    # Cloudflare Transform Rule sets a secret header on every request to the
    # origin, and `trusted_client_ip_header` is honoured ONLY when it matches.
    #
    # Both must be set for the client-IP header to be read at all. That is the
    # fail-closed half of this feature and is enforced in utils/rate_limit.py —
    # do not relax it without an origin lockdown (Cloudflare IP allowlist or
    # authenticated origin pull) taking its place.
    trusted_client_ip_secret_header: str = ""
    trusted_client_ip_secret: str = ""

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

    # Transactional email (Resend). Empty key ⇒ every send is a logged no-op,
    # so local dev/tests never touch the network and prod stays safe until the
    # key is set in Railway. The FROM domain must be verified in Resend.
    resend_api_key: str = ""
    email_from: str = "WordWise <no-reply@getwordwise.us>"
    # Public base URL of this API — used to build the email-verification link.
    api_public_url: str = "https://api.getwordwise.us"

    # Anthropic (LLM example sentence generation)
    anthropic_api_key: str = ""
    # Haiku: ~3× cheaper than Sonnet and indistinguishable on this task
    # (short constrained example sentences) — see issue #86. Every model
    # named here must have a row in llm_sentence_service._PRICING or cost
    # tracking silently records $0.
    anthropic_sentence_model: str = "claude-haiku-4-5-20251001"
    # Hard ceiling on cumulative Anthropic spend (USD) recorded in
    # llm_usage_ledger. Before each LLM call we read total spend
    # (services/llm_cost_ledger.py, which reads it without scanning the whole
    # table) and refuse to fire at or above this number. 0 disables the cap.
    # Prod sets this in Railway on BOTH `wordwise` and `Worker`; this default
    # only applies where the env var is missing.
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
