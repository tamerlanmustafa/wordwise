import { useState, useEffect } from 'react';
import {
  Box,
  Chip,
  IconButton,
  Typography,
  Stack,
  useTheme,
  useMediaQuery
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import type { WordFrequency } from '../types/script';

interface WordCarouselProps {
  words: WordFrequency[];
  levelColor: string;
  wordsPerPage?: number;
}

export default function WordCarousel({ words, levelColor, wordsPerPage = 30 }: WordCarouselProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const [visibleWords, setVisibleWords] = useState<WordFrequency[]>([]);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const effectiveWordsPerPage = isMobile ? 15 : wordsPerPage;
  const totalPages = Math.ceil(words.length / effectiveWordsPerPage);

  // Lazy load words for current page
  useEffect(() => {
    const start = currentPage * effectiveWordsPerPage;
    const end = start + effectiveWordsPerPage;
    setVisibleWords(words.slice(start, end));
  }, [currentPage, words, effectiveWordsPerPage]);

  const handlePrevious = () => {
    setCurrentPage((prev) => Math.max(0, prev - 1));
  };

  const handleNext = () => {
    setCurrentPage((prev) => Math.min(totalPages - 1, prev + 1));
  };

  const canGoPrevious = currentPage > 0;
  const canGoNext = currentPage < totalPages - 1;

  if (words.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
        No words in this category
      </Typography>
    );
  }

  return (
    <Box>
      {/* Navigation Header */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <IconButton
          onClick={handlePrevious}
          disabled={!canGoPrevious}
          size="small"
          sx={{
            color: levelColor,
            '&:disabled': { opacity: 0.3 }
          }}
        >
          <ChevronLeftIcon />
        </IconButton>

        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'medium' }}>
          Page {currentPage + 1} of {totalPages} ({words.length} total words)
        </Typography>

        <IconButton
          onClick={handleNext}
          disabled={!canGoNext}
          size="small"
          sx={{
            color: levelColor,
            '&:disabled': { opacity: 0.3 }
          }}
        >
          <ChevronRightIcon />
        </IconButton>
      </Stack>

      {/* Word Chips Grid */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'repeat(auto-fill, minmax(80px, 1fr))',
            sm: 'repeat(auto-fill, minmax(100px, 1fr))',
            md: 'repeat(auto-fill, minmax(110px, 1fr))'
          },
          gap: 1,
          minHeight: '120px' // Prevent layout shift during loading
        }}
      >
        {visibleWords.map((wordFreq, index) => (
          <Chip
            key={`${wordFreq.lemma}-${index}`}
            label={wordFreq.word}
            size="small"
            variant="outlined"
            sx={{
              borderColor: levelColor,
              justifyContent: 'flex-start',
              '&:hover': {
                backgroundColor: `${levelColor}15`,
                borderWidth: 2,
              },
            }}
          />
        ))}
      </Box>

      {/* Navigation Footer (for mobile) */}
      {isMobile && (
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="center"
          spacing={1}
          sx={{ mt: 2 }}
        >
          <IconButton
            onClick={handlePrevious}
            disabled={!canGoPrevious}
            size="small"
            sx={{ color: levelColor }}
          >
            <ChevronLeftIcon />
          </IconButton>
          <Typography variant="caption" color="text.secondary">
            {currentPage + 1}/{totalPages}
          </Typography>
          <IconButton
            onClick={handleNext}
            disabled={!canGoNext}
            size="small"
            sx={{ color: levelColor }}
          >
            <ChevronRightIcon />
          </IconButton>
        </Stack>
      )}
    </Box>
  );
}
