import axios, { AxiosInstance } from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

class ApiService {
  private api: AxiosInstance;

  constructor() {
    this.api = axios.create({
      baseURL: API_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add token to requests if it exists
    this.api.interceptors.request.use((config) => {
      const token = this.getToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // Handle 401 errors
    this.api.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          this.logout();
          window.location.href = '/auth/login';
        }
        return Promise.reject(error);
      }
    );
  }

  // Token management
  private getToken(): string | null {
    return localStorage.getItem('access_token');
  }

  private setToken(token: string): void {
    localStorage.setItem('access_token', token);
  }

  private removeToken(): void {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
  }

  // Auth endpoints
  async register(email: string, username: string, password: string) {
    const response = await this.api.post('/auth/register', {
      email,
      username,
      password,
    });
    this.setToken(response.data.access_token);
    return response.data;
  }

  async login(email: string, password: string) {
    const response = await this.api.post('/auth/login', {
      email,
      password,
    });
    this.setToken(response.data.access_token);
    return response.data;
  }

  async googleSignup(idToken: string) {
    const response = await this.api.post('/auth/google/signup', {
      id_token: idToken,
    });
    this.setToken(response.data.access_token);
    return response.data;
  }

  async googleLogin(idToken: string) {
    const response = await this.api.post('/auth/google/login', {
      id_token: idToken,
    });
    this.setToken(response.data.access_token);
    return response.data;
  }

  logout(): void {
    this.removeToken();
  }

  // Movies endpoints
  async getMovies(params?: { difficulty?: string }) {
    const response = await this.api.get('/movies', { params });
    return response.data;
  }

  async getMovie(id: number) {
    const response = await this.api.get(`/movies/${id}`);
    return response.data;
  }

  // User endpoints
  async getCurrentUser() {
    const response = await this.api.get('/users/me');
    return response.data;
  }
}

export const apiService = new ApiService();
