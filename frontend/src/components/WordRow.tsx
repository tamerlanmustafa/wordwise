/**
 * WordRow Component
 *
 * Smooth, polished word row with MUI-based expand/collapse animations.
 * Uses a card-based design with clean transitions.
 */

import { memo, useState, useCallback, useRef } from 'react';
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

const RowContainer = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'isExpanded' && prop !== 'groupColor'
})<{ isExpanded?: boolean; groupColor?: string }>(({ theme, isExpanded, groupColor }) => ({
  position: 'relative',
  borderRadius: 8,
  marginBottom: 4,
  backgroundColor: isExpanded
    ? alpha(groupColor || theme.palette.primary.main, 0.04)
    : 'transparent',
  border: `1px solid ${isExpanded ? alpha(groupColor || theme.palette.primary.main, 0.2) : 'transparent'}`,
  transition: 'all 0.2s ease-in-out',
  cursor: 'pointer',
  '&:hover': {
    backgroundColor: alpha(groupColor || theme.palette.primary.main, 0.06),
    borderColor: alpha(groupColor || theme.palette.primary.main, 0.15),
  },
}));

const MainRow = styled(Box)(() => ({
  display: 'flex',
  alignItems: 'center',
  padding: '12px 16px',
  gap: 12,
  minHeight: 48,
}));

const RowNumber = styled(Typography)(({ theme }) => ({
  color: theme.palette.text.disabled,
  fontSize: '0.75rem',
  fontWeight: 500,
  minWidth: 32,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
}));

const WordText = styled(Typography)(() => ({
  fontWeight: 500,
  fontSize: '0.95rem',
  flex: 1,
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
}));

const ExpandedContent = styled(Box)(() => ({
  padding: '0 16px 16px 60px',
}));

const TranslationBox = styled(Box)(() => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
  marginBottom: 12,
}));

const ExampleCard = styled(Box)(({ theme }) => ({
  backgroundColor: alpha(theme.palette.background.default, 0.6),
  borderRadius: 6,
  padding: '10px 12px',
  marginTop: 8,
  borderLeft: `3px solid ${alpha(theme.palette.primary.main, 0.3)}`,
}));

const IdiomCard = styled(Box)(({ theme }) => ({
  backgroundColor: alpha(theme.palette.warning.main, 0.08),
  borderRadius: 6,
  padding: '10px 12px',
  marginTop: 8,
  borderLeft: `3px solid ${alpha(theme.palette.warning.main, 0.4)}`,
}));

// ============================================================================
// TYPES
// ============================================================================

interface SentenceExample {
  sentence: string;
  translation: string;
  word_position: number;
}

interface WordRowProps {
  word: DisplayWord;
  rowNumber: number;
  virtualIndex: number;
  groupColor: string;
  showDivider: boolean;
  isSaved: boolean;
  isLearned: boolean;
  canToggleLearned: boolean;
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

// Maximum time to wait for translation before expanding anyway
const EXPAND_TIMEOUT_MS = 250;

export const WordRow = memo<WordRowProps>(({
  word,
  rowNumber,
  virtualIndex,
  groupColor,
  isSaved,
  isLearned,
  canToggleLearned,
  onSave,
  onToggleLearned,
  onTranslate,
  onExpandChange,
  onContentLoad,
  getIdiomsForWord,
  idiomMetadata,
  movieId,
  targetLang,
  otherMoviesText
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isPending, setIsPending] = useState(false); // Loading state before expand
  const [translation, setTranslation] = useState<string | null>(word.translation || null);
  const [provider, setProvider] = useState<string | null>(word.translationProvider || null);

  const [idiomInfo, setIdiomInfo] = useState<{ idiom: IdiomInfo; translation: string } | null>(null);

  const [sentenceExamples, setSentenceExamples] = useState<SentenceExample[] | null>(null);

  const contentRef = useRef<HTMLDivElement>(null);
  const hasLoadedContent = useRef(false);

  const handleClick = useCallback(async (e: React.MouseEvent) => {
    // Don't toggle if clicking on action buttons
    if ((e.target as HTMLElement).closest('.action-button')) {
      return;
    }

    // If already expanded, just collapse
    if (isExpanded) {
      setIsExpanded(false);
      onExpandChange(virtualIndex, false);
      return;
    }

    // If already pending, ignore click
    if (isPending) return;

    // If content is already loaded, expand immediately
    if (hasLoadedContent.current) {
      setIsExpanded(true);
      onExpandChange(virtualIndex, true);
      return;
    }

    // Start loading all content, then expand
    setIsPending(true);
    hasLoadedContent.current = true;

    // Load all content in parallel
    const loadAllContent = async () => {
      const promises: Promise<void>[] = [];

      // Load translation
      if (!translation) {
        promises.push(
          (async () => {
            try {
              const result = await onTranslate(word.word);
              if (result) {
                setTranslation(result.translation);
                setProvider(result.provider || null);
              }
            } catch (error) {
              console.error('Translation failed:', error);
              setTranslation('Translation failed');
            }
          })()
        );
      }

      // Load sentence examples (not for idioms tab)
      if (movieId && targetLang && !idiomMetadata) {
        promises.push(
          (async () => {
            try {
              const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
              const response = await fetch(
                `${API_BASE_URL}/api/enrichment/movies/${movieId}/examples/${encodeURIComponent(word.word)}?lang=${targetLang}`
              );
              if (response.ok) {
                const data = await response.json();
                setSentenceExamples(data.examples || []);
              }
            } catch (error) {
              console.error('Sentence examples fetch failed:', error);
            }
          })()
        );
      }

      // Load idiom context (not for idioms tab)
      if (getIdiomsForWord && !idiomMetadata) {
        promises.push(
          (async () => {
            try {
              const idioms = await getIdiomsForWord(word.word);
              if (idioms.length > 0) {
                const idiomTranslation = await onTranslate(idioms[0].phrase);
                if (idiomTranslation) {
                  setIdiomInfo({
                    idiom: idioms[0],
                    translation: idiomTranslation.translation
                  });
                }
              }
            } catch (error) {
              console.error('Idiom lookup failed:', error);
            }
          })()
        );
      }

      await Promise.all(promises);
    };

    // Race between content loading and timeout
    const contentPromise = loadAllContent();
    const timeoutPromise = new Promise<void>(resolve =>
      setTimeout(resolve, EXPAND_TIMEOUT_MS)
    );

    // Wait for either all content to load or timeout
    await Promise.race([contentPromise, timeoutPromise]);

    // Now expand (content may or may not be fully ready)
    setIsPending(false);
    setIsExpanded(true);
    onExpandChange(virtualIndex, true);
  }, [isExpanded, isPending, translation, virtualIndex, onExpandChange, onTranslate, word.word, movieId, targetLang, idiomMetadata, getIdiomsForWord]);

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

  const isUntranslatable = translation && translation.toLowerCase() === word.word.toLowerCase();

  return (
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

        {isPending ? (
          <Box
            sx={{
              width: 20,
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Box
              sx={{
                width: 14,
                height: 14,
                border: '2px solid',
                borderColor: 'text.disabled',
                borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
                '@keyframes spin': {
                  '0%': { transform: 'rotate(0deg)' },
                  '100%': { transform: 'rotate(360deg)' },
                },
              }}
            />
          </Box>
        ) : (
          <ExpandIcon isExpanded={isExpanded} fontSize="small" />
        )}

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

      <Collapse
        in={isExpanded}
        timeout={150}
        easing="ease-in-out"
        onEntered={handleCollapseEntered}
        onExited={handleCollapseExited}
        unmountOnExit
      >
        <ExpandedContent ref={contentRef}>
          {/* Translation */}
          <TranslationBox>
            <Typography
              variant="body2"
              sx={{ color: 'text.secondary', fontWeight: 300 }}
            >
              —
            </Typography>

            <Typography
              variant="body2"
              sx={{
                color: 'text.primary',
                fontStyle: isUntranslatable ? 'italic' : 'normal',
                opacity: isUntranslatable ? 0.6 : 1,
              }}
            >
              {translation || '...'}
            </Typography>

            {provider && provider !== 'cache' && (
              <Chip
                label={provider}
                size="small"
                variant="outlined"
                sx={{
                  height: 18,
                  fontSize: '0.65rem',
                  '& .MuiChip-label': { px: 1 }
                }}
              />
            )}

            {isUntranslatable && (
              <Chip
                label="no translation"
                size="small"
                sx={{
                  height: 18,
                  fontSize: '0.65rem',
                  bgcolor: 'warning.light',
                  color: 'warning.dark',
                }}
              />
            )}
          </TranslationBox>

          {/* Idiom context (when word is part of an idiom) - only show when data is ready */}
          {idiomInfo && (
            <IdiomCard>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="caption" color="text.secondary">
                  Part of:
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  "{idiomInfo.idiom.phrase}"
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  — {idiomInfo.translation}
                </Typography>
                <Chip
                  label={idiomInfo.idiom.cefr_level}
                  size="small"
                  sx={{
                    height: 18,
                    fontSize: '0.65rem',
                    bgcolor: idiomInfo.idiom.type === 'phrasal_verb' ? 'info.main' : 'warning.main',
                    color: 'white',
                  }}
                />
              </Box>
            </IdiomCard>
          )}

          {/* Sentence examples */}
          {(sentenceExamples && sentenceExamples.length > 0) && (
            <Box sx={{ mt: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                  Movie examples
                </Typography>
                <Chip
                  label={sentenceExamples.length}
                  size="small"
                  sx={{
                    height: 16,
                    fontSize: '0.6rem',
                    minWidth: 20,
                  }}
                />
              </Box>
              {sentenceExamples.map((example, idx) => (
                <ExampleCard key={idx}>
                  <Typography variant="body2" sx={{ mb: 0.5 }}>
                    {example.sentence}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {example.translation}
                  </Typography>
                </ExampleCard>
              ))}
            </Box>
          )}

        </ExpandedContent>
      </Collapse>
    </RowContainer>
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
