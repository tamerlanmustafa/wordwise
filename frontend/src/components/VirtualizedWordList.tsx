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

import { memo, useCallback, useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
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
  containerRef?: React.RefObject<HTMLDivElement>;
}

const ROW_HEIGHT = 80; // Fixed row height for performance
const OVERSCAN = 8;    // Number of rows to render outside viewport
const BATCH_THRESHOLD = 200; // Request next batch when 200px from end

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
  containerRef
}) => {
  // Scroll container ref
  const parentRef = useRef<HTMLDivElement | null>(null);

  // Track if we've requested the next batch
  const hasRequestedNextBatchRef = useRef(false);

  // TanStack Virtual configuration
  const virtualizer = useVirtualizer({
    count: words.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    // Enable smooth scrolling
    scrollMargin: parentRef.current?.offsetTop ?? 0
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

    // Check if we're near the end
    const lastItem = virtualItems[virtualItems.length - 1];
    if (!lastItem) return;

    const distanceFromEnd = words.length - lastItem.index;

    // Request next batch if we're within threshold
    if (distanceFromEnd < 10 && !hasRequestedNextBatchRef.current) {
      hasRequestedNextBatchRef.current = true;
      onRequestBatch(loadedCount, 50);
    }
  }, [virtualItems, words.length, loadedCount, totalCount, isLoadingMore, onRequestBatch]);

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
  // RENDER
  // ============================================================================

  return (
    <div
      ref={parentRef}
      style={{
        height: '600px',
        overflow: 'auto',
        contain: 'strict', // Optimize rendering performance
        willChange: 'scroll-position'
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
          if (!word) return null;

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
