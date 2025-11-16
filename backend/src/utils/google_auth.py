"""
Google OAuth 2.0 authentication utilities.

This module handles Google ID token verification and user info extraction.
"""

from google.auth.transport import requests
from google.oauth2 import id_token
from typing import Optional, Dict, Any
import logging

logger = logging.getLogger(__name__)


class GoogleAuthError(Exception):
    """Custom exception for Google authentication errors"""
    pass


def verify_google_token(token: str, client_id: str) -> Optional[Dict[str, Any]]:
    """
    Verify Google ID token and extract user information.

    Args:
        token: The Google ID token to verify
        client_id: Your Google OAuth client ID

    Returns:
        Dictionary containing user info (sub, email, name, picture) if valid,
        None if verification fails

    Raises:
        GoogleAuthError: If token verification fails
    """
    try:
        # Verify the token
        idinfo = id_token.verify_oauth2_token(
            token,
            requests.Request(),
            client_id
        )

        # Verify the token is for our app
        if idinfo['iss'] not in ['accounts.google.com', 'https://accounts.google.com']:
            raise GoogleAuthError('Invalid token issuer')

        # Extract user information
        user_info = {
            'google_id': idinfo['sub'],  # Google user ID (unique identifier)
            'email': idinfo.get('email'),
            'name': idinfo.get('name'),
            'given_name': idinfo.get('given_name'),
            'family_name': idinfo.get('family_name'),
            'picture': idinfo.get('picture'),  # Profile picture URL
            'email_verified': idinfo.get('email_verified', False)
        }

        logger.info(f"Successfully verified Google token for user: {user_info['email']}")
        return user_info

    except ValueError as e:
        # Invalid token
        logger.error(f"Invalid Google token: {str(e)}")
        raise GoogleAuthError(f"Invalid token: {str(e)}")
    except Exception as e:
        logger.error(f"Error verifying Google token: {str(e)}")
        raise GoogleAuthError(f"Token verification failed: {str(e)}")


def generate_username_from_email(email: str) -> str:
    """
    Generate a unique username from email address.

    Args:
        email: User's email address

    Returns:
        Username derived from email (part before @)
    """
    return email.split('@')[0].lower().replace('.', '_')
