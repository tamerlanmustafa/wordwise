import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { googleLogout } from '@react-oauth/google';
import type { CredentialResponse } from '@react-oauth/google';
import axios from 'axios';

interface User {
  id: number;
  email: string;
  username: string;
  oauth_provider: string;
  profile_picture_url?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  handleGoogleLogin: (credentialResponse: CredentialResponse) => Promise<void>;
  logout: () => void;
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

  const handleGoogleLogin = async (credentialResponse: CredentialResponse) => {
    try {
      const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
      const backendResponse = await axios.post(`${API_BASE_URL}/auth/google/login`, {
        id_token: credentialResponse.credential,
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

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        handleGoogleLogin,
        logout,
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
