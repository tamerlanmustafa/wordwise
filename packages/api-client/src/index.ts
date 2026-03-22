import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import type {
  Movie,
  MovieSearchResponse,
  WordListResponse,
  Book,
  User,
  AuthTokens,
  SavedWord,
} from '@wordwise/types';

export interface ApiClientConfig {
  baseURL: string;
  getAccessToken: () => Promise<string | null>;
  onTokenRefresh?: (tokens: AuthTokens) => Promise<void>;
  onAuthError?: () => void;
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const instance = axios.create({
    baseURL: config.baseURL,
    timeout: 15000,
    headers: { 'Content-Type': 'application/json' },
  });

  // Request interceptor - add auth token
  instance.interceptors.request.use(async (req) => {
    const token = await config.getAccessToken();
    if (token) {
      req.headers.Authorization = `Bearer ${token}`;
    }
    return req;
  });

  // Response interceptor - handle 401
  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      if (error.response?.status === 401) {
        config.onAuthError?.();
      }
      return Promise.reject(error);
    }
  );

  return new ApiClient(instance);
}

export class ApiClient {
  constructor(private axios: AxiosInstance) {}

  // Movies
  async searchMovies(query: string, page = 1): Promise<MovieSearchResponse> {
    const { data } = await this.axios.get('/api/tmdb/search', {
      params: { q: query, page },
    });
    return data;
  }

  async getMovie(tmdbId: number): Promise<Movie> {
    const { data } = await this.axios.get(`/api/movies/${tmdbId}`);
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
  async searchBooks(query: string, limit = 20): Promise<{ books: Book[]; total: number }> {
    const { data } = await this.axios.get('/api/books/search', {
      params: { q: query, limit },
    });
    return data;
  }

  async getBook(bookId: number): Promise<Book> {
    const { data } = await this.axios.get(`/api/books/${bookId}`);
    return data;
  }

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

  // Saved words
  async getSavedWords(page = 1, limit = 50): Promise<{ words: SavedWord[]; total: number }> {
    const { data } = await this.axios.get('/api/users/saved-words', {
      params: { page, limit },
    });
    return data;
  }

  async saveWord(wordId: number, movieId?: number, bookId?: number): Promise<void> {
    await this.axios.post('/api/users/saved-words', {
      word_id: wordId,
      movie_id: movieId,
      book_id: bookId,
    });
  }

  async unsaveWord(wordId: number): Promise<void> {
    await this.axios.delete(`/api/users/saved-words/${wordId}`);
  }

  // User
  async getCurrentUser(): Promise<User> {
    const { data } = await this.axios.get('/api/auth/me');
    return data;
  }

  async updateUser(updates: Partial<User>): Promise<User> {
    const { data } = await this.axios.patch('/api/users/me', updates);
    return data;
  }

  // Translation
  async getTranslation(
    word: string,
    targetLanguage: string
  ): Promise<{ translation: string; definition?: string }> {
    const { data } = await this.axios.get('/api/translate', {
      params: { word, target: targetLanguage },
    });
    return data;
  }
}

export type { ApiClientConfig };
