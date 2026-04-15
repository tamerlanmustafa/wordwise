import AsyncStorage from '@react-native-async-storage/async-storage';
import type { VocabularyResponse } from './api';

const PREFIX = 'offline_vocab_';
const INDEX_KEY = 'offline_vocab_index';
const MAX_CACHED = 20;

interface CacheEntry {
  cacheKey: string;
  movieTitle: string;
  cachedAt: string;
}

export interface CachedMoviePayload {
  vocabulary: VocabularyResponse;
  movieId: number;
  difficulty?: { level: string; score: number } | null;
  savedAt: string;
}

const toKey = (cacheKey: string | number) => `${PREFIX}${cacheKey}`;

export const offlineCache = {
  async savePayload(
    cacheKey: string | number,
    movieTitle: string,
    payload: Omit<CachedMoviePayload, 'savedAt'>,
  ): Promise<void> {
    try {
      const full: CachedMoviePayload = { ...payload, savedAt: new Date().toISOString() };
      await AsyncStorage.setItem(toKey(cacheKey), JSON.stringify(full));

      const index = await this.getIndex();
      const keyStr = String(cacheKey);
      const existing = index.findIndex((e) => e.cacheKey === keyStr);
      if (existing >= 0) index.splice(existing, 1);
      index.unshift({ cacheKey: keyStr, movieTitle, cachedAt: full.savedAt });

      if (index.length > MAX_CACHED) {
        const removed = index.splice(MAX_CACHED);
        for (const r of removed) {
          await AsyncStorage.removeItem(toKey(r.cacheKey));
        }
      }

      await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index));
    } catch (e) {
      console.warn('[offlineCache] save failed:', e);
    }
  },

  async getPayload(cacheKey: string | number): Promise<CachedMoviePayload | null> {
    try {
      const raw = await AsyncStorage.getItem(toKey(cacheKey));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Backwards-compat: older entries stored raw VocabularyResponse only.
      if (parsed && parsed.vocabulary && parsed.movieId != null) {
        return parsed as CachedMoviePayload;
      }
      if (parsed && parsed.level_distribution) {
        return {
          vocabulary: parsed as VocabularyResponse,
          movieId: Number(cacheKey),
          savedAt: '',
        };
      }
      return null;
    } catch {
      return null;
    }
  },

  // Legacy helpers kept for backwards compatibility.
  async saveVocabulary(movieId: number, movieTitle: string, data: VocabularyResponse): Promise<void> {
    await this.savePayload(movieId, movieTitle, { vocabulary: data, movieId });
  },

  async getVocabulary(cacheKey: string | number): Promise<VocabularyResponse | null> {
    const payload = await this.getPayload(cacheKey);
    return payload?.vocabulary || null;
  },

  async getIndex(): Promise<CacheEntry[]> {
    try {
      const raw = await AsyncStorage.getItem(INDEX_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      // Backwards-compat: older index entries used `movieId` instead of `cacheKey`.
      return arr.map((e: any) => ({
        cacheKey: String(e.cacheKey ?? e.movieId),
        movieTitle: e.movieTitle,
        cachedAt: e.cachedAt,
      }));
    } catch {
      return [];
    }
  },

  async remove(cacheKey: string | number): Promise<void> {
    try {
      await AsyncStorage.removeItem(toKey(cacheKey));
      const index = await this.getIndex();
      const filtered = index.filter((e) => e.cacheKey !== String(cacheKey));
      await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(filtered));
    } catch {}
  },

  async clearAll(): Promise<void> {
    try {
      const index = await this.getIndex();
      for (const e of index) {
        await AsyncStorage.removeItem(toKey(e.cacheKey));
      }
      await AsyncStorage.removeItem(INDEX_KEY);
    } catch {}
  },
};
