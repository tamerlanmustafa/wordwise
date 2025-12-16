/**
 * TypeScript types for Vocabulary Web Worker
 *
 * Defines message protocol and data structures for communication
 * between main thread and vocabulary processing worker
 */

import type { WordFrequency, CEFRLevel } from './script';
import type { IdiomInfo } from '../services/scriptService';

// ============================================================================
// STRUCT-OF-ARRAYS FORMAT (SoA)
// ============================================================================
// More memory efficient and cache-friendly than Array-of-Structs
// Numeric fields use TypedArrays for better performance and transferability

export interface WordsStructOfArrays {
  words: string[];           // Lowercase words (strings must remain as array)
  lemmas: string[];          // Lemmatized forms (strings must remain as array)
  counts: Uint32Array;       // Occurrence counts (optimized)
  frequencies: Float32Array; // Frequency scores (optimized)
  confidences: Float32Array; // CEFR confidence scores (optimized)
  frequencyRanks: Int32Array;// Frequency ranks (-1 = null) (optimized)
  indices: Uint32Array;      // Original indices for stable sorting (optimized)
}

// ============================================================================
// WORKER MESSAGE TYPES
// ============================================================================

export type WorkerMessageType =
  | 'INIT_WORDS'
  | 'APPLY_FILTER'
  | 'REQUEST_BATCH'
  | 'TRANSLATION_UPDATE'
  | 'GET_IDIOMS_FOR_WORD'
  | 'IDIOMS_RESULT'
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
    idioms?: IdiomInfo[];
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

export interface GetIdiomsForWordMessage {
  type: 'GET_IDIOMS_FOR_WORD';
  payload: {
    word: string;
    requestId: string;  // For correlating async response
  };
}

export type WorkerInboundMessage =
  | InitWordsMessage
  | ApplyFilterMessage
  | RequestBatchMessage
  | TranslationUpdateMessage
  | GetIdiomsForWordMessage
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

export interface IdiomsResultMessage {
  type: 'IDIOMS_RESULT';
  payload: {
    word: string;
    requestId: string;
    idioms: IdiomInfo[];
  };
}

export type WorkerOutboundMessage =
  | BatchReadyMessage
  | AllLoadedMessage
  | ErrorMessage
  | IdiomsResultMessage;

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
  index: number;             // Stable index for react keys (source data position)
  position: number;          // Position in filtered/sorted list (1-based for display)

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
