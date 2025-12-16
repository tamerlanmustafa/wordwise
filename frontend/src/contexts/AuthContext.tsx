import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { googleLogout } from '@react-oauth/google';
import type { CredentialResponse } from '@react-oauth/google';
import axios from 'axios';

interface User {
  id: number;
  email: string;
  username: string;
  oauth_provider: string;
  profile_picture_url?: string;
  native_language?: string;
  learning_language?: string;
  proficiency_level?: string;
}

interface LanguagePreferences {
  nativeLanguage: string;
  learningLanguage: string;
}

interface UserUpdateData {
  username?: string;
  native_language?: string;
  learning_language?: string;
  proficiency_level?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  handleGoogleLogin: (credentialResponse: CredentialResponse, languagePrefs?: LanguagePreferences) => Promise<void>;
  logout: () => void;
  updateUser: (data: UserUpdateData) => Promise<void>;
  refreshUser: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Check if user is logged in on mount
  useEffect(() => {
    const storedUser = localStorage.getItem('wordwise_user');
    const storedToken = localStorage.getItem('wordwise_token');

    if (storedUser && storedToken) {
      setUser(JSON.parse(storedUser));
    }
    setLoading(false);
  }, []);

  const handleGoogleLogin = async (credentialResponse: CredentialResponse, languagePrefs?: LanguagePreferences) => {
    try {
      const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
      const backendResponse = await axios.post(`${API_BASE_URL}/auth/google/login`, {
        id_token: credentialResponse.credential,
        native_language: languagePrefs?.nativeLanguage,
        learning_language: languagePrefs?.learningLanguage,
      });

      const userData = backendResponse.data.user;
      const authToken = backendResponse.data.access_token;

      // Store user and token
      localStorage.setItem('wordwise_user', JSON.stringify(userData));
      localStorage.setItem('wordwise_token', authToken);

      setUser(userData);

      // Redirect to home page
      window.location.href = '/wordwise/';
    } catch (error) {
      console.error('Login failed:', error);
      if (error instanceof Error && 'response' in error) {
        console.error('Backend error:', (error as any).response?.data);
      }
    }
  };

  const logout = () => {
    googleLogout();
    localStorage.removeItem('wordwise_user');
    localStorage.removeItem('wordwise_token');
    setUser(null);

    // Redirect to home page
    window.location.href = '/wordwise/';
  };

  const refreshUser = async () => {
    const token = localStorage.getItem('wordwise_token');
    if (!token) return;

    try {
      const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
      const response = await axios.get(`${API_BASE_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      const userData = response.data;
      localStorage.setItem('wordwise_user', JSON.stringify(userData));
      setUser(userData);
    } catch (error) {
      console.error('Failed to refresh user:', error);
    }
  };

  const updateUser = async (data: UserUpdateData) => {
    const token = localStorage.getItem('wordwise_token');
    if (!token) throw new Error('Not authenticated');

    const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
    const response = await axios.patch(`${API_BASE_URL}/auth/me`, data, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const userData = response.data;
    localStorage.setItem('wordwise_user', JSON.stringify(userData));
    setUser(userData);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        handleGoogleLogin,
        logout,
        updateUser,
        refreshUser,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
