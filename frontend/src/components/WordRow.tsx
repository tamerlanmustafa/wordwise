/**
 * WordRow Component
 *
 * Smooth, polished word row with MUI-based expand/collapse animations.
 * Uses a card-based design with clean transitions.
 */

import { memo, useCallback, useRef } from 'react';
import {
  Box,
  Collapse,
  IconButton,
  Typography,
  Chip,
  alpha,
  styled
} from '@mui/material';
import {
  BookmarkBorder,
  Bookmark,
  CheckCircleOutline,
  CheckCircle,
  ExpandMore
} from '@mui/icons-material';
import type { DisplayWord } from '../types/vocabularyWorker';
import type { IdiomInfo } from '../services/scriptService';

// ============================================================================
// STYLED COMPONENTS
// ============================================================================

// Wrapper for the entire row + dropdown
const RowWrapper = styled(Box)(({ theme }) => ({
  borderBottom: `1px solid ${theme.palette.wordRow.panelBorder}`,
}));

// The main clickable row - fixed height, never expands
const RowContainer = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'isExpanded' && prop !== 'groupColor'
})<{ isExpanded?: boolean; groupColor?: string }>(({ theme, isExpanded }) => ({
  position: 'relative',
  backgroundColor: isExpanded
    ? theme.palette.wordRow.expandedBg
    : 'transparent',
  transition: 'background-color 0.1s ease',
  cursor: 'pointer',
  '&:hover': {
    backgroundColor: theme.palette.wordRow.hoverBg,
  },
}));

// The dropdown panel below the row - uses custom theme colors
const DropdownPanel = styled(Box)(({ theme }) => ({
  backgroundColor: theme.palette.wordRow.panelBg,
  borderTop: `1px solid ${theme.palette.wordRow.panelBorder}`,
  padding: '16px 20px 20px 56px',
  // Mobile responsive
  [theme.breakpoints.down('sm')]: {
    padding: '12px 12px 16px 12px',
  },
}));

const MainRow = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  padding: '12px 16px',
  gap: 12,
  minHeight: 48,
  // Mobile responsive
  [theme.breakpoints.down('sm')]: {
    padding: '10px 8px',
    gap: 8,
    minHeight: 44,
  },
}));

const RowNumber = styled(Typography)(({ theme }) => ({
  color: theme.palette.text.disabled,
  fontSize: '0.75rem',
  fontWeight: 500,
  minWidth: 32,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  // Mobile responsive - hide row numbers on very small screens
  [theme.breakpoints.down('xs')]: {
    display: 'none',
  },
  [theme.breakpoints.down('sm')]: {
    minWidth: 24,
    fontSize: '0.7rem',
  },
}));

const WordText = styled(Typography)(({ theme }) => ({
  fontWeight: 500,
  fontSize: '0.95rem',
  flex: 1,
  // Mobile responsive
  [theme.breakpoints.down('sm')]: {
    fontSize: '0.9rem',
  },
}));

const ExpandIcon = styled(ExpandMore, {
  shouldForwardProp: (prop) => prop !== 'isExpanded'
})<{ isExpanded?: boolean }>(({ isExpanded }) => ({
  transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
  transition: 'transform 0.3s ease',
  opacity: 0.5,
}));

const ActionButton = styled(IconButton)(({ theme }) => ({
  padding: 6,
  '&:hover': {
    backgroundColor: alpha(theme.palette.primary.main, 0.1),
  },
  // Mobile responsive - larger touch targets
  [theme.breakpoints.down('sm')]: {
    padding: 8,
    minWidth: 36,
    minHeight: 36,
  },
}));


const TranslationBox = styled(Box)(() => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
  marginBottom: 12,
}));

const ExampleCard = styled(Box)(({ theme }) => ({
  backgroundColor: theme.palette.mode === 'light'
    ? alpha(theme.palette.info.light, 0.12)
    : alpha(theme.palette.info.dark, 0.15),
  borderRadius: theme.shape.borderRadius,
  padding: '12px 14px',
  marginTop: 12,
  borderLeft: `3px solid ${theme.palette.info.main}`,
  // Mobile responsive
  [theme.breakpoints.down('sm')]: {
    padding: '10px 12px',
    marginTop: 10,
  },
}));

// TODO: Will be used when idiom panel is implemented
const _IdiomCard = styled(Box)(({ theme }) => ({
  backgroundColor: theme.palette.mode === 'light'
    ? alpha(theme.palette.warning.light, 0.15)
    : alpha(theme.palette.warning.dark, 0.18),
  borderRadius: theme.shape.borderRadius,
  padding: '12px 14px',
  marginTop: 12,
  borderLeft: `3px solid ${theme.palette.warning.main}`,
  // Mobile responsive
  [theme.breakpoints.down('sm')]: {
    padding: '10px 12px',
    marginTop: 10,
  },
}));
void _IdiomCard;

// ============================================================================
// TYPES
// ============================================================================

interface WordRowProps {
  word: DisplayWord;
  rowNumber: number;
  virtualIndex: number;
  groupColor: string;
  showDivider: boolean;
  isSaved: boolean;
  isLearned: boolean;
  canToggleLearned: boolean;
  isExpanded: boolean;  // Controlled by parent (accordion pattern)
  onSave: (word: string) => void;
  onToggleLearned: (word: string) => void;
  onTranslate: (word: string) => Promise<{ translation: string; provider?: string } | null>;
  onExpandChange: (index: number, isExpanded: boolean) => void;
  onContentLoad?: (index: number) => void;
  getIdiomsForWord?: (word: string) => Promise<IdiomInfo[]>;
  idiomMetadata?: IdiomInfo;
  movieId?: number;
  targetLang?: string;
  otherMoviesText?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

export const WordRow = memo<WordRowProps>(({
  word,
  rowNumber,
  virtualIndex,
  groupColor,
  isSaved,
  isLearned,
  canToggleLearned,
  isExpanded,  // Controlled by parent
  onSave,
  onToggleLearned,
  onTranslate: _onTranslate,
  onExpandChange,
  onContentLoad,
  getIdiomsForWord: _getIdiomsForWord,
  idiomMetadata,
  movieId: _movieId,
  targetLang: _targetLang,
  otherMoviesText
}) => {
  // TODO: These will be used when translation panel is implemented
  void _onTranslate;
  void _getIdiomsForWord;
  void _movieId;
  void _targetLang;

  const contentRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback((e: React.MouseEvent) => {
    // Don't toggle if clicking on action buttons
    if ((e.target as HTMLElement).closest('.action-button')) {
      return;
    }

    // Toggle expansion - parent controls via accordion pattern
    onExpandChange(virtualIndex, !isExpanded);
  }, [isExpanded, virtualIndex, onExpandChange]);

  const handleSave = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSave(word.word);
  }, [onSave, word.word]);

  const handleToggleLearned = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleLearned(word.word);
  }, [onToggleLearned, word.word]);

  // Notify parent when collapse animation completes
  const handleCollapseEntered = useCallback(() => {
    onContentLoad?.(virtualIndex);
  }, [onContentLoad, virtualIndex]);

  const handleCollapseExited = useCallback(() => {
    onContentLoad?.(virtualIndex);
  }, [onContentLoad, virtualIndex]);

  // TODO: Will be used when translation panel is implemented
  const _isUntranslatable = word.translation && word.translation.toLowerCase() === word.word.toLowerCase();
  void _isUntranslatable;

  return (
    <RowWrapper>
      {/* Main row - fixed height, never changes */}
      <RowContainer
        isExpanded={isExpanded}
        groupColor={groupColor}
        onClick={handleClick}
      >
        <MainRow>
          <RowNumber>{rowNumber}.</RowNumber>

          <WordText>{word.word}</WordText>

          {/* Idiom badges (for idioms tab) */}
          {idiomMetadata && (
            <>
              <Chip
                label={idiomMetadata.type === 'phrasal_verb' ? 'phrasal verb' : 'idiom'}
                size="small"
                sx={{
                  height: 20,
                  fontSize: '0.7rem',
                  bgcolor: idiomMetadata.type === 'phrasal_verb'
                    ? 'info.main'
                    : 'warning.main',
                  color: 'white',
                  // Hide on very small screens
                  display: { xs: 'none', sm: 'flex' },
                }}
              />
              <Chip
                label={idiomMetadata.cefr_level}
                size="small"
                sx={{
                  height: 20,
                  fontSize: '0.7rem',
                  bgcolor: groupColor,
                  color: 'white',
                }}
              />
            </>
          )}

          <ExpandIcon isExpanded={isExpanded} fontSize="small" />

          <ActionButton
            className="action-button"
            onClick={handleSave}
            title={otherMoviesText || (isSaved ? 'Remove from saved' : 'Save word')}
            sx={{ color: isSaved ? 'primary.main' : 'text.disabled' }}
          >
            {isSaved ? <Bookmark fontSize="small" /> : <BookmarkBorder fontSize="small" />}
          </ActionButton>

          <ActionButton
            className="action-button"
            onClick={handleToggleLearned}
            disabled={!canToggleLearned}
            title={isLearned ? 'Mark as not learned' : 'Mark as learned'}
            sx={{ color: isLearned ? 'success.main' : 'text.disabled' }}
          >
            {isLearned ? <CheckCircle fontSize="small" /> : <CheckCircleOutline fontSize="small" />}
          </ActionButton>
        </MainRow>
      </RowContainer>

      {/* Dropdown panel - slides down below the row */}
      <Collapse
        in={isExpanded}
        timeout="auto"
        onEntered={handleCollapseEntered}
        onExited={handleCollapseExited}
        unmountOnExit
      >
        <DropdownPanel ref={contentRef}>
          {/* TEMPORARY: Static placeholder content for animation testing */}
          <TranslationBox>
            <Typography
              variant="body2"
              sx={{ color: 'text.secondary', fontWeight: 300 }}
            >
              —
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.primary' }}>
              [Translation placeholder]
            </Typography>
          </TranslationBox>

          <ExampleCard>
            <Typography variant="body2" sx={{ mb: 0.5 }}>
              This is a sample sentence from the movie script.
            </Typography>
            <Typography variant="caption" color="text.secondary">
              [Sample translation]
            </Typography>
          </ExampleCard>
        </DropdownPanel>
      </Collapse>
    </RowWrapper>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.word.word === nextProps.word.word &&
    prevProps.word.translation === nextProps.word.translation &&
    prevProps.rowNumber === nextProps.rowNumber &&
    prevProps.virtualIndex === nextProps.virtualIndex &&
    prevProps.groupColor === nextProps.groupColor &&
    prevProps.isSaved === nextProps.isSaved &&
    prevProps.isLearned === nextProps.isLearned &&
    prevProps.canToggleLearned === nextProps.canToggleLearned &&
    prevProps.isExpanded === nextProps.isExpanded &&  // Accordion state
    prevProps.onSave === nextProps.onSave &&
    prevProps.onToggleLearned === nextProps.onToggleLearned &&
    prevProps.onTranslate === nextProps.onTranslate &&
    prevProps.onExpandChange === nextProps.onExpandChange &&
    prevProps.idiomMetadata === nextProps.idiomMetadata &&
    prevProps.movieId === nextProps.movieId &&
    prevProps.targetLang === nextProps.targetLang
  );
});

WordRow.displayName = 'WordRow';
