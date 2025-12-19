/**
 * WordRow Component
 *
 * Smooth, polished word row with MUI-based expand/collapse animations.
 * Fetches translation and sentence examples BEFORE expanding to prevent flicker.
 */

import { memo, useCallback, useRef, useState } from 'react';
import {
  Box,
  Collapse,
  IconButton,
  Typography,
  Chip,
  alpha,
  styled,
  CircularProgress
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

const RowWrapper = styled(Box)(({ theme }) => ({
  borderBottom: `1px solid ${theme.palette.wordRow.panelBorder}`,
}));

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

const DropdownPanel = styled(Box)(({ theme }) => ({
  backgroundColor: theme.palette.wordRow.panelBg,
  borderTop: `1px solid ${theme.palette.wordRow.panelBorder}`,
  padding: '16px 20px 20px 56px',
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
  [theme.breakpoints.down('sm')]: {
    fontSize: '0.9rem',
  },
}));

const ExpandIcon = styled(ExpandMore, {
  shouldForwardProp: (prop) => prop !== 'isExpanded' && prop !== 'isLoading'
})<{ isExpanded?: boolean; isLoading?: boolean }>(({ isExpanded, isLoading }) => ({
  transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
  transition: 'transform 0.3s ease',
  opacity: isLoading ? 0 : 0.5,
}));

const ActionButton = styled(IconButton)(({ theme }) => ({
  padding: 6,
  '&:hover': {
    backgroundColor: alpha(theme.palette.primary.main, 0.1),
  },
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
  [theme.breakpoints.down('sm')]: {
    padding: '10px 12px',
    marginTop: 10,
  },
}));

const IdiomCard = styled(Box)(({ theme }) => ({
  backgroundColor: theme.palette.mode === 'light'
    ? alpha(theme.palette.warning.light, 0.15)
    : alpha(theme.palette.warning.dark, 0.18),
  borderRadius: theme.shape.borderRadius,
  padding: '12px 14px',
  marginTop: 12,
  borderLeft: `3px solid ${theme.palette.warning.main}`,
  [theme.breakpoints.down('sm')]: {
    padding: '10px 12px',
    marginTop: 10,
  },
}));

// Small spinner shown next to expand icon while loading
const InlineSpinner = styled(CircularProgress)(() => ({
  position: 'absolute',
  right: 100,
}));

// ============================================================================
// TYPES
// ============================================================================

interface SentenceExample {
  sentence: string;
  translation: string;
  word_position: number;
}

interface ContentData {
  translation: string | null;
  translationProvider: string | null;
  sentenceExamples: SentenceExample[];
  relatedIdioms: IdiomInfo[];
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
  isExpanded: boolean;
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
  isExpanded,
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
  const contentRef = useRef<HTMLDivElement>(null);

  // Content is fetched ONCE and cached
  const [contentData, setContentData] = useState<ContentData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const fetchedRef = useRef(false);

  // Fetch all content data
  const fetchContent = useCallback(async (): Promise<ContentData> => {
    const results: ContentData = {
      translation: word.translation || null,
      translationProvider: word.translationProvider || null,
      sentenceExamples: [],
      relatedIdioms: [],
    };

    // Fetch all data in parallel
    const promises: Promise<void>[] = [];

    // Translation
    if (!results.translation) {
      promises.push(
        onTranslate(word.word)
          .then((result) => {
            if (result) {
              results.translation = result.translation;
              results.translationProvider = result.provider || null;
            }
          })
          .catch((err) => console.error('Translation error:', err))
      );
    }

    // Sentence examples
    if (movieId && targetLang) {
      promises.push(
        fetch(`/api/enrichment/movies/${movieId}/examples/${encodeURIComponent(word.word)}?lang=${targetLang}`)
          .then((res) => res.json())
          .then((data) => {
            if (data.examples && Array.isArray(data.examples)) {
              results.sentenceExamples = data.examples;
            }
          })
          .catch((err) => console.error('Sentence examples error:', err))
      );
    }

    // Related idioms
    if (getIdiomsForWord && !idiomMetadata) {
      promises.push(
        getIdiomsForWord(word.word)
          .then((idioms) => {
            if (idioms && idioms.length > 0) {
              results.relatedIdioms = idioms;
            }
          })
          .catch((err) => console.error('Idioms error:', err))
      );
    }

    await Promise.all(promises);
    return results;
  }, [word.word, word.translation, word.translationProvider, onTranslate, movieId, targetLang, getIdiomsForWord, idiomMetadata]);

  const handleClick = useCallback(async (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.action-button')) {
      return;
    }

    // If closing, just close immediately
    if (isExpanded) {
      onExpandChange(virtualIndex, false);
      return;
    }

    // If we already have content, expand immediately
    if (contentData || fetchedRef.current) {
      onExpandChange(virtualIndex, true);
      return;
    }

    // First time opening: fetch content first, then expand
    setIsLoading(true);
    fetchedRef.current = true;

    try {
      const data = await fetchContent();
      setContentData(data);
      // Small delay to ensure state is updated before expand
      requestAnimationFrame(() => {
        onExpandChange(virtualIndex, true);
        setIsLoading(false);
      });
    } catch (err) {
      console.error('Failed to fetch content:', err);
      setIsLoading(false);
      // Still expand even if fetch failed
      onExpandChange(virtualIndex, true);
    }
  }, [isExpanded, contentData, virtualIndex, onExpandChange, fetchContent]);

  const handleSave = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSave(word.word);
  }, [onSave, word.word]);

  const handleToggleLearned = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleLearned(word.word);
  }, [onToggleLearned, word.word]);

  const handleCollapseEntered = useCallback(() => {
    onContentLoad?.(virtualIndex);
  }, [onContentLoad, virtualIndex]);

  const handleCollapseExited = useCallback(() => {
    onContentLoad?.(virtualIndex);
  }, [onContentLoad, virtualIndex]);

  // Use cached content or fall back to word data
  const translation = contentData?.translation ?? word.translation ?? null;
  const translationProvider = contentData?.translationProvider ?? word.translationProvider ?? null;
  const sentenceExamples = contentData?.sentenceExamples ?? [];
  const relatedIdioms = contentData?.relatedIdioms ?? [];

  const isUntranslatable = translation && translation.toLowerCase() === word.word.toLowerCase();

  const highlightWord = (sentence: string, targetWord: string) => {
    const targetLower = targetWord.toLowerCase();
    const regex = new RegExp(`\\b(${targetLower})\\b`, 'gi');
    const parts = sentence.toLowerCase().split(regex);

    return parts.map((part, i) => {
      if (part === targetLower) {
        return (
          <Typography
            key={i}
            component="span"
            sx={{ fontWeight: 600, color: 'primary.main' }}
          >
            {part}
          </Typography>
        );
      }
      return part;
    });
  };

  return (
    <RowWrapper>
      <RowContainer
        isExpanded={isExpanded}
        groupColor={groupColor}
        onClick={handleClick}
      >
        <MainRow>
          <RowNumber>{rowNumber}.</RowNumber>
          <WordText>{word.word}</WordText>

          {idiomMetadata && (
            <>
              <Chip
                label={idiomMetadata.type === 'phrasal_verb' ? 'phrasal verb' : 'idiom'}
                size="small"
                sx={{
                  height: 20,
                  fontSize: '0.7rem',
                  bgcolor: idiomMetadata.type === 'phrasal_verb' ? 'info.main' : 'warning.main',
                  color: 'white',
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

          {isLoading ? (
            <InlineSpinner size={16} />
          ) : null}

          <ExpandIcon isExpanded={isExpanded} isLoading={isLoading} fontSize="small" />

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

      <Collapse
        in={isExpanded}
        timeout={200}
        onEntered={handleCollapseEntered}
        onExited={handleCollapseExited}
        unmountOnExit
      >
        <DropdownPanel ref={contentRef}>
          {/* Translation */}
          <TranslationBox>
            <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 300 }}>
              —
            </Typography>
            {translation ? (
              <>
                <Typography
                  variant="body2"
                  sx={{
                    color: isUntranslatable ? 'text.disabled' : 'text.primary',
                    fontStyle: isUntranslatable ? 'italic' : 'normal'
                  }}
                >
                  {isUntranslatable ? '(same as source)' : translation}
                </Typography>
                {translationProvider && (
                  <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '0.65rem' }}>
                    via {translationProvider}
                  </Typography>
                )}
              </>
            ) : (
              <Typography variant="body2" color="text.disabled">
                No translation available
              </Typography>
            )}
          </TranslationBox>

          {/* Sentence Examples */}
          {sentenceExamples.length > 0 ? (
            sentenceExamples.map((example, idx) => (
              <ExampleCard key={idx}>
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  {highlightWord(example.sentence, word.word)}
                </Typography>
                {example.translation && (
                  <Typography variant="caption" color="text.secondary">
                    {example.translation}
                  </Typography>
                )}
              </ExampleCard>
            ))
          ) : contentData && movieId && (
            <Typography variant="caption" color="text.disabled" sx={{ mt: 1, display: 'block' }}>
              No sentence examples available
            </Typography>
          )}

          {/* Related Idioms */}
          {relatedIdioms.length > 0 && (
            <>
              <Typography
                variant="caption"
                sx={{ mt: 2, mb: 1, display: 'block', color: 'text.secondary', fontWeight: 500 }}
              >
                Related expressions:
              </Typography>
              {relatedIdioms.map((idiom, idx) => (
                <IdiomCard key={idx}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {idiom.phrase}
                    </Typography>
                    <Chip
                      label={idiom.type === 'phrasal_verb' ? 'phrasal verb' : 'idiom'}
                      size="small"
                      sx={{
                        height: 18,
                        fontSize: '0.65rem',
                        bgcolor: idiom.type === 'phrasal_verb' ? 'info.main' : 'warning.main',
                        color: 'white',
                      }}
                    />
                    <Chip
                      label={idiom.cefr_level}
                      size="small"
                      sx={{
                        height: 18,
                        fontSize: '0.65rem',
                        bgcolor: groupColor,
                        color: 'white',
                      }}
                    />
                  </Box>
                </IdiomCard>
              ))}
            </>
          )}

          {/* Idiom metadata (for idioms tab items) */}
          {idiomMetadata && (
            <IdiomCard>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {idiomMetadata.phrase}
              </Typography>
            </IdiomCard>
          )}
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
    prevProps.isExpanded === nextProps.isExpanded &&
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
