/**
 * themeStore — user's theme preference, persisted across launches.
 *
 * 'system' (default) → follows the device's dark/light mode.
 * 'light' / 'dark'   → explicit override stored in AsyncStorage.
 */

import { create } from 'zustand';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemePreference = 'system' | 'light' | 'dark';
type ResolvedTheme = 'light' | 'dark';

const KEY = 'wordwise.theme.v1';

interface ThemeState {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setPreference: (p: ThemePreference) => void;
}

function resolve(pref: ThemePreference): ResolvedTheme {
  if (pref === 'light') return 'light';
  if (pref === 'dark')  return 'dark';
  return (Appearance.getColorScheme() ?? 'light') as ResolvedTheme;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  preference: 'system',
  resolved:   resolve('system'),
  hydrated:   false,

  hydrate: async () => {
    try {
      const stored = await AsyncStorage.getItem(KEY);
      const pref   = (stored as ThemePreference) || 'system';
      set({ preference: pref, resolved: resolve(pref), hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  setPreference: (pref) => {
    set({ preference: pref, resolved: resolve(pref) });
    AsyncStorage.setItem(KEY, pref).catch(() => {});
  },
}));

// Keep resolved theme in sync when system appearance changes.
Appearance.addChangeListener(({ colorScheme }) => {
  const { preference, setPreference } = useThemeStore.getState();
  if (preference === 'system') {
    useThemeStore.setState({ resolved: (colorScheme ?? 'light') as ResolvedTheme });
  }
});
