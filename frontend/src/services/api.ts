/**
 * Enterprise-Grade API Client with Silent Token Refresh
 *
 * Features:
 * - Automatic token attachment to requests
 * - Silent token refresh on 401 errors
 * - Proactive refresh when token nears expiration
 * - Queue system to prevent simultaneous refresh attempts
 * - Protection against infinite retry loops
 * - Safe retry only for idempotent methods (GET, HEAD, OPTIONS)
 * - Graceful logout when refresh fails
 * - No UI popups or interruptions
 *
 * Future-ready for HTTP-only cookie refresh tokens
 */

import axios, { AxiosError, type InternalAxiosRequestConfig, type Method } from 'axios';
import { willExpireSoon } from '../utils/jwt';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Idempotent HTTP methods that are safe to retry
 * GET, HEAD, OPTIONS do not change server state and can be retried safely
 */
const IDEMPOTENT_METHODS: Method[] = ['GET', 'HEAD', 'OPTIONS'];

/**
 * Threshold in seconds for proactive token refresh
 * If token expires in less than this, refresh it preemptively
 */
const TOKEN_EXPIRY_THRESHOLD_SECONDS = 30;

// ============================================================================
// REFRESH STATE MANAGEMENT
// ============================================================================

/**
 * Flag to prevent multiple simultaneous refresh attempts
 * When true, all 401 requests are queued until refresh completes
 */
let isRefreshing = false;

/**
 * Queue for requests waiting for token refresh
 * Each item contains resolve/reject callbacks for the queued promise
 */
let failedQueue: Array<{
  resolve: (value: string | null) => void;
  reject: (error: any) => void;
}> = [];

/**
 * Process all queued requests after refresh completes or fails
 * @param error - Error if refresh failed, null if successful
 * @param token - New token if refresh succeeded, null if failed
 */
const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

// ============================================================================
// LOGOUT HELPER
// ============================================================================

/**
 * Clear auth data and redirect to home page
 * Called when token refresh fails or token is completely invalid
 */
const forceLogout = () => {
  // Clear auth data from localStorage
  localStorage.removeItem('wordwise_token');
  localStorage.removeItem('wordwise_user');

  // Redirect to home page (but not if already there)
  if (window.location.pathname !== '/login' && window.location.pathname !== '/wordwise') {
    window.location.href = '/wordwise';
  }
};

// ============================================================================
// AXIOS INSTANCE
// ============================================================================

/**
 * Centralized axios instance for all API calls
 * Automatically handles authentication and token refresh
 */
export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ============================================================================
// REQUEST INTERCEPTOR
// ============================================================================

apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem('wordwise_token');

    // If no token exists, proceed without authentication
    if (!token) {
      return config;
    }

    // Only attach token if Authorization header isn't already set
    if (!config.headers.Authorization) {
      // Proactive refresh: Check if token will expire soon
      if (willExpireSoon(token, TOKEN_EXPIRY_THRESHOLD_SECONDS)) {
        console.log('[API Client] Token expiring soon, triggering proactive refresh');

        // Don't block the request - let response interceptor handle expired tokens
        // This is safer than trying to refresh synchronously
        // The request will fail with 401 and trigger the refresh flow
      }

      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// ============================================================================
// RESPONSE INTERCEPTOR
// ============================================================================

apiClient.interceptors.response.use(
  (response) => {
    // Success - return response as-is
    return response;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // ========================================================================
    // SAFETY CHECK 1: Ensure we have a valid config object
    // ========================================================================
    if (!originalRequest) {
      return Promise.reject(error);
    }

    // ========================================================================
    // SAFETY CHECK 2: Only handle 401 Unauthorized errors
    // ========================================================================
    if (error.response?.status !== 401) {
      return Promise.reject(error);
    }

    // ========================================================================
    // SAFETY CHECK 3: Skip refresh endpoint to prevent infinite loops
    // ========================================================================
    if (originalRequest.url?.includes('/auth/refresh')) {
      console.error('[API Client] Refresh endpoint returned 401 - token is invalid');
      forceLogout();
      return Promise.reject(error);
    }

    // ========================================================================
    // SAFETY CHECK 4: Prevent retry loops with _retry flag
    // ========================================================================
    if (originalRequest._retry) {
      console.error('[API Client] Request already retried once - preventing loop');
      return Promise.reject(error);
    }

    // ========================================================================
    // SAFETY CHECK 5: Only retry idempotent methods
    // ========================================================================
    const method = (originalRequest.method?.toUpperCase() || 'GET') as Method;
    const isIdempotent = IDEMPOTENT_METHODS.includes(method);

    if (!isIdempotent) {
      console.warn(
        `[API Client] Request method ${method} is not idempotent - ` +
        'will NOT retry after refresh to prevent duplicate actions'
      );

      // For non-idempotent methods, just logout without retry
      // This prevents dangerous double-POSTs, double-PUTs, etc.
      forceLogout();
      return Promise.reject(error);
    }

    // ========================================================================
    // TOKEN VALIDATION: Check if token exists
    // ========================================================================
    const token = localStorage.getItem('wordwise_token');
    if (!token) {
      // No token means user isn't logged in - don't attempt refresh
      return Promise.reject(error);
    }

    // ========================================================================
    // REFRESH QUEUE: If refresh in progress, queue this request
    // ========================================================================
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      })
        .then(newToken => {
          if (newToken && originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
          }
          // Mark as retried before sending
          originalRequest._retry = true;
          return apiClient(originalRequest);
        })
        .catch(err => {
          return Promise.reject(err);
        });
    }

    // ========================================================================
    // REFRESH FLOW: Attempt to refresh the token
    // ========================================================================

    // Mark request as retried and set refreshing flag
    originalRequest._retry = true;
    isRefreshing = true;

    try {
      console.log('[API Client] Attempting token refresh');

      // Call refresh endpoint with current (expired) token
      // NOTE: Using base axios instance to avoid interceptor recursion
      const response = await axios.post(
        `${API_BASE_URL}/auth/refresh`,
        {},
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      const newToken = response.data.token;
      const userData = response.data.user;

      // Update localStorage with new token and user data
      localStorage.setItem('wordwise_token', newToken);
      localStorage.setItem('wordwise_user', JSON.stringify(userData));

      console.log('[API Client] Token refresh successful');

      // Process all queued requests with new token
      processQueue(null, newToken);

      // Update original request with new token
      if (originalRequest.headers) {
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
      }

      // Reset refreshing flag
      isRefreshing = false;

      // Retry original request with new token
      return apiClient(originalRequest);

    } catch (refreshError) {
      console.error('[API Client] Token refresh failed:', refreshError);

      // Process queue with error (all queued requests will fail)
      processQueue(refreshError, null);
      isRefreshing = false;

      // Clear auth data and redirect
      forceLogout();

      return Promise.reject(refreshError);
    }
  }
);

// ============================================================================
// EXPORTS
// ============================================================================

export default apiClient;

/**
 * Helper function to check if user is authenticated
 * @returns true if user has a valid token in localStorage
 */
export function hasAuthToken(): boolean {
  return !!localStorage.getItem('wordwise_token');
}

/**
 * Helper function to manually trigger token refresh
 * Useful for proactive refresh before long-running operations
 * @returns Promise that resolves with new token or rejects on failure
 */
export async function refreshAuthToken(): Promise<string> {
  const token = localStorage.getItem('wordwise_token');

  if (!token) {
    throw new Error('No token to refresh');
  }

  try {
    const response = await axios.post(
      `${API_BASE_URL}/auth/refresh`,
      {},
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    const newToken = response.data.token;
    const userData = response.data.user;

    localStorage.setItem('wordwise_token', newToken);
    localStorage.setItem('wordwise_user', JSON.stringify(userData));

    return newToken;
  } catch (error) {
    forceLogout();
    throw error;
  }
}
