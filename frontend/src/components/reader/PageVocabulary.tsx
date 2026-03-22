import { useState, useEffect, memo } from 'react';
import {
  Box,
  Typography,
  Chip,
  CircularProgress,
  Alert,
  Collapse,
  IconButton,
  Button
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import AutoStoriesIcon from '@mui/icons-material/AutoStories';
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

interface Word {
  word: string;
  lemma: string;
  cefr_level: string;
  confidence: number;
  frequency_rank?: number;
}

interface PageVocabularyProps {
  bookId: number | null;
  currentPage: number;
  totalPages: number;
  onWordClick?: (word: string) => void;
}

const LEVEL_COLORS: Record<string, string> = {
  A1: '#22c55e',
  A2: '#84cc16',
  B1: '#eab308',
  B2: '#f97316',
  C1: '#ef4444',
  C2: '#a855f7'
};

interface LevelGroup {
  level: string;
  words: Word[];
  expanded: boolean;
}

function PageVocabularyBase({
  bookId,
  currentPage,
  totalPages,
  onWordClick
}: PageVocabularyProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [levelGroups, setLevelGroups] = useState<LevelGroup[]>([]);
  const [totalWords, setTotalWords] = useState(0);

  useEffect(() => {
    if (!bookId || currentPage < 1) return;

    const fetchVocabulary = async () => {
      setLoading(true);
      setError(null);

      try {
        const token = localStorage.getItem('wordwise_token');
        const response = await axios.get(
          `${API_BASE_URL}/api/books/${bookId}/vocabulary/pages`,
          {
            params: { start_page: currentPage, end_page: currentPage },
            headers: token ? { Authorization: `Bearer ${token}` } : {}
          }
        );

        const data = response.data;
        const groups: Record<string, Word[]> = {};
        const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

        levels.forEach(level => { groups[level] = []; });

        if (data.words_by_level) {
          Object.entries(data.words_by_level).forEach(([level, words]) => {
            if (groups[level]) {
              groups[level] = (words as Word[]).slice(0, 15);
            }
          });
        }

        const newGroups: LevelGroup[] = levels
          .map(level => ({
            level,
            words: groups[level] || [],
            expanded: groups[level]?.length > 0 && ['B1', 'B2', 'C1'].includes(level)
          }))
          .filter(g => g.words.length > 0);

        setLevelGroups(newGroups);
        setTotalWords(data.words_in_range || 0);
      } catch (err) {
        console.error('Failed to fetch page vocabulary:', err);
        if (axios.isAxiosError(err) && err.response?.status === 404) {
          setError('No vocabulary data for this page');
        } else {
          setError('Failed to load vocabulary');
        }
        setLevelGroups([]);
      } finally {
        setLoading(false);
      }
    };

    fetchVocabulary();
  }, [bookId, currentPage]);

  const toggleLevel = (level: string) => {
    setLevelGroups(prev =>
      prev.map(g => g.level === level ? { ...g, expanded: !g.expanded } : g)
    );
  };

  // Not analyzed state
  if (!bookId) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <AutoStoriesIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Analyze this book to see vocabulary for each page.
        </Typography>
        <Button variant="outlined" size="small" href={`/book/${bookId}`}>
          Go to Analysis
        </Button>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="info" sx={{ m: 2, fontSize: '0.85rem' }}>
        {error}
      </Alert>
    );
  }

  if (levelGroups.length === 0) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          No vocabulary for this page
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Box
        sx={{
          px: 2,
          py: 1.5,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'grey.50'
        }}
      >
        <Typography variant="subtitle2" fontWeight={600}>
          Page {currentPage} of {totalPages}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {totalWords} words to learn
        </Typography>
      </Box>

      {/* Word Groups */}
      <Box sx={{ flex: 1, overflow: 'auto', py: 1 }}>
        {levelGroups.map((group) => (
          <Box key={group.level} sx={{ mb: 0.5 }}>
            {/* Level Header */}
            <Box
              onClick={() => toggleLevel(group.level)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                px: 2,
                py: 1,
                cursor: 'pointer',
                '&:hover': { bgcolor: 'action.hover' }
              }}
            >
              <Chip
                label={group.level}
                size="small"
                sx={{
                  bgcolor: LEVEL_COLORS[group.level],
                  color: 'white',
                  fontWeight: 700,
                  fontSize: '0.7rem',
                  height: 22,
                  mr: 1.5
                }}
              />
              <Typography variant="body2" sx={{ flex: 1 }}>
                {group.words.length} words
              </Typography>
              <IconButton size="small" sx={{ p: 0.25 }}>
                {group.expanded ? (
                  <ExpandLessIcon fontSize="small" />
                ) : (
                  <ExpandMoreIcon fontSize="small" />
                )}
              </IconButton>
            </Box>

            {/* Words */}
            <Collapse in={group.expanded}>
              <Box sx={{ px: 2, pb: 1, display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {group.words.map((word, i) => (
                  <Chip
                    key={`${word.word}-${i}`}
                    label={word.word}
                    size="small"
                    variant="outlined"
                    onClick={() => onWordClick?.(word.word)}
                    sx={{
                      fontSize: '0.75rem',
                      height: 26,
                      cursor: onWordClick ? 'pointer' : 'default',
                      borderColor: 'divider',
                      '&:hover': onWordClick ? {
                        bgcolor: 'action.hover',
                        borderColor: LEVEL_COLORS[group.level]
                      } : {}
                    }}
                  />
                ))}
              </Box>
            </Collapse>
          </Box>
        ))}
      </Box>

      {/* Footer tip */}
      <Box sx={{ px: 2, py: 1.5, borderTop: 1, borderColor: 'divider', bgcolor: 'grey.50' }}>
        <Typography variant="caption" color="text.secondary">
          Review these words before reading to improve comprehension.
        </Typography>
      </Box>
    </Box>
  );
}

export default memo(PageVocabularyBase);
