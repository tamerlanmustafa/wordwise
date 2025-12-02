import { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Grid,
  Paper,
  Typography,
  Stack,
  Tabs,
  Tab,
  List,
  ListItem,
  Chip,
  Skeleton,
  Pagination,
  Divider,
  IconButton,
  Card,
  CardMedia,
  CardContent,
  Button,
  Alert,
  Tooltip,
  Fade
} from '@mui/material';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import MovieIcon from '@mui/icons-material/Movie';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import CategoryIcon from '@mui/icons-material/Category';
import LockIcon from '@mui/icons-material/Lock';
import { Link } from 'react-router-dom';
import type { ScriptAnalysisResult, DifficultyCategory, WordFrequency } from '../types/script';
import type { TMDBMetadata } from '../services/scriptService';
import { translateBatch } from '../services/scriptService';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { useUserWords } from '../hooks/useUserWords';
import apiClient from '../services/api';

interface VocabularyViewProps {
  analysis: ScriptAnalysisResult;
  tmdbMetadata: TMDBMetadata | null;
  userId?: number;
  isPreview?: boolean;
  movieId?: number;
}

interface TranslatedWord {
  word: string;
  lemma: string;
  translation: string;
  confidence?: number;
  cached: boolean;
  provider?: string | null;
}

interface CEFRGroup {
  level: string;
  description: string;
  words: WordFrequency[];
  translatedWords: Map<string, TranslatedWord>;
  color: string;
  currentPage: number;
  totalPages: number;
}

const LEVEL_COLORS: Record<string, string> = {
  A1: '#4caf50',
  A2: '#8bc34a',
  B1: '#ffc107',
  B2: '#ff9800',
  C1: '#f44336',
  C2: '#9c27b0'
};

const WORDS_PER_PAGE = 10;

export default function VocabularyView({
  analysis,
  tmdbMetadata,
  userId,
  isPreview = false,
  movieId
}: VocabularyViewProps) {
  const { targetLanguage } = useLanguage();
  const { isAuthenticated } = useAuth();
  const { savedWords, learnedWords, saveWord, toggleLearned, isWordSavedInMovie } = useUserWords();
  const [activeTab, setActiveTab] = useState(0);
  const [groups, setGroups] = useState<CEFRGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otherMovies, setOtherMovies] = useState<Record<string, Array<{ movie_id: number; title: string }>>>({});

  // Merge C1 and C2 into single "Advanced" category
  const mergedCategories = useMemo(() => {
    return analysis.categories.reduce((acc, category) => {
      if (category.level === 'C1' || category.level === 'C2') {
        const advancedIndex = acc.findIndex(c => c.level === 'C1');
        if (advancedIndex === -1) {
          acc.push({
            ...category,
            level: 'C1' as const,
            description: 'Advanced vocabulary (C1 & C2)'
          });
        } else {
          acc[advancedIndex].words.push(...category.words);
        }
      } else {
        acc.push(category);
      }
      return acc;
    }, [] as DifficultyCategory[]);
  }, [analysis.categories]);

  // Initialize groups with pagination info
  useEffect(() => {
    const initialGroups: CEFRGroup[] = mergedCategories.map(category => ({
      level: category.level,
      description: category.description,
      words: category.words,
      translatedWords: new Map(),
      color: LEVEL_COLORS[category.level] || '#4caf50',
      currentPage: 1,
      totalPages: Math.ceil(category.words.length / WORDS_PER_PAGE)
    }));
    setGroups(initialGroups);
  }, [mergedCategories]);

  useEffect(() => {
    if (!isAuthenticated || !movieId) return;

    const fetchOtherMovies = async () => {
      if (!isAuthenticated) return;

      const uniqueWords = new Set<string>();
      groups.forEach(g => g.words.forEach(w => uniqueWords.add(w.word.toLowerCase())));

      if (uniqueWords.size === 0) return;

      try {
        const response = await apiClient.post(
          `/user/words/other-movies/batch`,
          Array.from(uniqueWords),
          { params: { exclude_movie_id: movieId } }
        );
        setOtherMovies(response.data);
      } catch (error) {
        console.error('Failed to fetch other movies:', error);
        setOtherMovies({});
      }
    };

    fetchOtherMovies();
  }, [groups, isAuthenticated, movieId]);

  useEffect(() => {
    if (groups.length === 0) return;

    setGroups(prevGroups =>
      prevGroups.map(group => ({
        ...group,
        translatedWords: new Map()
      }))
    );
  }, [targetLanguage]);

  // Load translations for current page of active tab (only if authenticated and not preview mode)
  useEffect(() => {
    if (groups.length === 0 || isPreview || !isAuthenticated) return;

    const loadPageTranslations = async () => {
      const activeGroup = groups[activeTab];
      if (!activeGroup) return;

      const { currentPage, words, translatedWords } = activeGroup;
      const startIdx = (currentPage - 1) * WORDS_PER_PAGE;
      const endIdx = startIdx + WORDS_PER_PAGE;
      const pageWords = words.slice(startIdx, endIdx);

      // Check if we already have translations for this page
      const wordsToTranslate = pageWords.filter(w =>
        w.word && w.word.trim() && !translatedWords.has(w.word.toLowerCase())
      );

      if (wordsToTranslate.length === 0) {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const uniqueWords = Array.from(new Set(wordsToTranslate.map(w => w.word)))
          .filter(w => w != null && typeof w === 'string' && w.trim().length > 0);

        if (uniqueWords.length === 0) {
          setLoading(false);
          return;
        }

        const batchResponse = await translateBatch(
          uniqueWords,
          targetLanguage,
          'auto',
          userId
        );

        // Update the translatedWords map for this group
        setGroups(prevGroups => {
          const newGroups = [...prevGroups];
          const newMap = new Map(newGroups[activeTab].translatedWords);

          batchResponse.results.forEach((result) => {
            const sourceLower = result.source.toLowerCase();
            const translationLower = result.translated.toLowerCase();

            // Skip if source and translation are the same
            if (sourceLower !== translationLower) {
              newMap.set(sourceLower, {
                word: sourceLower,
                lemma: sourceLower,
                translation: translationLower,
                confidence: undefined,
                cached: result.cached,
                provider: result.provider
              });
            }
          });

          newGroups[activeTab] = {
            ...newGroups[activeTab],
            translatedWords: newMap
          };

          return newGroups;
        });
      } catch (err: any) {
        console.error('Failed to load translations:', err);
        setError('Failed to load translations. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    loadPageTranslations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, groups[activeTab]?.currentPage, targetLanguage, userId, isPreview, isAuthenticated]);

  const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  const handlePageChange = (_: React.ChangeEvent<unknown>, page: number) => {
    setGroups(prevGroups => {
      const newGroups = [...prevGroups];
      newGroups[activeTab] = {
        ...newGroups[activeTab],
        currentPage: page
      };
      return newGroups;
    });
  };

  if (groups.length === 0) {
    return (
      <Grid container spacing={3}>
        <Grid item xs={12} md={9}>
          <Skeleton variant="rectangular" height={64} sx={{ mb: 3 }} />
          <Stack spacing={1}>
            {[...Array(10)].map((_, i) => (
              <Skeleton key={i} variant="rectangular" height={48} />
            ))}
          </Stack>
        </Grid>
        <Grid item xs={12} md={3}>
          <Skeleton variant="rectangular" height={400} />
        </Grid>
      </Grid>
    );
  }

  const activeGroup = groups[activeTab];
  if (!activeGroup) return null;

  const startIdx = (activeGroup.currentPage - 1) * WORDS_PER_PAGE;
  const endIdx = startIdx + WORDS_PER_PAGE;
  const currentPageWords = activeGroup.words.slice(startIdx, endIdx);

  return (
    <Box sx={{ width: '100%' }}>
      {/* Summary Stats */}
      <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
        <Typography variant="h5" fontWeight="bold" sx={{ mb: 2 }}>
          {analysis.title}
        </Typography>

        <Divider sx={{ my: 2 }} />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={4}>
          <Box>
            <Typography variant="body2" color="text.secondary">
              Total Words in Script
            </Typography>
            <Typography variant="h6" fontWeight="medium">
              {analysis.totalWords.toLocaleString()}
            </Typography>
          </Box>
          <Box>
            <Typography variant="body2" color="text.secondary">
              Unique Words Classified
            </Typography>
            <Typography variant="h6" fontWeight="medium">
              {analysis.uniqueWords.toLocaleString()}
            </Typography>
          </Box>
          <Box>
            <Typography variant="body2" color="text.secondary">
              Vocabulary Richness
            </Typography>
            <Typography variant="h6" fontWeight="medium">
              {((analysis.uniqueWords / analysis.totalWords) * 100).toFixed(1)}%
            </Typography>
          </Box>
        </Stack>
      </Paper>

      {/* Two-Column Layout: Vocabulary (Left) + TMDB Metadata (Right) */}
      <Grid container spacing={3} alignItems="stretch">
        {/* Left Column: Vocabulary Tabs */}
        <Grid item xs={12} md={9} sx={{ display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ flexGrow: 1 }}>
              <Typography variant="h6" gutterBottom sx={{ mb: 2 }}>
                Vocabulary by Difficulty Level
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Words are classified using CEFR wordlists (Oxford 3000/5000, EFLex) and frequency analysis.
                Translations are loaded on-demand (10 words per page) to optimize API usage.
              </Typography>

              {/* Tabs Navigation */}
              <Paper elevation={2} sx={{ borderRadius: 2, mb: 3 }}>
                <Tabs
                  value={activeTab}
                  onChange={handleTabChange}
                  variant="scrollable"
                  scrollButtons="auto"
                  sx={{
                    px: 2,
                    '& .MuiTab-root': {
                      minHeight: 64,
                      textTransform: 'none',
                      fontWeight: 600,
                      fontSize: '1rem'
                    }
                  }}
                >
                  {groups.map((group) => (
                    <Tab
                      key={group.level}
                      label={
                        <Stack direction="row" spacing={1.5} alignItems="center">
                          <Typography variant="h6" fontWeight={700}>
                            {group.level}
                          </Typography>
                          <Chip
                            label={group.words.length}
                            size="small"
                            sx={{
                              bgcolor: `${group.color}20`,
                              color: group.color,
                              fontWeight: 600,
                              fontSize: '0.875rem'
                            }}
                          />
                        </Stack>
                      }
                      sx={{
                        color: 'text.secondary',
                        '&.Mui-selected': {
                          color: group.color
                        }
                      }}
                    />
                  ))}
                </Tabs>
              </Paper>

              {/* Active Tab Content */}
              <Box>
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
                      Sign in to unlock the full vocabulary list with translations and pagination
                    </Typography>
                  </Alert>
                )}

                {/* Header */}
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
                  <Box>
                    <Typography variant="h5" fontWeight={700} sx={{ color: activeGroup.color }}>
                      {activeGroup.level} Level
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {activeGroup.description}
                    </Typography>
                  </Box>
                  <Chip
                    label={isPreview ? `3 sample words` : `${activeGroup.words.length} words`}
                    sx={{
                      bgcolor: `${activeGroup.color}15`,
                      color: activeGroup.color,
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

                {/* Word List */}
                <Paper elevation={1} sx={{ borderRadius: 2, overflow: 'hidden', mb: 3 }}>
                  <List sx={{ py: 0 }}>
                    {currentPageWords.length === 0 ? (
                      <ListItem>
                        <Typography variant="body2" color="text.secondary">
                          No words in this level
                        </Typography>
                      </ListItem>
                    ) : (
                      currentPageWords.map((wordFreq, index) => {
                        const translatedWord = activeGroup.translatedWords.get(wordFreq.word.toLowerCase());
                        const isLoading = !translatedWord && loading && !isPreview;

                        // In preview mode, show words without translations
                        if (isPreview) {
                          return (
                            <Box key={`${wordFreq.lemma}-${index}`}>
                              <ListItem
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
                              {index < currentPageWords.length - 1 && <Divider />}
                            </Box>
                          );
                        }

                        // Skip words where source and translation are the same
                        if (!isLoading && !translatedWord) {
                          return null;
                        }

                        return (
                          <Box key={`${wordFreq.lemma}-${index}`}>
                            <ListItem
                              sx={{
                                py: 2,
                                px: 3,
                                '&:hover': {
                                  bgcolor: `${activeGroup.color}08`
                                }
                              }}
                            >
                              {isLoading ? (
                                <Stack sx={{ width: '100%' }} spacing={1}>
                                  <Skeleton variant="text" width="60%" />
                                  <Skeleton variant="text" width="40%" />
                                </Stack>
                              ) : translatedWord ? (
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
                                      {wordFreq.word.toLowerCase()}
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
                                          color: activeGroup.color,
                                          fontWeight: 500
                                        }}
                                      >
                                        {translatedWord.translation}
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
                                      {translatedWord?.cached && (
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
                                      {translatedWord?.provider && (
                                        <Chip
                                          label={translatedWord.provider}
                                          size="small"
                                          sx={{
                                            height: 20,
                                            fontSize: '0.7rem',
                                            bgcolor: translatedWord.provider === 'google' ? '#4285f420' : '#0A84FF20',
                                            color: translatedWord.provider === 'google' ? '#4285f4' : '#0A84FF'
                                          }}
                                        />
                                      )}
                                    </Stack>
                                  </Box>

                                  {/* Action Buttons */}
                                  <Stack direction="row" spacing={0.5}>
                                    <Tooltip
                                      title={
                                        otherMovies[wordFreq.word.toLowerCase()]?.length > 0
                                          ? `You might have seen this word in: ${otherMovies[wordFreq.word.toLowerCase()].map(m => m.title).join(', ')}`
                                          : ''
                                      }
                                      placement="top"
                                      TransitionComponent={Fade}
                                      TransitionProps={{ timeout: 300 }}
                                      arrow
                                      disableHoverListener={!otherMovies[wordFreq.word.toLowerCase()]?.length}
                                    >
                                      <IconButton
                                        size="small"
                                        onClick={() => saveWord(wordFreq.word.toLowerCase(), movieId)}
                                        sx={{ color: isWordSavedInMovie(wordFreq.word.toLowerCase(), movieId) ? 'warning.main' : 'text.secondary' }}
                                      >
                                        {isWordSavedInMovie(wordFreq.word.toLowerCase(), movieId) ? <BookmarkIcon /> : <BookmarkBorderIcon />}
                                      </IconButton>
                                    </Tooltip>
                                    <IconButton
                                      size="small"
                                      onClick={() => toggleLearned(wordFreq.word.toLowerCase())}
                                      disabled={!savedWords.has(wordFreq.word.toLowerCase())}
                                      sx={{ color: learnedWords.has(wordFreq.word.toLowerCase()) ? 'success.main' : 'text.secondary' }}
                                    >
                                      {learnedWords.has(wordFreq.word.toLowerCase()) ? <CheckCircleIcon /> : <CheckCircleOutlineIcon />}
                                    </IconButton>
                                  </Stack>
                                </Stack>
                              ) : null}
                            </ListItem>
                            {index < currentPageWords.length - 1 && <Divider />}
                          </Box>
                        );
                      })
                    )}
                  </List>
                </Paper>

                {/* Pagination (hide in preview mode) */}
                {!isPreview && activeGroup.totalPages > 1 && (
                  <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
                    <Pagination
                      count={activeGroup.totalPages}
                      page={activeGroup.currentPage}
                      onChange={handlePageChange}
                      color="primary"
                      size="large"
                      showFirstButton
                      showLastButton
                    />
                  </Box>
                )}

                {/* Stats Footer */}
                <Box sx={{ mt: 3, textAlign: 'center' }}>
                  <Typography variant="caption" color="text.secondary">
                    {isPreview ? (
                      `Showing 3 sample words • Sign in to view all ${activeGroup.words.length} words with translations`
                    ) : (
                      `Showing ${currentPageWords.length} of ${activeGroup.words.length} words • Page ${activeGroup.currentPage} of ${activeGroup.totalPages} • Translations loaded on demand`
                    )}
                  </Typography>
                </Box>
              </Box>
            </Box>
        </Grid>

        {/* Right Column: TMDB Metadata Sidebar */}
        <Grid item xs={12} md={3} sx={{ display: 'flex', flexDirection: 'column' }}>
          {tmdbMetadata ? (
            <Box sx={{ flexGrow: 1, position: 'relative' }}>
              <Card elevation={2} sx={{ position: 'sticky', top: 16 }}>
              {/* Poster */}
              {tmdbMetadata.poster ? (
                <CardMedia
                  component="img"
                  image={tmdbMetadata.poster}
                  alt={tmdbMetadata.title}
                  sx={{
                    width: '100%',
                    height: 'auto',
                    aspectRatio: '2/3'
                  }}
                />
              ) : (
                <Box
                  sx={{
                    width: '100%',
                    aspectRatio: '2/3',
                    bgcolor: 'grey.200',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <MovieIcon sx={{ fontSize: 64, color: 'grey.400' }} />
                </Box>
              )}

              <CardContent>
                {/* Title */}
                <Typography variant="h6" fontWeight="bold" gutterBottom>
                  {tmdbMetadata.title}
                </Typography>

                {/* Year */}
                {tmdbMetadata.year && (
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                    <CalendarTodayIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                    <Typography variant="body2" color="text.secondary">
                      {tmdbMetadata.year}
                    </Typography>
                  </Stack>
                )}

                {/* Genres */}
                {tmdbMetadata.genres.length > 0 && (
                  <Box sx={{ mb: 2 }}>
                    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 1 }}>
                      <CategoryIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                      <Typography variant="body2" color="text.secondary" fontWeight="medium">
                        Genres
                      </Typography>
                    </Stack>
                    <Stack direction="row" flexWrap="wrap" gap={0.5}>
                      {tmdbMetadata.genres.map((genre) => (
                        <Chip
                          key={genre}
                          label={genre}
                          size="small"
                          sx={{
                            fontSize: '0.75rem',
                            height: 24
                          }}
                        />
                      ))}
                    </Stack>
                  </Box>
                )}

                {/* Overview */}
                {tmdbMetadata.overview && (
                  <Box>
                    <Typography variant="body2" fontWeight="medium" gutterBottom>
                      Overview
                    </Typography>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{
                        lineHeight: 1.6,
                        fontSize: '0.875rem'
                      }}
                    >
                      {tmdbMetadata.overview}
                    </Typography>
                  </Box>
                )}
              </CardContent>
              </Card>
            </Box>
          ) : (
            // Skeleton loader for TMDB metadata
            <Card elevation={2}>
              <Skeleton variant="rectangular" height={300} />
              <CardContent>
                <Skeleton variant="text" height={32} width="80%" />
                <Skeleton variant="text" height={20} width="40%" sx={{ mb: 2 }} />
                <Skeleton variant="text" height={20} />
                <Skeleton variant="text" height={20} />
                <Skeleton variant="text" height={20} width="60%" />
              </CardContent>
            </Card>
          )}
        </Grid>
      </Grid>
    </Box>
  );
}
