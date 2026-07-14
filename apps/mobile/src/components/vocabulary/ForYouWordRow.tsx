import React, { memo } from 'react';
import { colors, cefrColors } from '../../theme/palette';
import { type WordInfo } from '../../services/api';
import { VocabRow, type SentenceExample } from './VocabRow';

interface Props {
  word: WordInfo;
  rowNumber: number;
  level: string;
  movieId?: number | null;
  targetLang?: string;
  isSaved?: boolean;
  onSave?: (word: string) => void;
  isAuthenticated?: boolean;
  bookmarkHighlight?: boolean;
  isRead?: boolean;
  accordionMode?: boolean;
  lastOpenedKey?: string | null;
  onExpand?: (key: string) => void;
  // Pre-fetched by the parent via the batch endpoint. `undefined` = still
  // loading (show skeleton); empty `sentence` string = confirmed miss.
  preloadedSentence?: SentenceExample;
}

// Thin adapter over the shared VocabRow (For You tab). The per-row CEFR level
// drives the highlight + expansion accent colour.
const _ForYouWordRow = ({
  word,
  rowNumber,
  level,
  movieId,
  targetLang,
  isSaved,
  onSave,
  isAuthenticated,
  bookmarkHighlight,
  isRead,
  accordionMode,
  lastOpenedKey,
  onExpand,
  preloadedSentence,
}: Props) => (
  <VocabRow
    term={word.word}
    rowNumber={rowNumber}
    levelColor={cefrColors[level] || colors.primary}
    variant="word"
    movieId={movieId}
    targetLang={targetLang}
    isSaved={isSaved}
    onSave={onSave}
    isAuthenticated={isAuthenticated}
    bookmarkHighlight={bookmarkHighlight}
    isRead={isRead}
    accordionMode={accordionMode}
    lastOpenedKey={lastOpenedKey}
    onExpand={onExpand}
    preloadedSentence={preloadedSentence}
  />
);

export const ForYouWordRow = memo(_ForYouWordRow);
