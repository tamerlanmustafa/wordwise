import axios, { AxiosInstance, AxiosError } from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

class ApiService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor to add auth token
    this.client.interceptors.request.use(
      (config) => {
        const token = this.getToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response?.status === 401) {
          this.clearToken();
          if (typeof window !== 'undefined') {
            window.location.href = '/auth/login';
          }
        }
        return Promise.reject(error);
      }
    );
  }

  private getToken(): string | null {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('access_token');
    }
    return null;
  }

  private setToken(token: string): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem('access_token', token);
    }
  }

  private clearToken(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('access_token');
    }
  }

  // Auth endpoints
  async login(email: string, password: string) {
    const response = await this.client.post('/auth/login', { email, password });
    const { access_token } = response.data;
    this.setToken(access_token);
    return response.data;
  }

  async register(data: any) {
    const response = await this.client.post('/auth/register', data);
    return response.data;
  }

  async getCurrentUser() {
    const response = await this.client.get('/auth/me');
    return response.data;
  }

  // Movie endpoints
  async getMovies(params?: any) {
    const response = await this.client.get('/movies/', { params });
    return response.data;
  }

  async getMovie(id: number) {
    const response = await this.client.get(`/movies/${id}`);
    return response.data;
  }

  async createMovie(data: any) {
    const response = await this.client.post('/movies/', data);
    return response.data;
  }

  // User word list endpoints
  async getUserWords(listType?: string) {
    const params = listType ? { list_type: listType } : {};
    const response = await this.client.get('/users/me/words', { params });
    return response.data;
  }

  async addWordToList(wordId: number, listType: string) {
    const response = await this.client.post('/users/words', {
      word_id: wordId,
      list_type: listType,
    });
    return response.data;
  }

  async removeWordFromList(wordListId: number) {
    await this.client.delete(`/users/words/${wordListId}`);
  }

  logout() {
    this.clearToken();
  }
}

export const apiService = new ApiService();


