import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Entitlements } from '../types';
import { useAuthStore } from './authStore';

// Admin-only preview toggle (see docs/MONETIZATION_PLAN.md §6).
//
// The admin can simulate "what a free user sees" or "what a premium user
// sees" without actually changing their server-side tier. This is critical
// for QA — we need to test paywalls, ads, and upgrade nudges against the
// real product, not a mock.
//
// CRITICAL: This is a client-side view override ONLY. It does NOT mutate
// subscription_tier on the server, does NOT change billing state, does NOT
// affect any other user. Server endpoints still authorize the admin normally.
// If anything goes wrong, one reload clears the override.
export type AdminViewMode = 'admin' | 'premium' | 'free';

const STORAGE_KEY = 'admin_view_mode';

interface EntitlementsState {
  adminViewMode: AdminViewMode;
  setAdminViewMode: (mode: AdminViewMode) => Promise<void>;
  hydrate: () => Promise<void>;
}

export const useEntitlementsStore = create<EntitlementsState>((set) => ({
  adminViewMode: 'admin',

  setAdminViewMode: async (mode) => {
    set({ adminViewMode: mode });
    try {
      await AsyncStorage.setItem(STORAGE_KEY, mode);
    } catch (e) {
      console.warn('[entitlements] failed to persist admin view mode:', e);
    }
  },

  hydrate: async () => {
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved === 'admin' || saved === 'premium' || saved === 'free') {
        set({ adminViewMode: saved });
      }
    } catch (e) {
      console.warn('[entitlements] failed to hydrate admin view mode:', e);
    }
  },
}));

const FREE_ENTITLEMENTS: Entitlements = {
  tier: 'free',
  is_premium: false,
  is_admin: false,
  ads_eligible: true,
  subscription_expires_at: null,
};

const PREMIUM_ENTITLEMENTS: Entitlements = {
  tier: 'premium',
  is_premium: true,
  is_admin: false,
  ads_eligible: false,
  subscription_expires_at: null,
};

/**
 * The effective entitlements after applying the admin preview toggle.
 *
 * - Non-admins: always the server-returned entitlements (toggle is a no-op).
 * - Admins in 'admin' mode (default): server entitlements (is_premium=true).
 * - Admins in 'premium' mode: simulated premium view (hides ads, unlocks Plus).
 * - Admins in 'free' mode: simulated free view (shows ads, hits paywalls).
 *
 * Every UI gate in the app — ad rendering, paywall triggers, SRS gating —
 * reads through this hook. Do NOT call useAuthStore().user.entitlements
 * directly in UI code; doing so bypasses the preview toggle and leaves
 * admins unable to test the free experience.
 */
function useEffectiveEntitlements(): Entitlements {
  const user = useAuthStore((s) => s.user);
  const adminViewMode = useEntitlementsStore((s) => s.adminViewMode);

  const real = user?.entitlements;
  if (!real) return FREE_ENTITLEMENTS;

  // Toggle only does anything for admins. Everyone else sees reality.
  if (!real.is_admin) return real;

  switch (adminViewMode) {
    case 'free':
      // Simulate a free user. Keep is_admin=true so the admin screen and
      // view-mode toggle remain accessible — we're previewing the product,
      // not locking ourselves out of admin tools.
      return { ...FREE_ENTITLEMENTS, is_admin: true };
    case 'premium':
      return { ...PREMIUM_ENTITLEMENTS, is_admin: true };
    case 'admin':
    default:
      return real;
  }
}

export function useIsPremium(): boolean {
  return useEffectiveEntitlements().is_premium;
}

export function useShowAds(): boolean {
  return useEffectiveEntitlements().ads_eligible;
}
