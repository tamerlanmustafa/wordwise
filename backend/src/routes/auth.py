import logging
from fastapi import APIRouter, BackgroundTasks, Depends, Form, Header, HTTPException, status
from fastapi.responses import HTMLResponse
from prisma import Prisma
from datetime import timedelta
from ..database import get_db
from ..schemas.user import (
    UserCreate, UserResponse, UserLogin, AuthResponse, UserUpdate,
    RefreshRequest, RefreshResponse, ForgotPasswordRequest, SUPPORTED_LANGUAGES,
)
from ..utils.auth import (
    verify_password, get_password_hash, create_access_token,
    create_refresh_token, create_password_reset_token,
    password_hash_fingerprint, verify_token,
)
from ..config import get_settings
from ..middleware.auth import get_current_user
from ..utils.rate_limit import rate_limit
from ..services import email_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()

# Throttle the unauthenticated credential endpoints to blunt brute-force /
# credential-stuffing / account-enumeration attempts. Keyed per-IP.
_login_throttle = rate_limit(10, 60.0, scope="auth-login")
_register_throttle = rate_limit(5, 60.0, scope="auth-register")
_refresh_throttle = rate_limit(30, 60.0, scope="auth-refresh")


def _issue_tokens(user) -> tuple[str, str]:
    """Mint an (access, refresh) token pair for a user. Single source of
    truth so every auth entry point (register/login/refresh) stays in sync."""
    payload = {"sub": str(user.id), "email": user.email}
    access_token = create_access_token(
        data=payload,
        expires_delta=timedelta(hours=settings.jwt_expiration_hours),
    )
    refresh_token = create_refresh_token(
        data=payload,
        expires_delta=timedelta(days=settings.jwt_refresh_expiration_days),
    )
    return access_token, refresh_token


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(
    user_data: UserCreate,
    background_tasks: BackgroundTasks,
    db: Prisma = Depends(get_db),
    _: None = Depends(_register_throttle),
):
    """Register a new user"""
    # Check if email already exists
    existing_user = await db.user.find_unique(where={"email": user_data.email})
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )

    # Check if username already exists
    existing_username = await db.user.find_unique(where={"username": user_data.username})
    if existing_username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already taken"
        )

    # Create new user
    hashed_password = get_password_hash(user_data.password)
    new_user = await db.user.create(
        data={
            "email": user_data.email,
            "username": user_data.username,
            "passwordHash": hashed_password,
            "languagePreference": user_data.language_preference,
            "nativeLanguage": user_data.native_language,
            "learningLanguage": user_data.learning_language,
            "proficiencyLevel": user_data.proficiency_level,
            "oauthProvider": "email",
            "isActive": True,
            "isAdmin": False
        }
    )

    # Create token pair (sub must be a string for JWT compliance)
    access_token, refresh_token = _issue_tokens(new_user)

    # Email after the response is sent — signup latency and success never
    # depend on the email provider (email_service never raises).
    background_tasks.add_task(
        email_service.send_welcome_email, new_user.email, new_user.username
    )

    return {
        "user": new_user,
        "token": access_token,
        "refresh_token": refresh_token,
    }


@router.post("/login", response_model=AuthResponse)
async def login(
    credentials: UserLogin,
    db: Prisma = Depends(get_db),
    _: None = Depends(_login_throttle),
):
    """Login user and return JWT token"""
    logger.info("Login attempt for email: %s", credentials.email)
    user = await db.user.find_unique(where={"email": credentials.email})

    if not user or not user.passwordHash or not verify_password(credentials.password, user.passwordHash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.isActive:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user"
        )

    # Create token pair (sub must be a string for JWT compliance)
    access_token, refresh_token = _issue_tokens(user)

    return {
        "user": user,
        "token": access_token,
        "refresh_token": refresh_token,
    }


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(current_user = Depends(get_current_user)):
    """Get current user information"""
    # Prisma returns camelCase attrs; UserResponse.model_validate handles
    # the camelCase→snake_case mapping AND attaches entitlements. Calling
    # it explicitly avoids FastAPI's default serializer, which would read
    # snake_case attributes that don't exist on the Prisma object.
    return UserResponse.model_validate(current_user)


@router.post("/refresh", response_model=RefreshResponse)
async def refresh_token(
    body: RefreshRequest | None = None,
    authorization: str | None = Header(default=None),
    db: Prisma = Depends(get_db),
    _: None = Depends(_refresh_throttle),
):
    """Exchange a token for a fresh access+refresh pair.

    Deliberately does NOT depend on `get_current_user`: the whole point is
    to work when the *access* token has expired. Two accepted shapes:

      • Mobile (preferred): a long-lived refresh token in the JSON body.
        We require `type == "refresh"` and rotate the refresh token, so a
        leaked-and-used token dies as soon as the real client refreshes.
      • Web (legacy): the access token in the Authorization header with an
        empty body. Only succeeds while that access token is still valid —
        unchanged from the endpoint's prior behavior.
    """
    invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired refresh token",
        headers={"WWW-Authenticate": "Bearer"},
    )

    token_str = body.refresh_token if body else None
    # Only enforce the refresh-type guard on the body path; the legacy
    # header path carries an access token by design.
    require_refresh_type = token_str is not None
    if token_str is None and authorization and authorization.lower().startswith("bearer "):
        token_str = authorization[7:].strip()
    if not token_str:
        raise invalid

    payload = verify_token(token_str)
    # verify_token returns None on bad signature OR expiry. On the body
    # path also reject an access token presented as a refresh token.
    if payload is None or (require_refresh_type and payload.get("type") != "refresh"):
        raise invalid

    user_id_str = payload.get("sub")
    try:
        user_id = int(user_id_str)
    except (ValueError, TypeError):
        raise invalid

    user = await db.user.find_unique(where={"id": user_id})
    if user is None or not user.isActive:
        raise invalid

    access_token, new_refresh_token = _issue_tokens(user)
    return {
        "token": access_token,
        "refresh_token": new_refresh_token,
        "user": user,
    }


@router.patch("/me", response_model=UserResponse)
async def update_user_profile(
    user_update: UserUpdate,
    current_user = Depends(get_current_user),
    db: Prisma = Depends(get_db)
):
    """Update current user's profile"""
    update_data = {}

    if user_update.username is not None:
        # Check if username is already taken
        existing = await db.user.find_first(
            where={"username": user_update.username, "id": {"not": current_user.id}}
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already taken"
            )
        update_data["username"] = user_update.username

    if user_update.language_preference is not None:
        update_data["languagePreference"] = user_update.language_preference

    if user_update.native_language is not None:
        if user_update.native_language not in SUPPORTED_LANGUAGES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported language: {user_update.native_language}"
            )
        update_data["nativeLanguage"] = user_update.native_language

    if user_update.learning_language is not None:
        if user_update.learning_language not in SUPPORTED_LANGUAGES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported language: {user_update.learning_language}"
            )
        update_data["learningLanguage"] = user_update.learning_language

    if user_update.proficiency_level is not None:
        update_data["proficiencyLevel"] = user_update.proficiency_level

    if user_update.default_tab is not None:
        if user_update.default_tab not in ["movies", "books"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid default_tab: {user_update.default_tab}. Must be 'movies' or 'books'"
            )
        update_data["defaultTab"] = user_update.default_tab

    if not update_data:
        return current_user

    updated_user = await db.user.update(
        where={"id": current_user.id},
        data=update_data
    )

    return updated_user


# ── Password reset ───────────────────────────────────────────────────────────
# Fully backend-served: the emailed link opens an HTML form here (a mail
# client can't deep-link into the app), the form posts back, and the app is
# only involved again at the next login. The token embeds a fingerprint of
# the CURRENT password hash, so issued links die as soon as the password
# changes — single-use without any server-side token store.

_forgot_password_throttle = rate_limit(3, 600.0, scope="auth-forgot-password")
_reset_password_throttle = rate_limit(10, 60.0, scope="auth-reset-password")

# Mirrors UserCreate's validator: bcrypt silently truncates beyond 72 bytes.
_PASSWORD_MIN_CHARS = 8
_PASSWORD_MAX_BYTES = 72


def _auth_page(title: str, message: str, extra_html: str = "") -> str:
    """Small branded page for auth flows opened from a mail client."""
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} — WordWise</title></head>
<body style="margin:0;padding:48px 16px;background:#f4efe7;font-family:Georgia,serif;text-align:center;">
  <div style="max-width:420px;margin:0 auto;background:#fff;border:1px solid #e5dcc9;border-radius:12px;padding:32px;">
    <div style="color:#d4af37;font-size:20px;font-weight:bold;letter-spacing:1px;margin-bottom:16px;">WordWise</div>
    <h1 style="font-size:20px;color:#2b2620;margin:0 0 10px;">{title}</h1>
    <p style="color:#6b6355;font-size:15px;line-height:1.5;margin:0;">{message}</p>
    {extra_html}
  </div>
</body></html>"""


_RESET_LINK_DEAD = (
    "This reset link is no longer valid. Links last 30 minutes and die once "
    "the password changes — request a fresh one from the app's login screen."
)


async def _user_for_reset_token(token: str, db: Prisma):
    """Resolve a reset token to its user, or None if anything is off:
    wrong type, expired, unknown user, changed email, or already-used
    (password-hash fingerprint no longer matches)."""
    payload = verify_token(token)
    if payload is None or payload.get("type") != "password_reset":
        return None
    try:
        user_id = int(payload.get("sub"))
    except (ValueError, TypeError):
        return None
    user = await db.user.find_unique(where={"id": user_id})
    if user is None or not user.isActive or user.email != payload.get("email"):
        return None
    if not user.passwordHash or password_hash_fingerprint(user.passwordHash) != payload.get("pwh"):
        return None
    return user


@router.post("/forgot-password", status_code=status.HTTP_202_ACCEPTED)
async def forgot_password(
    body: ForgotPasswordRequest,
    background_tasks: BackgroundTasks,
    db: Prisma = Depends(get_db),
    _: None = Depends(_forgot_password_throttle),
):
    """Email a single-use reset link. Always answers 202 with the same body
    so the endpoint can't be used to enumerate accounts. OAuth-only accounts
    (no password to reset) are skipped silently for the same reason."""
    user = await db.user.find_unique(where={"email": body.email})
    if user and user.isActive and user.passwordHash:
        token = create_password_reset_token(user.id, user.email, user.passwordHash)
        reset_url = f"{settings.api_public_url}/auth/reset-password?token={token}"
        background_tasks.add_task(
            email_service.send_password_reset_email, user.email, user.username, reset_url
        )
        logger.info("Password reset requested for user id=%s", user.id)
    return {"status": "sent"}


@router.get("/reset-password", response_class=HTMLResponse)
async def reset_password_form(
    token: str,
    db: Prisma = Depends(get_db),
    _: None = Depends(_reset_password_throttle),
):
    """The form the emailed link opens. Token is validated up front so a
    stale link fails here instead of after the user typed a new password."""
    user = await _user_for_reset_token(token, db)
    if user is None:
        return HTMLResponse(
            _auth_page("Link expired or invalid", _RESET_LINK_DEAD),
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    # `token` round-tripped through verify_token, so it is a well-formed JWT
    # (base64url charset) — safe to embed in the form.
    form = f"""
    <form method="post" action="/auth/reset-password" style="margin-top:20px;text-align:left;"
          onsubmit="if(this.new_password.value!==this.confirm.value){{alert('Passwords do not match');return false}}">
      <input type="hidden" name="token" value="{token}">
      <label style="display:block;color:#6b6355;font-size:13px;margin-bottom:4px;">New password (min {_PASSWORD_MIN_CHARS} characters)</label>
      <input type="password" name="new_password" minlength="{_PASSWORD_MIN_CHARS}" required autocomplete="new-password"
             style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #e5dcc9;border-radius:8px;font-size:15px;margin-bottom:12px;">
      <label style="display:block;color:#6b6355;font-size:13px;margin-bottom:4px;">Confirm password</label>
      <input type="password" name="confirm" minlength="{_PASSWORD_MIN_CHARS}" required autocomplete="new-password"
             style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #e5dcc9;border-radius:8px;font-size:15px;margin-bottom:18px;">
      <button type="submit"
              style="width:100%;background:#d4af37;color:#1c1a17;font-weight:bold;font-size:15px;padding:12px;border:none;border-radius:8px;cursor:pointer;">
        Set new password
      </button>
    </form>"""
    return HTMLResponse(
        _auth_page("Choose a new password", f"Resetting the password for {user.email}.", form)
    )


@router.post("/reset-password", response_class=HTMLResponse)
async def reset_password_submit(
    token: str = Form(...),
    new_password: str = Form(...),
    db: Prisma = Depends(get_db),
    _: None = Depends(_reset_password_throttle),
):
    """Handle the form post: re-validate the token, apply the same password
    rules as signup, store the new hash. Success kills every outstanding
    reset link for the account (the pwh fingerprint no longer matches)."""
    user = await _user_for_reset_token(token, db)
    if user is None:
        return HTMLResponse(
            _auth_page("Link expired or invalid", _RESET_LINK_DEAD),
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    if len(new_password) < _PASSWORD_MIN_CHARS or len(new_password.encode("utf-8")) > _PASSWORD_MAX_BYTES:
        return HTMLResponse(
            _auth_page(
                "Password not accepted",
                f"Passwords must be at least {_PASSWORD_MIN_CHARS} characters "
                f"(and at most {_PASSWORD_MAX_BYTES} bytes). Go back and try again.",
            ),
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    await db.user.update(
        where={"id": user.id},
        data={"passwordHash": get_password_hash(new_password)},
    )
    logger.info("Password reset completed for user id=%s", user.id)

    return HTMLResponse(
        _auth_page(
            "Password updated",
            "Your new password is set. Head back to the WordWise app and log in with it.",
        )
    )


# Legacy stub: verification emails went out briefly before soft verification
# was removed (2026-07-16). Keep their links landing somewhere friendly
# instead of a 404. Safe to delete after a few weeks.
@router.get("/verify-email", response_class=HTMLResponse)
async def verify_email_legacy(_: None = Depends(_reset_password_throttle)):
    return HTMLResponse(
        _auth_page(
            "You're all set",
            "Email verification is no longer required — your account works without it. "
            "You can close this tab and head back to the app.",
        )
    )


# Deleting an account is destructive but idempotent; throttle it anyway so a
# leaked token can't be used to hammer the endpoint (parity with the other
# credential endpoints above).
_delete_account_throttle = rate_limit(5, 60.0, scope="auth-delete-account")


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    current_user = Depends(get_current_user),
    db: Prisma = Depends(get_db),
    _: None = Depends(_delete_account_throttle),
):
    """Permanently delete the current user's account and all owned data.

    Required by App Store Guideline 5.1.1(v) and Google Play's data-deletion
    policy: any app with account creation must offer in-app account deletion,
    and it must destroy data, not merely deactivate.

    Every user-owned relation in schema.prisma cascades on user delete except
    UserWordList (onDelete: NoAction), which we remove explicitly first —
    both statements run in one transaction so a failure leaves the account
    fully intact rather than half-deleted.
    """
    async with db.tx() as tx:
        await tx.userwordlist.delete_many(where={"userId": current_user.id})
        await tx.user.delete(where={"id": current_user.id})

    logger.info(f"Account deleted: user id={current_user.id}")


