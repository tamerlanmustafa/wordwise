import AsyncStorage from '@react-native-async-storage/async-storage';
import type { VocabularyResponse } from './api';

const PREFIX = 'offline_vocab_';
const INDEX_KEY = 'offline_vocab_index';
const MAX_CACHED = 20;

interface CacheEntry {
  movieId: number;
  movieTitle: string;
  cachedAt: string;
}

export const offlineCache = {
  async saveVocabulary(movieId: number, movieTitle: string, data: VocabularyResponse): Promise<void> {
    try {
      await AsyncStorage.setItem(`${PREFIX}${movieId}`, JSON.stringify(data));

      const index = await this.getIndex();
      const existing = index.findIndex((e) => e.movieId === movieId);
      if (existing >= 0) index.splice(existing, 1);
      index.unshift({ movieId, movieTitle, cachedAt: new Date().toISOString() });

      if (index.length > MAX_CACHED) {
        const removed = index.splice(MAX_CACHED);
        for (const r of removed) {
          await AsyncStorage.removeItem(`${PREFIX}${r.movieId}`);
        }
      }

      await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index));
    } catch (e) {
      console.warn('[offlineCache] save failed:', e);
    }
  },

  async getVocabulary(movieId: number): Promise<VocabularyResponse | null> {
    try {
      const raw = await AsyncStorage.getItem(`${PREFIX}${movieId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  async getIndex(): Promise<CacheEntry[]> {
    try {
      const raw = await AsyncStorage.getItem(INDEX_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  async removeVocabulary(movieId: number): Promise<void> {
    try {
      await AsyncStorage.removeItem(`${PREFIX}${movieId}`);
      const index = await this.getIndex();
      const filtered = index.filter((e) => e.movieId !== movieId);
      await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(filtered));
    } catch {}
  },

  async clearAll(): Promise<void> {
    try {
      const index = await this.getIndex();
      for (const e of index) {
        await AsyncStorage.removeItem(`${PREFIX}${e.movieId}`);
      }
      await AsyncStorage.removeItem(INDEX_KEY);
    } catch {}
  },
};
