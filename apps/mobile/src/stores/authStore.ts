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

  setUser: (user) => {
    set({ user });
    // Persist so settings edits (proficiency, languages, username, ...)
    // survive a cold start. Without this, initialize() re-reads the stale
    // cached user on next launch and the edit appears to have reverted.
    AsyncStorage.setItem('user', JSON.stringify(user)).catch((e) =>
      console.warn('[AuthStore] Failed to persist user:', e)
    );
  },

  setStatus: (status) => set({ status }),

  login: async (user, accessToken, refreshToken) => {
    console.log('[AuthStore] Login called, saving tokens...');
    await tokenStorage.saveTokens(accessToken, refreshToken);
    console.log('[AuthStore] Tokens saved, saving user...');
    await AsyncStorage.setItem('user', JSON.stringify(user));
    console.log('[AuthStore] User saved, setting status to authenticated');
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
