/**
 * WordRow Component
 *
 * Ultra-lightweight word row component optimized for virtualized rendering.
 *
 * Performance optimizations:
 * - Minimal DOM depth (no deep nesting)
 * - No heavy MUI components inside rows (only IconButton for actions)
 * - Custom memo comparison for precise re-render control
 * - Placeholder translation text for instant rendering
 * - CSS class toggle for fade-in effect when translation loads
 * - Stable prop references via useCallback/useMemo from parent
 */

import { memo } from 'react';
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

interface WordRowProps {
  // Word data
  word: DisplayWord;

  // Row number (1-indexed for display)
  rowNumber: number;

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

  // Other movies tooltip
  otherMoviesText?: string;
}

/**
 * Lightweight WordRow component
 *
 * Uses plain HTML + CSS classes instead of MUI for maximum performance.
 * Designed to be rendered 1000s of times without performance degradation.
 */
export const WordRow = memo<WordRowProps>(({
  word,
  rowNumber,
  groupColor,
  showDivider,
  isSaved,
  isLearned,
  canToggleLearned,
  onSave,
  onToggleLearned,
  otherMoviesText
}) => {
  const hasTranslation = !!word.translation;
  const translationText = word.translation || '...';
  const translationClass = hasTranslation ? 'word-row__translation--loaded' : 'word-row__translation--loading';

  return (
    <div className="word-row" style={{ '--group-color': groupColor } as React.CSSProperties}>
      {/* Row Number */}
      <span className="word-row__number">{rowNumber}.</span>

      {/* Content */}
      <div className="word-row__content">
        {/* Word */}
        <span className="word-row__word">
          {word.word}
        </span>

        {/* Separator */}
        <span className="word-row__separator">—</span>

        {/* Translation (fades in when loaded) */}
        <span className={`word-row__translation ${translationClass}`}>
          {translationText}
        </span>
      </div>

      {/* Metadata */}
      <div className="word-row__metadata">
        {word.confidence && (
          <span className="word-row__badge">
            {Math.round(word.confidence * 100)}% conf
          </span>
        )}
        {word.translationCached && (
          <span className="word-row__badge word-row__badge--cached">
            cached
          </span>
        )}
        {word.translationProvider && word.translationProvider !== 'cache' && (
          <span className={`word-row__badge word-row__badge--${word.translationProvider}`}>
            {word.translationProvider}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="word-row__actions">
        {/* Save button */}
        <button
          className={`word-row__action-btn ${isSaved ? 'word-row__action-btn--saved' : ''}`}
          onClick={() => onSave(word.word)}
          title={otherMoviesText || (isSaved ? 'Remove from saved' : 'Save word')}
          aria-label={isSaved ? 'Unsave word' : 'Save word'}
        >
          <BookmarkIcon filled={isSaved} />
        </button>

        {/* Learned button */}
        <button
          className={`word-row__action-btn ${isLearned ? 'word-row__action-btn--learned' : ''}`}
          onClick={() => onToggleLearned(word.word)}
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
    prevProps.word.translationCached === nextProps.word.translationCached &&
    prevProps.rowNumber === nextProps.rowNumber &&
    prevProps.groupColor === nextProps.groupColor &&
    prevProps.showDivider === nextProps.showDivider &&
    prevProps.isSaved === nextProps.isSaved &&
    prevProps.isLearned === nextProps.isLearned &&
    prevProps.canToggleLearned === nextProps.canToggleLearned &&
    prevProps.onSave === nextProps.onSave &&
    prevProps.onToggleLearned === nextProps.onToggleLearned
  );
});

WordRow.displayName = 'WordRow';
