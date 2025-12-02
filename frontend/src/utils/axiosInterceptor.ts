/**
 * Axios Interceptor for Token Refresh
 *
 * Silently refreshes JWT tokens when they expire or are near expiration
 */

import axios from 'axios';
import type { AxiosError } from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// Track if a refresh is in progress to avoid multiple simultaneous refresh calls
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value?: any) => void;
  reject: (reason?: any) => void;
}> = [];

const processQueue = (error: Error | null, token: string | null = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });

  failedQueue = [];
};

/**
 * Check if token is expired or near expiration (within 5 minutes)
 */
const isTokenExpired = (token: string): boolean => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const exp = payload.exp * 1000; // Convert to milliseconds
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;

    // Return true if expired or will expire in next 5 minutes
    return exp - now < fiveMinutes;
  } catch {
    return true; // If we can't parse, assume expired
  }
};

/**
 * Attempt to refresh the token
 */
const refreshToken = async (): Promise<string | null> => {
  try {
    const token = localStorage.getItem('wordwise_token');
    if (!token) return null;

    const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {}, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const newToken = response.data.access_token;
    localStorage.setItem('wordwise_token', newToken);

    return newToken;
  } catch (error) {
    // Refresh failed, force logout
    localStorage.removeItem('wordwise_user');
    localStorage.removeItem('wordwise_token');
    window.location.href = '/wordwise/';
    return null;
  }
};

/**
 * Request interceptor - check and refresh token before request
 */
axios.interceptors.request.use(
  async (config: any) => {
    const token = localStorage.getItem('wordwise_token');

    // Skip token check for auth endpoints and preview endpoints
    if (config.url?.includes('/auth/') || config.url?.includes('/preview')) {
      return config;
    }

    if (token && isTokenExpired(token)) {
      if (!isRefreshing) {
        isRefreshing = true;

        try {
          const newToken = await refreshToken();
          isRefreshing = false;

          if (newToken) {
            processQueue(null, newToken);
            if (config.headers) {
              config.headers.Authorization = `Bearer ${newToken}`;
            }
          } else {
            processQueue(new Error('Token refresh failed'), null);
            return Promise.reject(new Error('Token refresh failed'));
          }
        } catch (error) {
          isRefreshing = false;
          processQueue(error as Error, null);
          return Promise.reject(error);
        }
      } else {
        // Wait for the ongoing refresh to complete
        try {
          const newToken = await new Promise<string>((resolve, reject) => {
            failedQueue.push({ resolve, reject });
          });

          if (config.headers && newToken) {
            config.headers.Authorization = `Bearer ${newToken}`;
          }
          return config;
        } catch (err) {
          return Promise.reject(err);
        }
      }
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/**
 * Response interceptor - handle 401 errors with token refresh
 */
axios.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as any & { _retry?: boolean };

    // If 401 and we haven't retried yet
    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        // Wait for ongoing refresh
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${token}`;
          }
          return axios(originalRequest);
        }).catch((err) => {
          return Promise.reject(err);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const newToken = await refreshToken();
      isRefreshing = false;

      if (newToken) {
        processQueue(null, newToken);
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
        }
        return axios(originalRequest);
      } else {
        processQueue(new Error('Token refresh failed'), null);
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  }
);

export default axios;
