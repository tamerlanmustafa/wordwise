import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useGoogleLogin, googleLogout } from '@react-oauth/google';
import axios from 'axios';

interface User {
  id: number;
  email: string;
  name: string;
  picture?: string;
  googleId: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: () => void;
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

  const login = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      try {
        // Get user info from Google
        const userInfoResponse = await axios.get(
          'https://www.googleapis.com/oauth2/v3/userinfo',
          {
            headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
          }
        );

        const googleUser = userInfoResponse.data;

        // Send to your backend to create/login user
        const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
        const backendResponse = await axios.post(`${API_BASE_URL}/api/auth/google`, {
          token: tokenResponse.access_token,
          email: googleUser.email,
          name: googleUser.name,
          picture: googleUser.picture,
          googleId: googleUser.sub,
        });

        const userData = backendResponse.data.user;
        const authToken = backendResponse.data.token;

        // Store user and token
        localStorage.setItem('wordwise_user', JSON.stringify(userData));
        localStorage.setItem('wordwise_token', authToken);

        setUser(userData);
      } catch (error) {
        console.error('Login failed:', error);
        // Fallback: store user locally even if backend fails
        if (error instanceof Error && 'response' in error) {
          console.error('Backend error:', (error as any).response?.data);
        }
      }
    },
    onError: () => {
      console.error('Google Login Failed');
    },
  });

  const logout = () => {
    googleLogout();
    localStorage.removeItem('wordwise_user');
    localStorage.removeItem('wordwise_token');
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
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
