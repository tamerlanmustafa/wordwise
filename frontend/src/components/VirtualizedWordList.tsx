/**
 * VirtualizedWordList Component
 *
 * High-performance virtualized list using TanStack Virtual.
 *
 * Features:
 * - DOM recycling (only 10-20 DOM nodes for thousands of words)
 * - Smooth 60fps scrolling
 * - Automatic batch loading on scroll
 * - Dynamic row heights for expandable rows
 * - Minimal re-renders via memoization
 */

import { memo, useCallback, useRef, useEffect, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useTheme as useMuiTheme } from '@mui/material/styles';
import { WordRow } from './WordRow';
import type { DisplayWord } from '../types/vocabularyWorker';
import type { IdiomInfo } from '../services/scriptService';

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

  // Container ref
  containerRef?: React.RefObject<HTMLDivElement | null>;

  // Report
  onReport?: (word: string) => void;
}

const ROW_HEIGHT_COLLAPSED = 60;  // Collapsed row height (includes margin)
const ROW_HEIGHT_EXPANDED_BASE = 140;   // Base expanded height (translation only)
const ROW_HEIGHT_EXPANDED_IDIOM = 100; // Smaller height for idioms (no sentence examples)
const OVERSCAN = 5;               // Number of rows to render outside viewport

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
  containerRef: _containerRef,  // Reserved for scroll sync
  onReport
}) => {
  // Scroll container ref
  const parentRef = useRef<HTMLDivElement | null>(null);

  // Track if we've requested the next batch
  const hasRequestedNextBatchRef = useRef(false);

  // Track scroll margin to avoid recalculation issues
  const [scrollMargin, setScrollMargin] = useState(0);

  // Track single expanded row (accordion pattern - only one at a time)
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

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
    estimateSize: useCallback((index: number) => {
      // Accordion pattern: only one row expanded at a time
      // For idioms tab, use smaller estimate since no sentence examples
      // For regular tabs, use base estimate (translation only) - will grow if examples load
      if (expandedIndex === index) {
        return isIdiomsTab ? ROW_HEIGHT_EXPANDED_IDIOM : ROW_HEIGHT_EXPANDED_BASE;
      }
      return ROW_HEIGHT_COLLAPSED;
    }, [expandedIndex, isIdiomsTab]),
    overscan: OVERSCAN,
    scrollMargin,
    // Enable dynamic measurements - virtualizer will measure actual DOM height
    measureElement: (el) => el?.getBoundingClientRect().height ?? ROW_HEIGHT_COLLAPSED
  });

  const virtualItems = virtualizer.getVirtualItems();

  // Callback to notify when a row expands/collapses (accordion pattern)
  const handleRowExpandChange = useCallback((index: number, isExpanded: boolean) => {
    // Accordion: toggle clicked row, or collapse if clicking the same row
    setExpandedIndex(prev => isExpanded ? index : (prev === index ? null : prev));

    // Force remeasure during animation - measure at multiple intervals
    // to track height changes as MUI Collapse animates
    const measureTimes = [0, 50, 100, 150, 200, 300];
    measureTimes.forEach(delay => {
      setTimeout(() => {
        virtualizer.measure();
      }, delay);
    });
  }, [virtualizer]);

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

  // Callback when async content (translation/examples) finishes loading or animation completes
  const handleContentLoad = useCallback((_index: number) => {
    // Remeasure the row after content loads or animation completes
    // Measure at multiple intervals to catch any final layout adjustments
    const measureTimes = [0, 50, 100, 150];
    measureTimes.forEach(delay => {
      setTimeout(() => {
        virtualizer.measure();
      }, delay);
    });
  }, [virtualizer]);

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
              data-index={virtualItem.index} // For virtualizer measurement
              ref={virtualizer.measureElement} // Enable dynamic measurement
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <WordRow
                word={word}
                rowNumber={word.position}
                virtualIndex={virtualItem.index}
                groupColor={groupColor}
                showDivider={virtualItem.index < words.length - 1}
                isSaved={isSaved}
                isLearned={isLearned}
                canToggleLearned={canToggleLearned}
                isExpanded={expandedIndex === virtualItem.index}
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
    prevProps.onTranslate === nextProps.onTranslate &&
    prevProps.onRequestBatch === nextProps.onRequestBatch
  );
});

VirtualizedWordList.displayName = 'VirtualizedWordList';
