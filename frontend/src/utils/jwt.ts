/**
 * JWT Utility Functions
 *
 * Safe utilities for working with JWT tokens on the client side.
 * Note: These do NOT validate the signature - that's the backend's job.
 * We only decode the payload to check expiration times.
 */

interface JWTPayload {
  sub: string;
  email: string;
  exp: number;
  iat?: number;
}

function decodeToken(token: string): JWTPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const payload = parts[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );

    return JSON.parse(jsonPayload) as JWTPayload;
  } catch (error) {
    console.error('[JWT] Failed to decode token:', error);
    return null;
  }
}

/**
 * Check if a token will expire soon (within the next 30 seconds)
 * This allows us to proactively refresh tokens before they expire
 */
export function willExpireSoon(token: string, secondsThreshold: number = 30): boolean {
  const payload = decodeToken(token);
  if (!payload || !payload.exp) {
    return true;
  }

  const expirationTime = payload.exp * 1000;
  const currentTime = Date.now();
  const thresholdTime = expirationTime - (secondsThreshold * 1000);

  return currentTime >= thresholdTime;
}
