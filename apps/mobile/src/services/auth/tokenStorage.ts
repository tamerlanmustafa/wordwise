import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const TOKEN_KEY = 'wordwise_tokens';

interface StoredTokens {
  access: string;
  refresh: string;
}

// Web fallback using localStorage
const webStorage = {
  async setItemAsync(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value);
  },
  async getItemAsync(key: string): Promise<string | null> {
    return localStorage.getItem(key);
  },
  async deleteItemAsync(key: string): Promise<void> {
    localStorage.removeItem(key);
  },
};

// Use SecureStore on native, localStorage on web
const storage = Platform.OS === 'web' ? webStorage : SecureStore;

export const tokenStorage = {
  async saveTokens(access: string, refresh: string): Promise<void> {
    console.log('[TokenStorage] Saving tokens, access:', access ? `${access.substring(0, 30)}...` : 'null');
    await storage.setItemAsync(TOKEN_KEY, JSON.stringify({ access, refresh }));
    console.log('[TokenStorage] Tokens saved successfully');
  },

  async getTokens(): Promise<StoredTokens | null> {
    try {
      const result = await storage.getItemAsync(TOKEN_KEY);
      console.log('[TokenStorage] getTokens raw result:', result ? `${result.substring(0, 50)}...` : 'null');
      if (!result) return null;
      return JSON.parse(result) as StoredTokens;
    } catch (err) {
      console.log('[TokenStorage] getTokens error:', err);
      return null;
    }
  },

  async getAccessToken(): Promise<string | null> {
    console.log('[TokenStorage] getAccessToken called');
    const tokens = await this.getTokens();
    console.log('[TokenStorage] getAccessToken result:', tokens?.access ? 'has token' : 'no token');
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
