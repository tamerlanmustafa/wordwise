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

/**
 * Decode a JWT token to extract its payload
 * @param token - The JWT token string
 * @returns The decoded payload or null if invalid
 */
export function decodeToken(token: string): JWTPayload | null {
  try {
    // JWT format: header.payload.signature
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    // Decode the payload (base64url)
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
 * Check if a token is expired
 * @param token - The JWT token string
 * @returns true if expired, false otherwise
 */
export function isTokenExpired(token: string): boolean {
  const payload = decodeToken(token);
  if (!payload || !payload.exp) {
    return true;
  }

  // exp is in seconds, Date.now() is in milliseconds
  const expirationTime = payload.exp * 1000;
  const currentTime = Date.now();

  return currentTime >= expirationTime;
}

/**
 * Check if a token will expire soon (within the next 30 seconds)
 * This allows us to proactively refresh tokens before they expire
 * @param token - The JWT token string
 * @param secondsThreshold - Number of seconds before expiration to consider "soon" (default: 30)
 * @returns true if token will expire within the threshold, false otherwise
 */
export function willExpireSoon(token: string, secondsThreshold: number = 30): boolean {
  const payload = decodeToken(token);
  if (!payload || !payload.exp) {
    return true;
  }

  // exp is in seconds, Date.now() is in milliseconds
  const expirationTime = payload.exp * 1000;
  const currentTime = Date.now();
  const thresholdTime = expirationTime - (secondsThreshold * 1000);

  return currentTime >= thresholdTime;
}

/**
 * Get the time remaining until token expiration
 * @param token - The JWT token string
 * @returns Milliseconds until expiration, or 0 if expired/invalid
 */
export function getTimeUntilExpiration(token: string): number {
  const payload = decodeToken(token);
  if (!payload || !payload.exp) {
    return 0;
  }

  const expirationTime = payload.exp * 1000;
  const currentTime = Date.now();
  const remaining = expirationTime - currentTime;

  return remaining > 0 ? remaining : 0;
}
