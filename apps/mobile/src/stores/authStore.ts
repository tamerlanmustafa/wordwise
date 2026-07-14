import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CefrLevel, User } from '../types';
import { tokenStorage } from '../services/auth/tokenStorage';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'offline_authenticated';

interface AuthState {
  status: AuthStatus;
  user: User | null;

  // Actions
  setUser: (user: User) => void;
  setStatus: (status: AuthStatus) => void;
  /** Reconcile a placement/onboarding CEFR level onto the profile the rest of
   *  the app reads. Home seeds its CEFR filter from user.proficiency_level, so
   *  a server-only PATCH left it stale (issue #83: quiz said C2, Home filtered
   *  B2). Sets the level locally first so it holds even offline, then PATCHes
   *  the server and reconciles with the response. */
  syncProficiencyLevel: (level: CefrLevel) => Promise<void>;
  login: (user: User, accessToken: string, refreshToken: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Server-side account deletion, then local sign-out. Throws (leaving the
   *  session intact) if the server call fails. App Store 5.1.1(v). */
  deleteAccount: () => Promise<void>;
  initialize: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
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

  syncProficiencyLevel: async (level) => {
    const { user, setUser } = get();
    if (!user) return;
    // Optimistic local write first: surfaces that seed from proficiency_level
    // (Home's CEFR filter) reflect the level immediately, even offline (#83).
    setUser({ ...user, proficiency_level: level });
    try {
      // Inline require, not a native import(): Jest can't execute import() in
      // this repo — same reason as deleteAccount below.
      const { authApi } = require('../services/api') as typeof import('../services/api');
      const fresh = await authApi.updateProfile({ proficiency_level: level });
      setUser(fresh); // reconcile with server truth
    } catch {
      // Local already reflects the level (#83); server reconciles next session.
    }
  },

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

  deleteAccount: async () => {
    // Inline require, not a native import(): Jest can't execute import() in
    // this repo (see initialize() note below), and require keeps the api
    // module lazily loaded the same way.
    const { authApi } = require('../services/api') as typeof import('../services/api');
    await authApi.deleteAccount();
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

        // Background-refresh /auth/me so entitlements (and any other
        // server-side fields like is_admin) stay fresh after a cold start.
        // Failure is non-fatal — we already have the cached user on screen.
        import('../services/api')
          .then(({ authApi }) => authApi.me())
          .then((fresh) => {
            if (fresh) {
              set({ user: fresh });
              AsyncStorage.setItem('user', JSON.stringify(fresh)).catch(() => {});
            }
          })
          .catch((e) => console.warn('[AuthStore] /auth/me refresh failed:', e));
      } else {
        set({ status: 'unauthenticated' });
      }
    } catch {
      set({ status: 'unauthenticated' });
    }
  },
}));
