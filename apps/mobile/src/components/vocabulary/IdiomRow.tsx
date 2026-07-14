import React, { memo } from 'react';
import { type IdiomInfo } from '../../services/api';
import { VocabRow } from './VocabRow';

interface Props {
  idiom: IdiomInfo;
  index: number;
  rowNumber: number;
  groupColor: string;
  movieId?: number | null;
  targetLang?: string;
  isSaved?: boolean;
  onSave?: (word: string) => void;
  isAuthenticated?: boolean;
  bookmarkHighlight?: boolean;
  accordionMode?: boolean;
  lastOpenedKey?: string | null;
  onExpand?: (key: string) => void;
}

// Thin adapter over the shared VocabRow — same anatomy as words, with the
// phrase in the word slot and a small type badge. Idioms have no batch preview,
// so the example sentence is fetched on expand and shown in the expansion.
const _IdiomRow = ({
  idiom,
  rowNumber,
  groupColor,
  movieId,
  targetLang,
  isSaved,
  onSave,
  isAuthenticated,
  bookmarkHighlight,
  accordionMode,
  lastOpenedKey,
  onExpand,
}: Props) => (
  <VocabRow
    term={idiom.phrase}
    rowNumber={rowNumber}
    levelColor={groupColor}
    variant="idiom"
    badge={idiom.type === 'phrasal_verb' ? 'phrasal verb' : 'idiom'}
    movieId={movieId}
    targetLang={targetLang}
    isSaved={isSaved}
    onSave={onSave}
    isAuthenticated={isAuthenticated}
    bookmarkHighlight={bookmarkHighlight}
    accordionMode={accordionMode}
    lastOpenedKey={lastOpenedKey}
    onExpand={onExpand}
  />
);

export const IdiomRow = memo(_IdiomRow);
