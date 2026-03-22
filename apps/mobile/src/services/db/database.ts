/**
 * Local SQLite database for offline storage
 *
 * Note: This uses op-sqlite for best performance.
 * For initial development without native modules, you can use
 * react-native-quick-sqlite or mock this interface.
 */

// Database interface for type safety
export interface Database {
  execute: (query: string, params?: unknown[]) => void;
  executeAsync: (query: string, params?: unknown[]) => Promise<void>;
  query: <T>(query: string, params?: unknown[]) => T[];
  queryAsync: <T>(query: string, params?: unknown[]) => Promise<T[]>;
}

// Schema definitions
const SCHEMA = `
  -- Cached movies for offline access
  CREATE TABLE IF NOT EXISTS cached_movies (
    id INTEGER PRIMARY KEY,
    tmdb_id INTEGER UNIQUE NOT NULL,
    data TEXT NOT NULL,
    accessed_at INTEGER NOT NULL
  );

  -- Cached books
  CREATE TABLE IF NOT EXISTS cached_books (
    id INTEGER PRIMARY KEY,
    gutenberg_id INTEGER UNIQUE NOT NULL,
    data TEXT NOT NULL,
    accessed_at INTEGER NOT NULL
  );

  -- Downloaded vocabularies (full offline access)
  CREATE TABLE IF NOT EXISTS downloaded_vocabularies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_id INTEGER NOT NULL,
    content_type TEXT NOT NULL CHECK (content_type IN ('movie', 'book')),
    data TEXT NOT NULL,
    downloaded_at INTEGER NOT NULL,
    UNIQUE(content_id, content_type)
  );

  -- Saved words (syncs with backend)
  CREATE TABLE IF NOT EXISTS saved_words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id INTEGER NOT NULL,
    word TEXT NOT NULL,
    translation TEXT,
    cefr_level TEXT,
    content_id INTEGER,
    content_type TEXT,
    created_at INTEGER NOT NULL,
    synced INTEGER DEFAULT 0,
    UNIQUE(word_id)
  );

  -- Cached translations
  CREATE TABLE IF NOT EXISTS translations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL,
    target_language TEXT NOT NULL,
    translation TEXT NOT NULL,
    cached_at INTEGER NOT NULL,
    UNIQUE(word, target_language)
  );

  -- Recent searches
  CREATE TABLE IF NOT EXISTS recent_searches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT NOT NULL UNIQUE,
    search_type TEXT NOT NULL CHECK (search_type IN ('movie', 'book')),
    searched_at INTEGER NOT NULL
  );

  -- Indexes for performance
  CREATE INDEX IF NOT EXISTS idx_saved_words_synced ON saved_words(synced);
  CREATE INDEX IF NOT EXISTS idx_cached_movies_accessed ON cached_movies(accessed_at);
  CREATE INDEX IF NOT EXISTS idx_cached_books_accessed ON cached_books(accessed_at);
  CREATE INDEX IF NOT EXISTS idx_recent_searches_time ON recent_searches(searched_at DESC);
`;

// Mock database for development (replace with op-sqlite in production)
class MockDatabase implements Database {
  private data: Map<string, unknown[]> = new Map();

  execute(query: string, _params?: unknown[]): void {
    console.log('[MockDB] Execute:', query.substring(0, 50));
  }

  async executeAsync(query: string, params?: unknown[]): Promise<void> {
    this.execute(query, params);
  }

  query<T>(_query: string, _params?: unknown[]): T[] {
    return [];
  }

  async queryAsync<T>(query: string, params?: unknown[]): Promise<T[]> {
    return this.query(query, params);
  }
}

let db: Database | null = null;

export function getDatabase(): Database {
  if (!db) {
    // TODO: Replace with actual op-sqlite implementation
    // import { open } from '@op-engineering/op-sqlite';
    // db = open({ name: 'wordwise.db' });
    db = new MockDatabase();
    initSchema(db);
  }
  return db;
}

function initSchema(database: Database): void {
  try {
    database.execute(SCHEMA);
  } catch (error) {
    console.error('[DB] Failed to initialize schema:', error);
  }
}

// Cache helpers
export const dbCache = {
  async cacheMovie(tmdbId: number, data: object): Promise<void> {
    const db = getDatabase();
    await db.executeAsync(
      `INSERT OR REPLACE INTO cached_movies (tmdb_id, data, accessed_at)
       VALUES (?, ?, ?)`,
      [tmdbId, JSON.stringify(data), Date.now()]
    );
  },

  async getCachedMovie<T>(tmdbId: number): Promise<T | null> {
    const db = getDatabase();
    const results = await db.queryAsync<{ data: string }>(
      `SELECT data FROM cached_movies WHERE tmdb_id = ?`,
      [tmdbId]
    );
    if (results.length === 0) return null;

    // Update access time
    await db.executeAsync(
      `UPDATE cached_movies SET accessed_at = ? WHERE tmdb_id = ?`,
      [Date.now(), tmdbId]
    );

    return JSON.parse(results[0].data) as T;
  },

  async saveWord(
    wordId: number,
    word: string,
    translation: string | null,
    cefrLevel: string | null,
    contentId: number | null,
    contentType: 'movie' | 'book' | null
  ): Promise<void> {
    const db = getDatabase();
    await db.executeAsync(
      `INSERT OR REPLACE INTO saved_words
       (word_id, word, translation, cefr_level, content_id, content_type, created_at, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      [wordId, word, translation, cefrLevel, contentId, contentType, Date.now()]
    );
  },

  async getUnsyncedWords(): Promise<unknown[]> {
    const db = getDatabase();
    return db.queryAsync(`SELECT * FROM saved_words WHERE synced = 0`);
  },

  async markWordsSynced(wordIds: number[]): Promise<void> {
    const db = getDatabase();
    const placeholders = wordIds.map(() => '?').join(',');
    await db.executeAsync(
      `UPDATE saved_words SET synced = 1 WHERE word_id IN (${placeholders})`,
      wordIds
    );
  },

  // LRU cache eviction - keep only the most recent N items
  async evictOldCache(table: 'cached_movies' | 'cached_books', keepCount = 100): Promise<void> {
    const db = getDatabase();
    await db.executeAsync(
      `DELETE FROM ${table} WHERE id NOT IN (
        SELECT id FROM ${table} ORDER BY accessed_at DESC LIMIT ?
      )`,
      [keepCount]
    );
  },
};
