/**
 * SimpleWordList Component
 *
 * Simple word list using native CSS content-visibility for performance.
 * No virtualization library - just renders all words with CSS optimization.
 *
 * Features:
 * - Accordion pattern (one expanded at a time)
 * - CSS content-visibility: auto for native browser virtualization
 * - No height measurement issues
 * - Smooth MUI Collapse animations
 */

import { memo, useCallback, useState, useEffect, useRef } from 'react';
import { useTheme as useMuiTheme } from '@mui/material/styles';
import { WordRow } from './WordRow';
import type { DisplayWord } from '../types/vocabularyWorker';
import type { IdiomInfo } from '../services/scriptService';

interface SimpleWordListProps {
  // Data
  words: DisplayWord[];
  totalCount: number;
  loadedCount: number;

  // Rendering
  groupColor: string;

  // Word state
  isWordSavedInMovie: (word: string, movieId?: number) => boolean;
  learnedWords: Set<string>;
  savedWords: Set<string>;

  // Actions (must be stable)
  onSaveWord: (word: string, movieId?: number) => void;
  onToggleLearned: (word: string) => void;
  onTranslate: (word: string) => Promise<{ translation: string; provider?: string } | null>;

  // Batch loading
  onRequestBatch: (startIndex: number, count: number) => void;
  isLoadingMore: boolean;

  // Other movies
  otherMovies: Record<string, Array<{ movie_id: number; title: string }>>;
  movieId?: number;
  movieTitle?: string;

  // Idiom lookup
  getIdiomsForWord?: (word: string) => Promise<IdiomInfo[]>;
  idiomsMap?: Map<string, IdiomInfo>;
  isIdiomsTab?: boolean;

  // Sentence examples enrichment
  targetLang?: string;

  // Report
  onReport?: (word: string, translationSource?: string) => void;
}

export const SimpleWordList = memo<SimpleWordListProps>(({
  words,
  totalCount,
  loadedCount,
  groupColor,
  isWordSavedInMovie,
  learnedWords,
  savedWords,
  onSaveWord,
  onToggleLearned,
  onTranslate,
  onRequestBatch,
  isLoadingMore,
  otherMovies,
  movieId,
  movieTitle,
  getIdiomsForWord,
  idiomsMap,
  isIdiomsTab = false,
  targetLang,
  onReport
}) => {
  // Accordion state - only one row expanded at a time
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  // Ref for intersection observer (infinite scroll)
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const hasRequestedRef = useRef(false);

  // Infinite scroll - load more when sentinel comes into view
  useEffect(() => {
    if (!loadMoreRef.current || isLoadingMore || loadedCount >= totalCount) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !hasRequestedRef.current) {
          hasRequestedRef.current = true;
          onRequestBatch(loadedCount, 50);
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [loadedCount, totalCount, isLoadingMore, onRequestBatch]);

  // Reset request flag when loading completes
  useEffect(() => {
    if (!isLoadingMore) {
      hasRequestedRef.current = false;
    }
  }, [isLoadingMore]);

  // Accordion toggle handler
  const handleRowExpandChange = useCallback((index: number, isExpanded: boolean) => {
    setExpandedIndex(prev => isExpanded ? index : (prev === index ? null : prev));
  }, []);

  // Stable callbacks
  const handleSaveWord = useCallback((word: string) => {
    onSaveWord(word, movieId);
  }, [onSaveWord, movieId]);

  const handleToggleLearned = useCallback((word: string) => {
    onToggleLearned(word);
  }, [onToggleLearned]);

  // No-op for content load (no virtualization to update)
  const handleContentLoad = useCallback(() => {}, []);

  // Theme
  const muiTheme = useMuiTheme();
  const themeVars = {
    '--text-primary': muiTheme.palette.text.primary,
    '--text-secondary': muiTheme.palette.text.secondary,
    '--text-disabled': muiTheme.palette.text.disabled,
    '--divider-color': muiTheme.palette.divider,
    '--row-hover-bg': muiTheme.palette.action.hover,
    '--primary-color': muiTheme.palette.primary.main,
    '--success-color': muiTheme.palette.success?.main || '#4caf50',
  } as React.CSSProperties;

  return (
    <div style={{ width: '100%', ...themeVars }}>
      {/* Word rows with CSS content-visibility optimization */}
      {words.map((word, index) => {
        const wordLower = word.word.toLowerCase();
        const isSaved = isWordSavedInMovie(wordLower, movieId);
        const isLearned = learnedWords.has(wordLower);
        const canToggleLearned = savedWords.has(wordLower);
        const otherMoviesList = otherMovies[wordLower];
        const otherMoviesText = otherMoviesList && otherMoviesList.length > 0
          ? `Also in: ${otherMoviesList.map(m => m.title).join(', ')}`
          : undefined;

        return (
          <div
            key={word.index}
            style={{
              // Native browser virtualization - skips rendering off-screen content
              contentVisibility: 'auto',
              containIntrinsicSize: '0 68px', // Approximate collapsed height
            }}
          >
            <WordRow
              word={word}
              rowNumber={word.position}
              virtualIndex={index}
              groupColor={groupColor}
              showDivider={index < words.length - 1}
              isSaved={isSaved}
              isLearned={isLearned}
              canToggleLearned={canToggleLearned}
              isExpanded={expandedIndex === index}
              onSave={handleSaveWord}
              onToggleLearned={handleToggleLearned}
              onTranslate={onTranslate}
              onExpandChange={handleRowExpandChange}
              onContentLoad={handleContentLoad}
              otherMoviesText={otherMoviesText}
              getIdiomsForWord={getIdiomsForWord}
              idiomMetadata={isIdiomsTab && idiomsMap ? idiomsMap.get(word.word) : undefined}
              movieId={movieId}
              movieTitle={movieTitle}
              targetLang={targetLang}
              onReport={onReport}
            />
          </div>
        );
      })}

      {/* Infinite scroll sentinel */}
      {loadedCount < totalCount && (
        <div ref={loadMoreRef} style={{ height: 1 }} />
      )}

      {/* Loading indicator */}
      {isLoadingMore && (
        <div
          style={{
            padding: '24px',
            textAlign: 'center',
            color: groupColor
          }}
        >
          <div style={{ fontSize: '0.875rem', opacity: 0.7 }}>
            Loading more words...
          </div>
        </div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.words === nextProps.words &&
    prevProps.totalCount === nextProps.totalCount &&
    prevProps.loadedCount === nextProps.loadedCount &&
    prevProps.groupColor === nextProps.groupColor &&
    prevProps.isLoadingMore === nextProps.isLoadingMore &&
    prevProps.learnedWords === nextProps.learnedWords &&
    prevProps.savedWords === nextProps.savedWords &&
    prevProps.isWordSavedInMovie === nextProps.isWordSavedInMovie &&
    prevProps.onSaveWord === nextProps.onSaveWord &&
    prevProps.onToggleLearned === nextProps.onToggleLearned &&
    prevProps.onTranslate === nextProps.onTranslate &&
    prevProps.onRequestBatch === nextProps.onRequestBatch
  );
});

SimpleWordList.displayName = 'SimpleWordList';
