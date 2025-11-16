from .auth import router as auth_router
from .movies import router as movies_router
from .users import router as users_router
from .oauth import router as oauth_router  # ADD THIS

__all__ = ["auth_router", "movies_router", "users_router", "oauth_router"]  # ADD oauth_router