import { memo } from 'react';
import {
  Box,
  Typography,
  Stack,
  Chip,
  Divider,
  IconButton,
  Tooltip,
  Fade
} from '@mui/material';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import type { WordFrequency } from '../types/script';
import type { TranslatedWord } from '../hooks/useInfiniteWordFeed';

interface WordItemProps {
  wordFreq: WordFrequency;
  translation: TranslatedWord;
  groupColor: string;
  isWordSavedInMovie: (word: string, movieId?: number) => boolean;
  learnedWords: Set<string>;
  savedWords: Set<string>;
  saveWord: (word: string, movieId?: number) => void;
  toggleLearned: (word: string) => void;
  otherMovies: Array<{ movie_id: number; title: string }> | undefined;
  movieId?: number;
  showDivider: boolean;
}

// Memoized component - only re-renders if props actually change
export const WordItem = memo<WordItemProps>(({
  wordFreq,
  translation,
  groupColor,
  isWordSavedInMovie,
  learnedWords,
  savedWords,
  saveWord,
  toggleLearned,
  otherMovies,
  movieId,
  showDivider
}) => {
  const wordLower = wordFreq.word.toLowerCase();
  const isSaved = isWordSavedInMovie(wordLower, movieId);
  const isLearned = learnedWords.has(wordLower);
  const canToggleLearned = savedWords.has(wordLower);

  return (
    <>
      <Box
        sx={{
          py: 2,
          px: 3,
          '&:hover': {
            bgcolor: `${groupColor}08`
          }
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          spacing={2}
          sx={{ width: '100%' }}
        >
          {/* Word and Translation */}
          <Box sx={{ flexGrow: 1 }}>
            <Typography
              variant="body1"
              sx={{
                fontWeight: 500,
                color: 'text.primary'
              }}
            >
              {wordLower}
              <Typography
                component="span"
                variant="body1"
                sx={{
                  mx: 2,
                  color: 'text.disabled',
                  fontWeight: 300
                }}
              >
                —
              </Typography>
              <Typography
                component="span"
                variant="body1"
                sx={{
                  color: groupColor,
                  fontWeight: 500
                }}
              >
                {translation.translation}
              </Typography>
            </Typography>

            {/* Metadata */}
            <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
              {wordFreq.confidence && (
                <Chip
                  label={`${Math.round(wordFreq.confidence * 100)}% confidence`}
                  size="small"
                  sx={{
                    height: 20,
                    fontSize: '0.7rem',
                    bgcolor: 'action.hover'
                  }}
                />
              )}
              {translation.cached && (
                <Chip
                  label="cached"
                  size="small"
                  sx={{
                    height: 20,
                    fontSize: '0.7rem',
                    bgcolor: 'action.hover'
                  }}
                />
              )}
              {translation.provider && (
                <Chip
                  label={translation.provider}
                  size="small"
                  sx={{
                    height: 20,
                    fontSize: '0.7rem',
                    bgcolor: translation.provider === 'google' ? '#4285f420' : '#0A84FF20',
                    color: translation.provider === 'google' ? '#4285f4' : '#0A84FF'
                  }}
                />
              )}
            </Stack>
          </Box>

          {/* Action Buttons */}
          <Stack direction="row" spacing={0.5}>
            <Tooltip
              title={
                otherMovies && otherMovies.length > 0
                  ? `You might have seen this word in: ${otherMovies.map(m => m.title).join(', ')}`
                  : ''
              }
              placement="top"
              TransitionComponent={Fade}
              TransitionProps={{ timeout: 300 }}
              arrow
              disableHoverListener={!otherMovies || otherMovies.length === 0}
            >
              <IconButton
                size="small"
                onClick={() => saveWord(wordLower, movieId)}
                sx={{ color: isSaved ? 'warning.main' : 'text.secondary' }}
              >
                {isSaved ? <BookmarkIcon /> : <BookmarkBorderIcon />}
              </IconButton>
            </Tooltip>
            <IconButton
              size="small"
              onClick={() => toggleLearned(wordLower)}
              disabled={!canToggleLearned}
              sx={{ color: isLearned ? 'success.main' : 'text.secondary' }}
            >
              {isLearned ? <CheckCircleIcon /> : <CheckCircleOutlineIcon />}
            </IconButton>
          </Stack>
        </Stack>
      </Box>
      {showDivider && <Divider />}
    </>
  );
}, (prevProps, nextProps) => {
  // Custom comparison function for better memoization
  return (
    prevProps.wordFreq.word === nextProps.wordFreq.word &&
    prevProps.translation.translation === nextProps.translation.translation &&
    prevProps.groupColor === nextProps.groupColor &&
    prevProps.showDivider === nextProps.showDivider &&
    prevProps.isWordSavedInMovie(prevProps.wordFreq.word.toLowerCase(), prevProps.movieId) ===
      nextProps.isWordSavedInMovie(nextProps.wordFreq.word.toLowerCase(), nextProps.movieId) &&
    prevProps.learnedWords.has(prevProps.wordFreq.word.toLowerCase()) ===
      nextProps.learnedWords.has(nextProps.wordFreq.word.toLowerCase())
  );
});

WordItem.displayName = 'WordItem';
