import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const TOKEN_KEY = 'wordwise_tokens';

interface StoredTokens {
  access: string;
  refresh: string;
}

// Web fallback using localStorage. Accessed via globalThis so mobile
// tsconfig doesn't need to pull in DOM lib types.
interface WebLocalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
const getLocalStorage = (): WebLocalStorage =>
  (globalThis as unknown as { localStorage: WebLocalStorage }).localStorage;

const webStorage = {
  async setItemAsync(key: string, value: string): Promise<void> {
    getLocalStorage().setItem(key, value);
  },
  async getItemAsync(key: string): Promise<string | null> {
    return getLocalStorage().getItem(key);
  },
  async deleteItemAsync(key: string): Promise<void> {
    getLocalStorage().removeItem(key);
  },
};

// Use SecureStore on native, localStorage on web
const storage = Platform.OS === 'web' ? webStorage : SecureStore;

export const tokenStorage = {
  async saveTokens(access: string, refresh: string): Promise<void> {
    await storage.setItemAsync(TOKEN_KEY, JSON.stringify({ access, refresh }));
  },

  async getTokens(): Promise<StoredTokens | null> {
    try {
      const result = await storage.getItemAsync(TOKEN_KEY);
      if (!result) return null;
      return JSON.parse(result) as StoredTokens;
    } catch {
      return null;
    }
  },

  async getAccessToken(): Promise<string | null> {
    const tokens = await this.getTokens();
    return tokens?.access ?? null;
  },

  async getRefreshToken(): Promise<string | null> {
    const tokens = await this.getTokens();
    return tokens?.refresh ?? null;
  },

  async clearTokens(): Promise<void> {
    await storage.deleteItemAsync(TOKEN_KEY);
  },
};
