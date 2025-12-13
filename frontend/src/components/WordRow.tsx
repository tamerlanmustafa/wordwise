/**
 * WordRow Component
 *
 * Ultra-lightweight word row component optimized for virtualized rendering.
 * Click-to-expand design: translation is only fetched when user clicks.
 *
 * Performance optimizations:
 * - Minimal DOM depth (no deep nesting)
 * - No heavy MUI components inside rows (only IconButton for actions)
 * - Custom memo comparison for precise re-render control
 * - Translation loaded on-demand (no batch API calls)
 * - CSS class toggle for fade-in effect when translation loads
 * - Stable prop references via useCallback/useMemo from parent
 */

import { memo, useState, useCallback } from 'react';
import type { DisplayWord } from '../types/vocabularyWorker';
import './WordRow.css';

// Lightweight SVG icons as components (no MUI overhead)
const BookmarkIcon = ({ filled }: { filled: boolean }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
);

const CheckCircleIcon = ({ filled }: { filled: boolean }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    {filled ? (
      <>
        <circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" />
        <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ) : (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </>
    )}
  </svg>
);

const ChevronIcon = ({ expanded }: { expanded: boolean }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    style={{
      transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
      transition: 'transform 0.2s ease'
    }}
  >
    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const LoadingSpinner = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" className="word-row__spinner">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" opacity="0.25" />
    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
  </svg>
);

interface WordRowProps {
  // Word data
  word: DisplayWord;

  // Row number (1-indexed for display)
  rowNumber: number;

  // Virtual list index (for expand tracking)
  virtualIndex: number;

  // Rendering metadata
  groupColor: string;
  showDivider: boolean;

  // Word state
  isSaved: boolean;
  isLearned: boolean;
  canToggleLearned: boolean;

  // Actions (must be stable references)
  onSave: (word: string) => void;
  onToggleLearned: (word: string) => void;
  onTranslate: (word: string) => Promise<{ translation: string; provider?: string } | null>;
  onExpandChange: (index: number, isExpanded: boolean) => void;

  // Other movies tooltip
  otherMoviesText?: string;
}

/**
 * Lightweight WordRow component with click-to-expand translation
 *
 * Uses plain HTML + CSS classes instead of MUI for maximum performance.
 * Designed to be rendered 1000s of times without performance degradation.
 */
export const WordRow = memo<WordRowProps>(({
  word,
  rowNumber,
  virtualIndex,
  groupColor,
  showDivider,
  isSaved,
  isLearned,
  canToggleLearned,
  onSave,
  onToggleLearned,
  onTranslate,
  onExpandChange,
  otherMoviesText
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [shouldRender, setShouldRender] = useState(false); // Controls DOM presence
  const [translation, setTranslation] = useState<string | null>(word.translation || null);
  const [provider, setProvider] = useState<string | null>(word.translationProvider || null);
  const [isLoading, setIsLoading] = useState(false);

  const handleRowClick = useCallback(async (e: React.MouseEvent) => {
    // Don't toggle if clicking on action buttons
    if ((e.target as HTMLElement).closest('.word-row__action-btn')) {
      return;
    }

    if (!isExpanded) {
      setShouldRender(true); // Mount immediately
      // Small delay to ensure DOM is ready before animation starts
      requestAnimationFrame(() => {
        setIsExpanded(true);
      });
      onExpandChange(virtualIndex, true);

      // Fetch translation if not already loaded
      if (!translation) {
        setIsLoading(true);
        try {
          const result = await onTranslate(word.word);
          if (result) {
            setTranslation(result.translation);
            setProvider(result.provider || null);
          }
        } catch (error) {
          console.error('Translation failed:', error);
          setTranslation('Translation failed');
        } finally {
          setIsLoading(false);
        }
      }
    } else {
      setIsExpanded(false);
      onExpandChange(virtualIndex, false);
      // Wait for animation to finish before unmounting
      setTimeout(() => {
        setShouldRender(false);
      }, 200); // Match CSS animation duration
    }
  }, [isExpanded, translation, onTranslate, word.word, virtualIndex, onExpandChange]);

  // Check if translation equals source word (should be hidden when collapsed)
  const isUntranslatable = translation && translation.toLowerCase() === word.word.toLowerCase();

  return (
    <div
      className={`word-row ${isExpanded ? 'word-row--expanded' : ''}`}
      style={{ '--group-color': groupColor } as React.CSSProperties}
      onClick={handleRowClick}
    >
      {/* Row Number */}
      <span className="word-row__number">{rowNumber}.</span>

      {/* Content */}
      <div className="word-row__content">
        {/* Word */}
        <span className="word-row__word">
          {word.word}
        </span>

        {/* Expand indicator */}
        <span className="word-row__expand-hint">
          {isLoading ? (
            <LoadingSpinner />
          ) : (
            <ChevronIcon expanded={isExpanded} />
          )}
        </span>

        {/* Translation (animated expand/collapse using CSS grid) */}
        {shouldRender && (
          <div className={`word-row__translation-container ${isExpanded ? 'word-row__translation-container--visible' : ''}`}>
            <div className="word-row__translation-inner">
              <span className="word-row__separator">—</span>
              <span className={`word-row__translation ${translation ? 'word-row__translation--loaded' : ''}`}>
                {isLoading ? 'Translating...' : (translation || '...')}
              </span>
              {provider && provider !== 'cache' && (
                <span className={`word-row__badge word-row__badge--${provider}`}>
                  {provider}
                </span>
              )}
              {isUntranslatable && (
                <span className="word-row__badge word-row__badge--warning">
                  no translation
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Metadata (confidence) - shown on hover */}
      <div className="word-row__metadata">
        {word.confidence && (
          <span className="word-row__badge">
            {Math.round(word.confidence * 100)}% conf
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="word-row__actions">
        {/* Save button */}
        <button
          className={`word-row__action-btn ${isSaved ? 'word-row__action-btn--saved' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onSave(word.word);
          }}
          title={otherMoviesText || (isSaved ? 'Remove from saved' : 'Save word')}
          aria-label={isSaved ? 'Unsave word' : 'Save word'}
        >
          <BookmarkIcon filled={isSaved} />
        </button>

        {/* Learned button */}
        <button
          className={`word-row__action-btn ${isLearned ? 'word-row__action-btn--learned' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleLearned(word.word);
          }}
          disabled={!canToggleLearned}
          title={isLearned ? 'Mark as not learned' : 'Mark as learned'}
          aria-label={isLearned ? 'Mark as unlearned' : 'Mark as learned'}
        >
          <CheckCircleIcon filled={isLearned} />
        </button>
      </div>

      {/* Divider */}
      {showDivider && <div className="word-row__divider" />}
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render if these specific props change
  return (
    prevProps.word.word === nextProps.word.word &&
    prevProps.word.translation === nextProps.word.translation &&
    prevProps.word.translationProvider === nextProps.word.translationProvider &&
    prevProps.rowNumber === nextProps.rowNumber &&
    prevProps.virtualIndex === nextProps.virtualIndex &&
    prevProps.groupColor === nextProps.groupColor &&
    prevProps.showDivider === nextProps.showDivider &&
    prevProps.isSaved === nextProps.isSaved &&
    prevProps.isLearned === nextProps.isLearned &&
    prevProps.canToggleLearned === nextProps.canToggleLearned &&
    prevProps.onSave === nextProps.onSave &&
    prevProps.onToggleLearned === nextProps.onToggleLearned &&
    prevProps.onTranslate === nextProps.onTranslate &&
    prevProps.onExpandChange === nextProps.onExpandChange
  );
});

WordRow.displayName = 'WordRow';
