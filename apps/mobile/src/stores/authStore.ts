import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDeviceTimezone } from '../utils/deviceTimezone';
import type { CefrLevel, User } from '../types';
import { tokenStorage } from '../services/auth/tokenStorage';
// Safe to import statically: accountState reaches the stores through `require`
// at call time precisely so this direction of the cycle stays open.
import { resetAccountState } from '../services/accountState';

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
  /** Re-read `/auth/me` and reconcile. Used after anything that changes the
   *  account server-side without returning the new user — a restored purchase
   *  being the one that matters, since the screen behind the confirmation
   *  alert has to already agree with it. Never throws. */
  refreshUser: () => Promise<void>;
  initialize: () => Promise<void>;
}

/**
 * Tell the server which calendar day this user is living in.
 *
 * The streak, the free tier's one lesson a day, the chest and the freeze gap
 * are all decided server-side, and the server needs a zone to decide them in —
 * without one it falls back to UTC, which rolls the day over at 4pm for a user
 * in Los Angeles.
 *
 * Sent on every cold start rather than once at sign-up, because people travel
 * and a stale zone is a streak that rolls over at the wrong hour. Written only
 * when it actually changed, so the ordinary launch costs nothing: the common
 * case is one comparison and no request.
 *
 * Fire-and-forget on purpose. A user whose timezone PATCH failed is a user on
 * the previous zone for one more session, which is the status quo — not a
 * reason to hold up a launch or surface an error they cannot act on.
 */
async function syncTimezone(user: User, set: (partial: Partial<AuthState>) => void): Promise<void> {
  const zone = getDeviceTimezone();
  if (!zone || zone === user.timezone) return;
  try {
    const { authApi } = await import('../services/api');
    const fresh = await authApi.updateProfile({ timezone: zone });
    set({ user: fresh });
    await AsyncStorage.setItem('user', JSON.stringify(fresh)).catch(() => {});
  } catch (e) {
    console.warn('[AuthStore] timezone sync failed:', (e as Error)?.message);
  }
}

/**
 * Pull the authoritative user from `/auth/me` and reconcile.
 *
 * Shared by `login()` and `initialize()` so the two cannot drift — they were
 * two different behaviours before, and the one without the refresh was the one
 * that shipped the bug.
 */
async function refreshMe(set: (partial: Partial<AuthState>) => void): Promise<void> {
  try {
    const { authApi } = await import('../services/api');
    const fresh = await authApi.me();
    if (!fresh) return;
    set({ user: fresh });
    await AsyncStorage.setItem('user', JSON.stringify(fresh)).catch(() => {});
    void syncTimezone(fresh, set);
  } catch (e) {
    console.warn('[AuthStore] /auth/me refresh failed:', (e as Error)?.message);
  }
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

    // Reconcile against /auth/me, exactly as `initialize()` does on a cold
    // start. The sign-in response is now complete — but the client should not
    // *depend* on that, because it is the one thing this app got wrong for
    // months and the symptom (an onboarded user replaying onboarding, a
    // subscriber reading as free) is invisible until someone signs out.
    //
    // An OTA also reaches phones before a backend deploy finishes, so for a
    // few minutes a new client talks to a server that still strips the
    // payload. This closes that window from the side we control.
    //
    // Non-blocking and non-fatal: the user is already signed in and on screen,
    // and a failure here just leaves them with the response they got.
    void refreshMe(set);
  },

  logout: async () => {
    await tokenStorage.clearTokens();
    // Everything the account wrote — storage and in-memory stores alike. This
    // used to be `removeItem('user')` and nothing else, so the next account to
    // sign in on this phone inherited the previous one's review deck, streak,
    // saved-word state and viewing history. See services/accountState.ts for
    // what counts as the account's and what stays with the device.
    await resetAccountState();
    set({ user: null, status: 'unauthenticated' });
  },

  deleteAccount: async () => {
    // Inline require, not a native import(): Jest can't execute import() in
    // this repo (see initialize() note below), and require keeps the api
    // module lazily loaded the same way.
    const { authApi } = require('../services/api') as typeof import('../services/api');
    await authApi.deleteAccount();
    await tokenStorage.clearTokens();
    // Same wipe as sign-out, and more obviously required here: the account is
    // gone from the server, so leaving its data readable on the phone is the
    // one outcome "delete my account" must not have.
    await resetAccountState();
    set({ user: null, status: 'unauthenticated' });
  },

  refreshUser: async () => {
    await refreshMe(set);
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
        void refreshMe(set);
      } else {
        set({ status: 'unauthenticated' });
      }
    } catch {
      set({ status: 'unauthenticated' });
    }
  },
}));
