from .auth import router as auth_router
from .movies import router as movies_router
from .users import router as users_router
from .oauth import router as oauth_router
from .scripts import router as scripts_router
from .cefr import router as cefr_router
from .translation import router as translation_router
from .tmdb import router as tmdb_router
from .user_words import router as user_words_router

__all__ = ["auth_router", "movies_router", "users_router", "oauth_router", "scripts_router", "cefr_router", "translation_router", "tmdb_router", "user_words_router"]