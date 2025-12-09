/**
 * VirtualizedWordList Component
 *
 * High-performance virtualized list using TanStack Virtual.
 *
 * Features:
 * - DOM recycling (only 10-20 DOM nodes for thousands of words)
 * - Smooth 60fps scrolling
 * - Automatic batch loading on scroll
 * - Progressive translation hydration
 * - Minimal re-renders via memoization
 */

import { memo, useCallback, useRef, useEffect, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useTheme as useMuiTheme } from '@mui/material/styles';
import { WordRow } from './WordRow';
import type { DisplayWord } from '../types/vocabularyWorker';

interface VirtualizedWordListProps {
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

  // Batch loading
  onRequestBatch: (startIndex: number, count: number) => void;
  isLoadingMore: boolean;

  // Other movies
  otherMovies: Record<string, Array<{ movie_id: number; title: string }>>;
  movieId?: number;

  // Container ref
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

const ROW_HEIGHT = 56; // Fixed row height for performance (matches CSS min-height)
const OVERSCAN = 8;    // Number of rows to render outside viewport
// BATCH_THRESHOLD reserved for future prefetching optimization

export const VirtualizedWordList = memo<VirtualizedWordListProps>(({
  words,
  totalCount,
  loadedCount,
  groupColor,
  isWordSavedInMovie,
  learnedWords,
  savedWords,
  onSaveWord,
  onToggleLearned,
  onRequestBatch,
  isLoadingMore,
  otherMovies,
  movieId,
  containerRef: _containerRef  // Reserved for scroll sync
}) => {
  // Scroll container ref
  const parentRef = useRef<HTMLDivElement | null>(null);

  // Track if we've requested the next batch
  const hasRequestedNextBatchRef = useRef(false);

  // Track scroll margin to avoid recalculation issues
  const [scrollMargin, setScrollMargin] = useState(0);

  // Update scroll margin when parent ref is set
  useEffect(() => {
    if (parentRef.current) {
      setScrollMargin(parentRef.current.offsetTop);
    }
  }, []);

  // TanStack Virtual configuration - use window scroll instead of container scroll
  // IMPORTANT: Use totalCount (not words.length) so the virtualizer knows the full list size
  // This prevents scroll jumps when new batches are loaded
  const virtualizer = useWindowVirtualizer({
    count: totalCount,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    scrollMargin
  });

  const virtualItems = virtualizer.getVirtualItems();

  // ============================================================================
  // INFINITE SCROLL - Request next batch when near end
  // ============================================================================

  useEffect(() => {
    // Don't request if already loading or all loaded
    if (isLoadingMore || loadedCount >= totalCount) {
      return;
    }

    // Check if we're near the end of loaded content
    const lastItem = virtualItems[virtualItems.length - 1];
    if (!lastItem) return;

    // Request next batch if the user is scrolling into unloaded territory
    // (when virtual item index approaches or exceeds loaded count)
    const needsMoreData = lastItem.index >= loadedCount - 10;

    if (needsMoreData && !hasRequestedNextBatchRef.current) {
      hasRequestedNextBatchRef.current = true;
      onRequestBatch(loadedCount, 50);
    }
  }, [virtualItems, loadedCount, totalCount, isLoadingMore, onRequestBatch]);

  // Reset batch request flag when loading completes
  useEffect(() => {
    if (!isLoadingMore) {
      hasRequestedNextBatchRef.current = false;
    }
  }, [isLoadingMore]);

  // ============================================================================
  // STABLE ROW CALLBACKS
  // ============================================================================

  const handleSaveWord = useCallback((word: string) => {
    onSaveWord(word, movieId);
  }, [onSaveWord, movieId]);

  const handleToggleLearned = useCallback((word: string) => {
    onToggleLearned(word);
  }, [onToggleLearned]);

  // ============================================================================
  // THEME - Get MUI theme for CSS variables
  // ============================================================================
  const muiTheme = useMuiTheme();

  // CSS custom properties for theme colors
  const themeVars = {
    '--text-primary': muiTheme.palette.text.primary,
    '--text-secondary': muiTheme.palette.text.secondary,
    '--text-disabled': muiTheme.palette.text.disabled,
    '--divider-color': muiTheme.palette.divider,
    '--row-hover-bg': muiTheme.palette.action.hover,
    '--action-hover-bg': muiTheme.palette.action.hover,
    '--badge-bg': muiTheme.palette.action.hover,
    '--primary-color': muiTheme.palette.primary.main,
    '--success-color': muiTheme.palette.success?.main || '#4caf50',
  } as React.CSSProperties;

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div
      ref={parentRef}
      style={{
        width: '100%',
        contain: 'layout style paint',
        ...themeVars
      }}
    >
      {/* Virtual list container */}
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative'
        }}
      >
        {/* Virtual items */}
        {virtualItems.map((virtualItem) => {
          const word = words[virtualItem.index];

          // If word not yet loaded, render placeholder to maintain scroll position
          if (!word) {
            return (
              <div
                key={`placeholder-${virtualItem.index}`}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`
                }}
              />
            );
          }

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
              key={word.index} // Use stable index from worker
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
                // GPU acceleration
                willChange: 'transform'
              }}
            >
              <WordRow
                word={word}
                rowNumber={word.position}
                groupColor={groupColor}
                showDivider={virtualItem.index < words.length - 1}
                isSaved={isSaved}
                isLearned={isLearned}
                canToggleLearned={canToggleLearned}
                onSave={handleSaveWord}
                onToggleLearned={handleToggleLearned}
                otherMoviesText={otherMoviesText}
              />
            </div>
          );
        })}
      </div>

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
  // Custom comparison - only re-render if data actually changes
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
    prevProps.onRequestBatch === nextProps.onRequestBatch
  );
});

VirtualizedWordList.displayName = 'VirtualizedWordList';
