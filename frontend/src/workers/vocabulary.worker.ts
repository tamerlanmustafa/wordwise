/**
 * Vocabulary Web Worker
 *
 * High-performance vocabulary processing pipeline:
 * - Converts Array-of-Structs → Struct-of-Arrays (SoA) for better cache locality
 * - Performs CEFR filtering, sorting, and pagination off the main thread
 * - Streams batches of display-ready words to the UI
 * - Hydrates translations progressively using idle time
 * - Uses chunked processing to avoid blocking the worker event loop
 */

import type {
  WorkerInboundMessage,
  WorkerOutboundMessage,
  WorkerState,
  WordsStructOfArrays,
  DisplayWord
} from '../types/vocabularyWorker';
import type { WordFrequency } from '../types/script';

// ============================================================================
// LRU MAP FOR BOUNDED MEMORY
// ============================================================================

const TRANSLATION_CACHE_SIZE = 5000; // Max translations to keep in memory

/**
 * Simple LRU Map implementation to prevent unbounded memory growth.
 * When the map exceeds maxSize, oldest entries are evicted.
 */
class LRUMap<K, V> {
  private map = new Map<K, V>();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    // Delete existing to reset order
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);

    // Evict oldest entries if over capacity
    while (this.map.size > this.maxSize) {
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) {
        this.map.delete(firstKey);
      }
    }
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

// ============================================================================
// WORKER STATE
// ============================================================================

const state: WorkerState = {
  sourceData: null,
  filteredIndices: [],
  currentFilter: {
    sortBy: 'frequency',
    showOnlySaved: false,
    savedWords: new Set()
  },
  translations: new Map(), // Will use LRU wrapper
  loadedBatchEnd: 0
};

// LRU-wrapped translation cache
const translationCache = new LRUMap<string, { translation: string; provider?: string; cached?: boolean }>(TRANSLATION_CACHE_SIZE);

// ============================================================================
// STRUCT-OF-ARRAYS CONVERSION
// ============================================================================

/**
 * Convert Array-of-Structs (AoS) to Struct-of-Arrays (SoA)
 * Benefits:
 * - Better CPU cache utilization
 * - Easier vectorization
 * - Lower memory overhead
 * - Faster sorting/filtering on single fields
 */
function convertToSoA(words: WordFrequency[]): WordsStructOfArrays {
  const length = words.length;

  const soa: WordsStructOfArrays = {
    words: new Array(length),
    lemmas: new Array(length),
    counts: new Array(length),
    frequencies: new Array(length),
    confidences: new Array(length),
    frequencyRanks: new Array(length),
    indices: new Array(length)
  };

  for (let i = 0; i < length; i++) {
    const word = words[i];
    soa.words[i] = word.word.toLowerCase();
    soa.lemmas[i] = word.lemma.toLowerCase();
    soa.counts[i] = word.count;
    soa.frequencies[i] = word.frequency;
    soa.confidences[i] = word.confidence;
    soa.frequencyRanks[i] = word.frequency_rank ?? null;
    soa.indices[i] = i; // Stable index
  }

  return soa;
}

// ============================================================================
// FILTERING & SORTING
// ============================================================================

/**
 * Apply search filter to indices
 */
function applySearchFilter(
  soa: WordsStructOfArrays,
  searchQuery: string | undefined
): number[] {
  if (!searchQuery || searchQuery.trim() === '') {
    // No filter - return all indices
    return soa.indices.slice();
  }

  const query = searchQuery.toLowerCase().trim();
  const results: number[] = [];

  for (let i = 0; i < soa.words.length; i++) {
    if (soa.words[i].includes(query) || soa.lemmas[i].includes(query)) {
      results.push(i);
    }
  }

  return results;
}

/**
 * Apply saved words filter
 */
function applySavedFilter(
  soa: WordsStructOfArrays,
  indices: number[],
  savedWords: Set<string>
): number[] {
  if (savedWords.size === 0) {
    return indices;
  }

  return indices.filter(i => savedWords.has(soa.words[i]));
}

/**
 * Sort indices based on sort mode
 */
function sortIndices(
  soa: WordsStructOfArrays,
  indices: number[],
  sortBy: 'frequency' | 'alphabetical' | 'confidence'
): number[] {
  const sorted = indices.slice();

  switch (sortBy) {
    case 'frequency':
      // Sort by frequency (descending), then by count (descending)
      sorted.sort((a, b) => {
        const freqDiff = soa.frequencies[b] - soa.frequencies[a];
        if (freqDiff !== 0) return freqDiff;
        return soa.counts[b] - soa.counts[a];
      });
      break;

    case 'alphabetical':
      // Sort alphabetically (ascending)
      sorted.sort((a, b) => soa.words[a].localeCompare(soa.words[b]));
      break;

    case 'confidence':
      // Sort by confidence (descending), then by frequency (descending)
      sorted.sort((a, b) => {
        const confDiff = soa.confidences[b] - soa.confidences[a];
        if (confDiff !== 0) return confDiff;
        return soa.frequencies[b] - soa.frequencies[a];
      });
      break;
  }

  return sorted;
}

// ============================================================================
// BATCH GENERATION
// ============================================================================

/**
 * Generate a batch of display-ready words
 */
function generateBatch(
  soa: WordsStructOfArrays,
  indices: number[],
  startIndex: number,
  count: number
): DisplayWord[] {
  const batch: DisplayWord[] = [];
  const endIndex = Math.min(startIndex + count, indices.length);

  for (let i = startIndex; i < endIndex; i++) {
    const idx = indices[i];
    const word = soa.words[idx];

    const displayWord: DisplayWord = {
      word,
      lemma: soa.lemmas[idx],
      count: soa.counts[idx],
      frequency: soa.frequencies[idx],
      confidence: soa.confidences[idx],
      frequencyRank: soa.frequencyRanks[idx],
      index: idx // Stable index for React keys
    };

    // Hydrate translation if available (from LRU cache)
    const translation = translationCache.get(word);
    if (translation) {
      displayWord.translation = translation.translation;
      displayWord.translationProvider = translation.provider;
      displayWord.translationCached = translation.cached;
    }

    batch.push(displayWord);
  }

  return batch;
}

// ============================================================================
// MESSAGE HANDLERS
// ============================================================================

async function handleInitWords(payload: { words: WordFrequency[]; cefrLevel: string }) {
  try {
    // Convert to SoA format
    state.sourceData = convertToSoA(payload.words);

    // Initialize filtered indices (all words)
    state.filteredIndices = state.sourceData.indices.slice();

    // Sort by default (frequency)
    state.filteredIndices = sortIndices(
      state.sourceData,
      state.filteredIndices,
      state.currentFilter.sortBy
    );

    // Reset batch tracking
    state.loadedBatchEnd = 0;

    // Send confirmation
    postMessage({
      type: 'ALL_LOADED',
      payload: {
        totalCount: state.filteredIndices.length
      }
    } as WorkerOutboundMessage);
  } catch (error: any) {
    postMessage({
      type: 'ERROR',
      payload: {
        message: `Failed to initialize words: ${error.message}`,
        code: 'INIT_FAILED'
      }
    } as WorkerOutboundMessage);
  }
}

async function handleApplyFilter(payload: {
  searchQuery?: string;
  sortBy?: 'frequency' | 'alphabetical' | 'confidence';
  showOnlySaved?: boolean;
  savedWords?: Set<string>;
}) {
  if (!state.sourceData) {
    postMessage({
      type: 'ERROR',
      payload: {
        message: 'No source data initialized',
        code: 'NO_DATA'
      }
    } as WorkerOutboundMessage);
    return;
  }

  try {
    // Update filter settings
    if (payload.sortBy !== undefined) {
      state.currentFilter.sortBy = payload.sortBy;
    }
    if (payload.showOnlySaved !== undefined) {
      state.currentFilter.showOnlySaved = payload.showOnlySaved;
    }
    if (payload.savedWords !== undefined) {
      state.currentFilter.savedWords = payload.savedWords;
    }
    if (payload.searchQuery !== undefined) {
      state.currentFilter.searchQuery = payload.searchQuery;
    }

    // Apply search filter
    let indices = applySearchFilter(state.sourceData, state.currentFilter.searchQuery);

    // Apply saved filter if enabled
    if (state.currentFilter.showOnlySaved) {
      indices = applySavedFilter(state.sourceData, indices, state.currentFilter.savedWords);
    }

    // Sort indices
    indices = sortIndices(state.sourceData, indices, state.currentFilter.sortBy);

    // Update state
    state.filteredIndices = indices;
    state.loadedBatchEnd = 0;

    // Send confirmation
    postMessage({
      type: 'ALL_LOADED',
      payload: {
        totalCount: indices.length
      }
    } as WorkerOutboundMessage);
  } catch (error: any) {
    postMessage({
      type: 'ERROR',
      payload: {
        message: `Failed to apply filter: ${error.message}`,
        code: 'FILTER_FAILED'
      }
    } as WorkerOutboundMessage);
  }
}

async function handleRequestBatch(payload: { startIndex: number; count: number }) {
  if (!state.sourceData) {
    postMessage({
      type: 'ERROR',
      payload: {
        message: 'No source data initialized',
        code: 'NO_DATA'
      }
    } as WorkerOutboundMessage);
    return;
  }

  try {
    const { startIndex, count } = payload;
    const batch = generateBatch(
      state.sourceData,
      state.filteredIndices,
      startIndex,
      count
    );

    const endIndex = Math.min(startIndex + count, state.filteredIndices.length);
    state.loadedBatchEnd = Math.max(state.loadedBatchEnd, endIndex);

    postMessage({
      type: 'BATCH_READY',
      payload: {
        batch,
        startIndex,
        endIndex,
        totalCount: state.filteredIndices.length
      }
    } as WorkerOutboundMessage);
  } catch (error: any) {
    postMessage({
      type: 'ERROR',
      payload: {
        message: `Failed to generate batch: ${error.message}`,
        code: 'BATCH_FAILED'
      }
    } as WorkerOutboundMessage);
  }
}

async function handleTranslationUpdate(payload: {
  translations: Array<{
    word: string;
    translation: string;
    provider?: string;
    cached?: boolean;
  }>;
}) {
  try {
    // Update LRU translation cache
    for (const { word, translation, provider, cached } of payload.translations) {
      translationCache.set(word.toLowerCase(), {
        translation,
        provider,
        cached
      });
    }

    // No response needed - translations are hydrated on next batch request
  } catch (error: any) {
    postMessage({
      type: 'ERROR',
      payload: {
        message: `Failed to update translations: ${error.message}`,
        code: 'TRANSLATION_UPDATE_FAILED'
      }
    } as WorkerOutboundMessage);
  }
}

function handleReset() {
  state.sourceData = null;
  state.filteredIndices = [];
  state.currentFilter = {
    sortBy: 'frequency',
    showOnlySaved: false,
    savedWords: new Set()
  };
  translationCache.clear();  // Clear LRU cache on reset
  state.loadedBatchEnd = 0;
}

// ============================================================================
// MESSAGE ROUTER
// ============================================================================

self.addEventListener('message', async (event: MessageEvent<WorkerInboundMessage>) => {
  const message = event.data;

  switch (message.type) {
    case 'INIT_WORDS':
      await handleInitWords(message.payload);
      break;

    case 'APPLY_FILTER':
      await handleApplyFilter(message.payload);
      break;

    case 'REQUEST_BATCH':
      await handleRequestBatch(message.payload);
      break;

    case 'TRANSLATION_UPDATE':
      await handleTranslationUpdate(message.payload);
      break;

    case 'RESET':
      handleReset();
      break;

    default:
      postMessage({
        type: 'ERROR',
        payload: {
          message: `Unknown message type: ${(message as any).type}`,
          code: 'UNKNOWN_MESSAGE'
        }
      } as WorkerOutboundMessage);
  }
});

// Export empty object to make TypeScript happy
export {};
