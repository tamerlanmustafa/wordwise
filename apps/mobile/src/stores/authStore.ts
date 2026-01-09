import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User } from '../types';
import { tokenStorage } from '../services/auth/tokenStorage';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'offline_authenticated';

interface AuthState {
  status: AuthStatus;
  user: User | null;

  // Actions
  setUser: (user: User) => void;
  setStatus: (status: AuthStatus) => void;
  login: (user: User, accessToken: string, refreshToken: string) => Promise<void>;
  logout: () => Promise<void>;
  initialize: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  user: null,

  setUser: (user) => set({ user }),

  setStatus: (status) => set({ status }),

  login: async (user, accessToken, refreshToken) => {
    await tokenStorage.saveTokens(accessToken, refreshToken);
    await AsyncStorage.setItem('user', JSON.stringify(user));
    set({ user, status: 'authenticated' });
  },

  logout: async () => {
    await tokenStorage.clearTokens();
    await AsyncStorage.removeItem('user');
    set({ user: null, status: 'unauthenticated' });
  },

  initialize: async () => {
    try {
      const tokens = await tokenStorage.getTokens();
      const cachedUser = await AsyncStorage.getItem('user');

      if (tokens?.access && cachedUser) {
        const user = JSON.parse(cachedUser) as User;
        set({ user, status: 'authenticated' });
      } else {
        set({ status: 'unauthenticated' });
      }
    } catch {
      set({ status: 'unauthenticated' });
    }
  },
}));
