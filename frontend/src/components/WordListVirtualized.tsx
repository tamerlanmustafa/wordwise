import { memo, useMemo, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  List,
  ListItem,
  Chip,
  Alert,
  Button,
  CircularProgress
} from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import { Link } from 'react-router-dom';
import { List as VirtualList } from 'react-window';
import { WordItem } from './WordItem';
import type { WordFrequency } from '../types/script';
import type { TranslatedWord } from '../hooks/useInfiniteWordFeed';

interface WordListVirtualizedProps {
  // Active group data
  groupLevel: string;
  groupDescription: string;
  groupColor: string;
  totalWordCount: number;

  // Visible words and translations
  visibleWords: WordFrequency[];
  translations: Map<string, TranslatedWord>;

  // Loading states
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;

  // Preview mode
  isPreview: boolean;

  // Word actions
  isWordSavedInMovie: (word: string, movieId?: number) => boolean;
  saveWord: (word: string, movieId?: number) => void;
  toggleLearned: (word: string) => void;
  learnedWords: Set<string>;
  savedWords: Set<string>;

  // Other movies data
  otherMovies: Record<string, Array<{ movie_id: number; title: string }>>;
  movieId?: number;

  // Sentinel ref for infinite scroll
  sentinelRef: (node: HTMLDivElement | null) => void;

  // Ref for scroll position tracking
  listContainerRef: React.RefObject<HTMLDivElement | null>;
}

// Memoized WordListVirtualized - should NOT re-render when activeTab changes
export const WordListVirtualized = memo<WordListVirtualizedProps>(({
  groupLevel,
  groupDescription,
  groupColor,
  totalWordCount,
  visibleWords,
  translations,
  isLoadingMore,
  hasMore,
  error,
  isPreview,
  isWordSavedInMovie,
  saveWord,
  toggleLearned,
  learnedWords,
  savedWords,
  otherMovies,
  movieId,
  sentinelRef,
  listContainerRef
}) => {
  // Memoize word list height calculation - fixed height for stability
  const listHeight = useMemo(() => 600, []);

  // Memoize rowProps to prevent breaking VirtualList memoization
  const rowProps = useMemo(() => ({
    visibleWords,
    translations,
    groupColor,
    isWordSavedInMovie,
    learnedWords,
    savedWords,
    saveWord,
    toggleLearned,
    otherMovies,
    movieId
  }), [
    visibleWords,
    translations,
    groupColor,
    isWordSavedInMovie,
    learnedWords,
    savedWords,
    saveWord,
    toggleLearned,
    otherMovies,
    movieId
  ]);

  // Memoize row component to prevent recreation on every render
  const WordRow = useCallback(({ index, style, visibleWords, translations, groupColor, isWordSavedInMovie, learnedWords, savedWords, saveWord, toggleLearned, otherMovies, movieId }: any) => {
    const wordFreq = visibleWords[index];
    const translation = translations.get(wordFreq.word.toLowerCase());

    if (!translation) {
      // Return empty div instead of null to satisfy react-window type requirements
      return <div style={style} />;
    }

    return (
      <div style={style}>
        <WordItem
          wordFreq={wordFreq}
          translation={translation}
          groupColor={groupColor}
          isWordSavedInMovie={isWordSavedInMovie}
          learnedWords={learnedWords}
          savedWords={savedWords}
          saveWord={saveWord}
          toggleLearned={toggleLearned}
          otherMovies={otherMovies[wordFreq.word.toLowerCase()]}
          movieId={movieId}
          showDivider={index < visibleWords.length - 1}
        />
      </div>
    );
  }, []);

  return (
    <Box ref={listContainerRef} sx={{
      // Fixed height to prevent layout shift
      minHeight: '600px',
      // Prevent layout thrashing
      contain: 'layout style'
    }}>
      {/* Preview Mode CTA */}
      {isPreview && (
        <Alert
          severity="info"
          icon={<LockIcon />}
          sx={{ mb: 3 }}
          action={
            <Button
              component={Link}
              to="/signup"
              variant="contained"
              size="small"
            >
              Sign Up
            </Button>
          }
        >
          <Typography variant="body2" fontWeight="medium">
            Sign in to unlock the full vocabulary list with translations
          </Typography>
        </Alert>
      )}

      {/* Header - memoized to prevent recalculation */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h5" fontWeight={700} sx={{ color: groupColor }}>
            {groupLevel} Level
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {groupDescription}
          </Typography>
        </Box>
        <Chip
          label={
            isPreview
              ? `3 sample words`
              : `${totalWordCount} words`
          }
          sx={{
            bgcolor: `${groupColor}15`,
            color: groupColor,
            fontWeight: 600
          }}
        />
      </Stack>

      {/* Error State */}
      {error && (
        <Paper sx={{ p: 2, mb: 3, bgcolor: 'error.light' }}>
          <Typography color="error.dark">{error}</Typography>
        </Paper>
      )}

      {/* Virtualized Word List */}
      <Paper elevation={1} sx={{
        borderRadius: 2,
        overflow: 'hidden',
        mb: 3,
        // Prevent layout thrashing
        contain: 'layout style paint'
      }}>
        {visibleWords.length === 0 && !isLoadingMore ? (
          <List sx={{ py: 0 }}>
            <ListItem>
              <Typography variant="body2" color="text.secondary">
                {isPreview ? 'Sign in to view vocabulary' : 'No words in this level'}
              </Typography>
            </ListItem>
          </List>
        ) : isPreview ? (
          /* Preview mode - show first 3 words without virtualization */
          <List sx={{ py: 0 }}>
            {visibleWords.slice(0, 3).map((wordFreq, index) => (
              <ListItem
                key={`${wordFreq.lemma}-${index}`}
                sx={{
                  py: 2,
                  px: 3,
                  bgcolor: 'action.hover'
                }}
              >
                <Typography
                  variant="body1"
                  sx={{
                    fontWeight: 500,
                    color: 'text.primary'
                  }}
                >
                  {wordFreq.word.toLowerCase()}
                </Typography>
              </ListItem>
            ))}
          </List>
        ) : (
          /* Virtualized list for performance */
          <VirtualList
            defaultHeight={listHeight}
            rowCount={visibleWords.length}
            rowHeight={80}
            overscanCount={3}
            rowProps={rowProps}
            rowComponent={WordRow}
          />
        )}

        {/* Loading Indicator */}
        {isLoadingMore && !isPreview && (
          <Box sx={{ py: 3, display: 'flex', justifyContent: 'center' }}>
            <Stack spacing={2} alignItems="center">
              <CircularProgress size={32} sx={{ color: groupColor }} />
              <Typography variant="body2" color="text.secondary">
                Loading more words...
              </Typography>
            </Stack>
          </Box>
        )}
      </Paper>

      {/* Sentinel div for IntersectionObserver */}
      {!isPreview && hasMore && (
        <Box
          ref={sentinelRef}
          sx={{
            height: 20,
            width: '100%',
            visibility: 'hidden'
          }}
        />
      )}
    </Box>
  );
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render if word data or loading state changes
  // activeTab changes should NOT trigger re-render
  return (
    prevProps.groupLevel === nextProps.groupLevel &&
    prevProps.groupColor === nextProps.groupColor &&
    prevProps.visibleWords === nextProps.visibleWords &&
    prevProps.translations === nextProps.translations &&
    prevProps.isLoadingMore === nextProps.isLoadingMore &&
    prevProps.hasMore === nextProps.hasMore &&
    prevProps.error === nextProps.error &&
    prevProps.learnedWords === nextProps.learnedWords &&
    prevProps.savedWords === nextProps.savedWords
  );
});

WordListVirtualized.displayName = 'WordListVirtualized';
