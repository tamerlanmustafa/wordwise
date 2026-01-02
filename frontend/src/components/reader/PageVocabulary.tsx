import { useState, useEffect, memo } from 'react';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  Chip,
  CircularProgress,
  Alert,
  Collapse,
  IconButton,
  Divider,
  Paper
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import SchoolIcon from '@mui/icons-material/School';
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
  bookId: number;
  currentPage: number;
  totalPages: number;
  onWordClick?: (word: string) => void;
}

const LEVEL_COLORS: Record<string, string> = {
  A1: '#4caf50',
  A2: '#8bc34a',
  B1: '#ffc107',
  B2: '#ff9800',
  C1: '#f44336',
  C2: '#9c27b0'
};

const LEVEL_LABELS: Record<string, string> = {
  A1: 'Beginner',
  A2: 'Elementary',
  B1: 'Intermediate',
  B2: 'Upper Intermediate',
  C1: 'Advanced',
  C2: 'Proficient'
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

  // Fetch vocabulary for current page
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
            params: {
              start_page: currentPage,
              end_page: currentPage
            },
            headers: token ? { Authorization: `Bearer ${token}` } : {}
          }
        );

        const data = response.data;

        // Group words by CEFR level
        const groups: Record<string, Word[]> = {};
        const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

        levels.forEach(level => {
          groups[level] = [];
        });

        // Process words from response
        if (data.words_by_level) {
          Object.entries(data.words_by_level).forEach(([level, words]) => {
            if (groups[level]) {
              groups[level] = (words as Word[]).slice(0, 20); // Limit to 20 words per level
            }
          });
        }

        // Create level groups with expansion state
        const newGroups: LevelGroup[] = levels
          .map(level => ({
            level,
            words: groups[level] || [],
            expanded: groups[level]?.length > 0 && (level === 'B1' || level === 'B2' || level === 'C1')
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
      prev.map(g =>
        g.level === level ? { ...g, expanded: !g.expanded } : g
      )
    );
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="info" sx={{ m: 2 }}>
        {error}
      </Alert>
    );
  }

  if (levelGroups.length === 0) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <SchoolIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
        <Typography color="text.secondary">
          No vocabulary data for this page
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100%', overflow: 'auto' }}>
      {/* Header */}
      <Paper elevation={0} sx={{ p: 2, bgcolor: 'primary.main', color: 'primary.contrastText' }}>
        <Typography variant="subtitle1" fontWeight="bold">
          Page {currentPage} of {totalPages}
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.9 }}>
          {totalWords} words to learn
        </Typography>
      </Paper>

      {/* Level Groups */}
      <List disablePadding>
        {levelGroups.map((group, index) => (
          <Box key={group.level}>
            {index > 0 && <Divider />}

            {/* Level Header */}
            <ListItem
              component="div"
              onClick={() => toggleLevel(group.level)}
              sx={{
                cursor: 'pointer',
                bgcolor: 'background.paper',
                '&:hover': { bgcolor: 'action.hover' }
              }}
            >
              <Chip
                label={group.level}
                size="small"
                sx={{
                  bgcolor: LEVEL_COLORS[group.level],
                  color: 'white',
                  fontWeight: 'bold',
                  mr: 1
                }}
              />
              <ListItemText
                primary={LEVEL_LABELS[group.level]}
                secondary={`${group.words.length} words`}
              />
              <IconButton size="small">
                {group.expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              </IconButton>
            </ListItem>

            {/* Word List */}
            <Collapse in={group.expanded}>
              <List disablePadding sx={{ pl: 2, pr: 1, pb: 1 }}>
                {group.words.map((word, wordIndex) => (
                  <ListItem
                    key={`${word.word}-${wordIndex}`}
                    component="div"
                    dense
                    onClick={() => onWordClick?.(word.word)}
                    sx={{
                      cursor: onWordClick ? 'pointer' : 'default',
                      borderRadius: 1,
                      '&:hover': onWordClick ? { bgcolor: 'action.hover' } : {}
                    }}
                  >
                    <ListItemText
                      primary={
                        <Typography variant="body2" fontWeight={500}>
                          {word.word}
                        </Typography>
                      }
                      secondary={
                        word.lemma !== word.word ? (
                          <Typography variant="caption" color="text.secondary">
                            → {word.lemma}
                          </Typography>
                        ) : null
                      }
                    />
                    {word.frequency_rank && (
                      <Chip
                        label={`#${word.frequency_rank}`}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.65rem', height: 18 }}
                      />
                    )}
                  </ListItem>
                ))}
              </List>
            </Collapse>
          </Box>
        ))}
      </List>

      {/* Study Tip */}
      <Box sx={{ p: 2, bgcolor: 'grey.50' }}>
        <Typography variant="caption" color="text.secondary">
          Review these words before reading to improve comprehension.
        </Typography>
      </Box>
    </Box>
  );
}

export default memo(PageVocabularyBase);
