"""
Sign in with Apple — identity-token verification.

Mirrors google_auth.py: verify the client-supplied identity token, extract a
stable user id + email. Apple tokens are RS256 JWTs signed by keys published
at https://appleid.apple.com/auth/keys; we pick the key by `kid`, then verify
signature, issuer, audience (our bundle id) and expiry with python-jose.

Two Apple-specific quirks the callers must handle:
- `email` is only guaranteed on the FIRST authorization for a given Apple ID
  (and may be a private-relay address). Repeat logins may omit it — look the
  user up by apple_id before requiring an email.
- The user's name is NEVER in the token; the client receives it once, at
  first auth, and must pass it alongside the token if we want to store it.
"""

import logging
import time
from typing import Any, Dict, Optional

import httpx
from jose import jwt, JWTError

logger = logging.getLogger(__name__)

APPLE_ISSUER = "https://appleid.apple.com"
APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"

# Apple's signing keys rotate rarely; cache them briefly so every login
# doesn't pay a round-trip to Apple (and a JWKS outage doesn't take down
# logins that hit the cache window).
_JWKS_TTL_SECONDS = 3600.0
_jwks_cache: Dict[str, Any] = {"keys": None, "fetched_at": 0.0}


class AppleAuthError(Exception):
    """Custom exception for Apple authentication errors"""
    pass


def _get_apple_jwks(force_refresh: bool = False) -> dict:
    """Fetch (and cache) Apple's public signing keys."""
    now = time.monotonic()
    if (
        not force_refresh
        and _jwks_cache["keys"] is not None
        and now - _jwks_cache["fetched_at"] < _JWKS_TTL_SECONDS
    ):
        return _jwks_cache["keys"]

    resp = httpx.get(APPLE_JWKS_URL, timeout=10.0)
    resp.raise_for_status()
    jwks = resp.json()
    _jwks_cache["keys"] = jwks
    _jwks_cache["fetched_at"] = now
    return jwks


def _find_key(jwks: dict, kid: str) -> Optional[dict]:
    return next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)


def verify_apple_token(identity_token: str, bundle_id: str) -> Dict[str, Any]:
    """
    Verify an Apple identity token and extract user information.

    Args:
        identity_token: The identity token from AuthenticationServices
        bundle_id: Our iOS bundle id — must equal the token's `aud`

    Returns:
        Dictionary with:
            - apple_id: stable Apple user identifier (`sub`)
            - email: email or None (absent on repeat logins)
            - email_verified: bool

    Raises:
        AppleAuthError: If token verification fails
    """
    try:
        header = jwt.get_unverified_header(identity_token)
        kid = header.get("kid")
        # Pin the algorithm family: Apple signs with RS256. Passing an
        # explicit allowlist to jwt.decode() below prevents alg-confusion
        # (e.g. an attacker crafting an HS256 token "signed" with the
        # public key as the HMAC secret).
        if header.get("alg") != "RS256":
            raise AppleAuthError(f"Unexpected token algorithm: {header.get('alg')}")

        key = _find_key(_get_apple_jwks(), kid)
        if key is None:
            # Key rotation between our cache fill and this login — refetch once.
            key = _find_key(_get_apple_jwks(force_refresh=True), kid)
        if key is None:
            raise AppleAuthError("No matching Apple signing key for token")

        claims = jwt.decode(
            identity_token,
            key,
            algorithms=["RS256"],
            audience=bundle_id,
            issuer=APPLE_ISSUER,
        )

        email_verified = claims.get("email_verified", False)
        # Apple sends booleans as the strings "true"/"false" in some tokens.
        if isinstance(email_verified, str):
            email_verified = email_verified.lower() == "true"

        user_info = {
            "apple_id": claims["sub"],
            "email": claims.get("email"),
            "email_verified": email_verified,
        }

        logger.info(f"Successfully verified Apple token for sub={claims['sub'][:8]}…")
        return user_info

    except AppleAuthError:
        raise
    except JWTError as e:
        logger.error(f"Invalid Apple token: {str(e)}")
        raise AppleAuthError(f"Invalid token: {str(e)}")
    except Exception as e:
        logger.error(f"Error verifying Apple token: {str(e)}")
        raise AppleAuthError(f"Token verification failed: {str(e)}")
