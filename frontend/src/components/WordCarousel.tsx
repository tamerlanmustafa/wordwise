import { useState, useEffect } from 'react';
import {
  Box,
  IconButton,
  Typography,
  Stack,
  useTheme,
  useMediaQuery,
  ToggleButtonGroup,
  ToggleButton
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import GridViewIcon from '@mui/icons-material/GridView';
import ViewAgendaIcon from '@mui/icons-material/ViewAgenda';
import type { WordFrequency } from '../types/script';
import WordCard from './WordCard';
import TranslationModal from './TranslationModal';

interface WordCarouselProps {
  words: WordFrequency[];
  levelColor: string;
  wordsPerPage?: number;
  targetLang?: string;
}

type ViewMode = 'grid' | 'cards';

export default function WordCarousel({
  words,
  levelColor,
  wordsPerPage = 30,
  targetLang = 'ES'
}: WordCarouselProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const [visibleWords, setVisibleWords] = useState<WordFrequency[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [selectedWord, setSelectedWord] = useState<WordFrequency | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isTablet = useMediaQuery(theme.breakpoints.down('md'));

  // Adjust words per page based on view mode and screen size
  const effectiveWordsPerPage = viewMode === 'grid'
    ? (isMobile ? 15 : wordsPerPage)
    : (isMobile ? 5 : isTablet ? 10 : 15);

  const totalPages = Math.ceil(words.length / effectiveWordsPerPage);

  // Lazy load words for current page
  useEffect(() => {
    const start = currentPage * effectiveWordsPerPage;
    const end = start + effectiveWordsPerPage;
    setVisibleWords(words.slice(start, end));
  }, [currentPage, words, effectiveWordsPerPage]);

  // Reset page when view mode changes
  useEffect(() => {
    setCurrentPage(0);
  }, [viewMode]);

  const handlePrevious = () => {
    setCurrentPage((prev) => Math.max(0, prev - 1));
  };

  const handleNext = () => {
    setCurrentPage((prev) => Math.min(totalPages - 1, prev + 1));
  };

  const handleOpenDetails = (word: WordFrequency) => {
    setSelectedWord(word);
    setModalOpen(true);
  };

  const handleToggleSaved = (word: WordFrequency) => {
    setSavedWords(prev => {
      const next = new Set(prev);
      if (next.has(word.lemma)) {
        next.delete(word.lemma);
      } else {
        next.add(word.lemma);
      }
      return next;
    });
  };

  const handleViewModeChange = (_: React.MouseEvent<HTMLElement>, newMode: ViewMode | null) => {
    if (newMode !== null) {
      setViewMode(newMode);
    }
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
        <Stack direction="row" alignItems="center" spacing={1}>
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

          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'medium', minWidth: 120 }}>
            Page {currentPage + 1} of {totalPages}
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

        {!isMobile && (
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="caption" color="text.secondary">
              {words.length} words
            </Typography>

            <ToggleButtonGroup
              value={viewMode}
              exclusive
              onChange={handleViewModeChange}
              size="small"
              sx={{ ml: 2 }}
            >
              <ToggleButton value="grid" aria-label="grid view">
                <GridViewIcon fontSize="small" />
              </ToggleButton>
              <ToggleButton value="cards" aria-label="card view">
                <ViewAgendaIcon fontSize="small" />
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        )}
      </Stack>

      {/* Words Display */}
      {viewMode === 'grid' ? (
        // Compact grid view (original chips-like display)
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'repeat(auto-fill, minmax(100px, 1fr))',
              sm: 'repeat(auto-fill, minmax(120px, 1fr))',
              md: 'repeat(auto-fill, minmax(140px, 1fr))'
            },
            gap: 1.5,
            minHeight: '150px'
          }}
        >
          {visibleWords.map((wordFreq, index) => (
            <WordCard
              key={`${wordFreq.lemma}-${index}`}
              word={wordFreq}
              levelColor={levelColor}
              targetLang={targetLang}
              onOpenDetails={handleOpenDetails}
              onToggleSaved={handleToggleSaved}
              isSaved={savedWords.has(wordFreq.lemma)}
              variant="compact"
            />
          ))}
        </Box>
      ) : (
        // Full card view with more details
        <Stack spacing={1.5}>
          {visibleWords.map((wordFreq, index) => (
            <WordCard
              key={`${wordFreq.lemma}-${index}`}
              word={wordFreq}
              levelColor={levelColor}
              targetLang={targetLang}
              onOpenDetails={handleOpenDetails}
              onToggleSaved={handleToggleSaved}
              isSaved={savedWords.has(wordFreq.lemma)}
              variant="full"
            />
          ))}
        </Stack>
      )}

      {/* Navigation Footer (for mobile) */}
      {isMobile && (
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="center"
          spacing={2}
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

          <Typography variant="caption" color="text.secondary" fontWeight="medium">
            {currentPage + 1} / {totalPages}
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

      {/* Translation Detail Modal */}
      <TranslationModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        word={selectedWord}
        levelColor={levelColor}
        targetLang={targetLang}
      />
    </Box>
  );
}
