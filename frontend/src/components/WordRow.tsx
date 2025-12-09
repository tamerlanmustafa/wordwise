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
      {/* Content */}
      <div className="word-row__content">
        {/* Row Number */}
        <span className="word-row__number">{rowNumber}</span>

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
          className={`word-row__action-btn ${isSaved ? 'word-row__action-btn--active' : ''}`}
          onClick={() => onSave(word.word)}
          title={otherMoviesText || 'Save word'}
          aria-label={isSaved ? 'Unsave word' : 'Save word'}
        >
          {isSaved ? '★' : '☆'}
        </button>

        {/* Learned button */}
        <button
          className={`word-row__action-btn ${isLearned ? 'word-row__action-btn--learned' : ''}`}
          onClick={() => onToggleLearned(word.word)}
          disabled={!canToggleLearned}
          aria-label={isLearned ? 'Mark as unlearned' : 'Mark as learned'}
        >
          {isLearned ? '✓' : '○'}
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
