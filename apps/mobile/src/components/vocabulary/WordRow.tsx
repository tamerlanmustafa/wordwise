import React, { memo } from 'react';
import { type WordInfo } from '../../services/api';
import { VocabRow, type SentenceExample } from './VocabRow';

export type { SentenceExample };

interface Props {
  word: WordInfo;
  index: number;
  rowNumber: number;
  groupColor: string;
  movieId?: number | null;
  movieTitle?: string;
  targetLang?: string;
  isSaved?: boolean;
  onSave?: (word: string) => void;
  isAuthenticated?: boolean;
  bookmarkHighlight?: boolean;
  accordionMode?: boolean;
  lastOpenedKey?: string | null;
  onExpand?: (key: string) => void;
  displayLevel?: string;
  freqFill?: number;   // retained for API compatibility; the unified row no
                       // longer renders a rarity bar
  isRead?: boolean;
  onHide?: (word: string) => void;
  // Batch-prefetched preview so level-tab rows show the sentence when collapsed
  // (same source the parent already uses to filter the list).
  preloadedSentence?: SentenceExample;
}

// Thin adapter over the shared VocabRow (level-tab word rows). React.memo is
// preserved so a parent re-render (e.g. lastOpenedKey / savedWords changing)
// only re-renders the rows whose own props actually changed.
const _WordRow = ({
  word,
  rowNumber,
  groupColor,
  movieId,
  movieTitle,
  targetLang,
  isSaved,
  onSave,
  isAuthenticated,
  bookmarkHighlight,
  accordionMode,
  lastOpenedKey,
  onExpand,
  isRead,
  onHide,
  preloadedSentence,
}: Props) => (
  <VocabRow
    term={word.word}
    rowNumber={rowNumber}
    levelColor={groupColor}
    variant="word"
    movieId={movieId}
    movieTitle={movieTitle}
    targetLang={targetLang}
    isSaved={isSaved}
    onSave={onSave}
    isAuthenticated={isAuthenticated}
    bookmarkHighlight={bookmarkHighlight}
    isRead={isRead}
    accordionMode={accordionMode}
    lastOpenedKey={lastOpenedKey}
    onExpand={onExpand}
    onHide={onHide}
    preloadedSentence={preloadedSentence}
  />
);

export const WordRow = memo(_WordRow);
