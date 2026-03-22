import axios, { AxiosInstance } from 'axios';
import type {
  MovieSearchResponse,
  WordListResponse,
  User,
} from '../../types';
import { config } from '../../config/env';
import { tokenStorage } from '../auth/tokenStorage';

// Create axios instance
const axiosInstance = axios.create({
  baseURL: config.API_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor - add auth token
axiosInstance.interceptors.request.use(async (req) => {
  const token = await tokenStorage.getAccessToken();
  if (token) {
    req.headers.Authorization = `Bearer ${token}`;
  }
  return req;
});

// API client class
class ApiClient {
  constructor(private axios: AxiosInstance) {}

  // Movies
  async searchMovies(query: string, page = 1): Promise<MovieSearchResponse> {
    const { data } = await this.axios.get('/api/tmdb/search', {
      params: { q: query, page },
    });
    return data;
  }

  async getMovieVocabulary(
    movieId: number,
    options?: { level?: string; page?: number; limit?: number }
  ): Promise<WordListResponse> {
    const { data } = await this.axios.get(`/api/movies/${movieId}/vocabulary`, {
      params: {
        level: options?.level,
        page: options?.page ?? 1,
        limit: options?.limit ?? 50,
      },
    });
    return data;
  }

  // Books
  async getBookVocabulary(
    bookId: number,
    options?: { level?: string; page?: number; limit?: number }
  ): Promise<WordListResponse> {
    const { data } = await this.axios.get(`/api/books/${bookId}/vocabulary`, {
      params: {
        level: options?.level,
        page: options?.page ?? 1,
        limit: options?.limit ?? 50,
      },
    });
    return data;
  }

  // User
  async getCurrentUser(): Promise<User> {
    const { data } = await this.axios.get('/api/auth/me');
    return data;
  }
}

// Export singleton
export const api = {
  client: new ApiClient(axiosInstance),
};
