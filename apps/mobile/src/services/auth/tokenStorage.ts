import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'wordwise_tokens';

interface StoredTokens {
  access: string;
  refresh: string;
}

export const tokenStorage = {
  async saveTokens(access: string, refresh: string): Promise<void> {
    await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify({ access, refresh }));
  },

  async getTokens(): Promise<StoredTokens | null> {
    try {
      const result = await SecureStore.getItemAsync(TOKEN_KEY);
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
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  },
};
