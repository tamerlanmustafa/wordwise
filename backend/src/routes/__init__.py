from .auth import router as auth_router
from .movies import router as movies_router
from .oauth import router as oauth_router
from .scripts import router as scripts_router
from .cefr import router as cefr_router
from .translation import router as translation_router
from .tmdb import router as tmdb_router
from .user_words import router as user_words_router
from .admin import router as admin_router
from .enrichment import router as enrichment_router
from .reports import router as reports_router
from .upload import router as upload_router
from .books import router as books_router
from .interactions import router as interactions_router
from .srs import router as srs_router
from .premium import router as premium_router
from .feature_flags import router as feature_flags_router
from .billing import router as billing_router
from .family import router as family_router
from .gamification import router as gamification_router
from .social import router as social_router
from .student_discount import router as student_discount_router
from .quiz import router as quiz_router
from .reel import router as reel_router
from .daily import router as daily_router
from .consumables import router as consumables_router

__all__ = ["auth_router", "movies_router", "oauth_router", "scripts_router", "cefr_router", "translation_router", "tmdb_router", "user_words_router", "admin_router", "enrichment_router", "reports_router", "upload_router", "books_router", "interactions_router", "srs_router", "premium_router", "feature_flags_router", "billing_router", "family_router", "gamification_router", "social_router", "student_discount_router", "quiz_router", "reel_router", "daily_router", "consumables_router"]