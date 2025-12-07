/**
 * TypeScript types for Vocabulary Web Worker
 *
 * Defines message protocol and data structures for communication
 * between main thread and vocabulary processing worker
 */

import type { WordFrequency, CEFRLevel } from './script';

// ============================================================================
// STRUCT-OF-ARRAYS FORMAT (SoA)
// ============================================================================
// More memory efficient and cache-friendly than Array-of-Structs

export interface WordsStructOfArrays {
  words: string[];           // Lowercase words
  lemmas: string[];          // Lemmatized forms
  counts: number[];          // Occurrence counts
  frequencies: number[];     // Frequency scores
  confidences: number[];     // CEFR confidence scores
  frequencyRanks: (number | null)[]; // Optional frequency ranks
  indices: number[];         // Original indices for stable sorting
}

// ============================================================================
// WORKER MESSAGE TYPES
// ============================================================================

export type WorkerMessageType =
  | 'INIT_WORDS'
  | 'APPLY_FILTER'
  | 'REQUEST_BATCH'
  | 'TRANSLATION_UPDATE'
  | 'BATCH_READY'
  | 'ALL_LOADED'
  | 'ERROR'
  | 'RESET';

// ============================================================================
// OUTGOING MESSAGES (Main Thread → Worker)
// ============================================================================

export interface InitWordsMessage {
  type: 'INIT_WORDS';
  payload: {
    words: WordFrequency[];
    cefrLevel: CEFRLevel;
  };
}

export interface ApplyFilterMessage {
  type: 'APPLY_FILTER';
  payload: {
    searchQuery?: string;
    sortBy?: 'frequency' | 'alphabetical' | 'confidence';
    showOnlySaved?: boolean;
    savedWords?: Set<string>;
  };
}

export interface RequestBatchMessage {
  type: 'REQUEST_BATCH';
  payload: {
    startIndex: number;
    count: number;
  };
}

export interface TranslationUpdateMessage {
  type: 'TRANSLATION_UPDATE';
  payload: {
    translations: Array<{
      word: string;
      translation: string;
      provider?: string;
      cached?: boolean;
    }>;
  };
}

export interface ResetMessage {
  type: 'RESET';
}

export type WorkerInboundMessage =
  | InitWordsMessage
  | ApplyFilterMessage
  | RequestBatchMessage
  | TranslationUpdateMessage
  | ResetMessage;

// ============================================================================
// INCOMING MESSAGES (Worker → Main Thread)
// ============================================================================

export interface BatchReadyMessage {
  type: 'BATCH_READY';
  payload: {
    batch: DisplayWord[];
    startIndex: number;
    endIndex: number;
    totalCount: number;
  };
}

export interface AllLoadedMessage {
  type: 'ALL_LOADED';
  payload: {
    totalCount: number;
  };
}

export interface ErrorMessage {
  type: 'ERROR';
  payload: {
    message: string;
    code?: string;
  };
}

export type WorkerOutboundMessage =
  | BatchReadyMessage
  | AllLoadedMessage
  | ErrorMessage;

// ============================================================================
// DISPLAY WORD FORMAT
// ============================================================================
// Lightweight, shallow object optimized for rendering

export interface DisplayWord {
  // Core data
  word: string;              // Lowercase word
  lemma: string;             // Lemmatized form
  count: number;             // Occurrence count
  frequency: number;         // Frequency score
  confidence: number;        // CEFR confidence
  frequencyRank: number | null; // Optional rank

  // Rendering metadata
  index: number;             // Stable index for react keys

  // Translation (hydrated progressively)
  translation?: string;
  translationProvider?: string;
  translationCached?: boolean;
}

// ============================================================================
// WORKER STATE
// ============================================================================

export interface WorkerState {
  // Source data (Struct-of-Arrays)
  sourceData: WordsStructOfArrays | null;

  // Filtered indices (after search/sort)
  filteredIndices: number[];

  // Current filter/sort settings
  currentFilter: {
    searchQuery?: string;
    sortBy: 'frequency' | 'alphabetical' | 'confidence';
    showOnlySaved: boolean;
    savedWords: Set<string>;
  };

  // Translation hydration map
  translations: Map<string, {
    translation: string;
    provider?: string;
    cached?: boolean;
  }>;

  // Batch tracking
  loadedBatchEnd: number;
}
