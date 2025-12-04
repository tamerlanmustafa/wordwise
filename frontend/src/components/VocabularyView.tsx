import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
  Divider,
  IconButton,
  Card,
  CardMedia,
  CardContent,
  Button,
  Alert,
  Tooltip,
  Fade,
  CircularProgress
} from '@mui/material';
import { motion } from 'framer-motion';
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
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { useUserWords } from '../hooks/useUserWords';
import { useInfiniteWordFeed } from '../hooks/useInfiniteWordFeed';
import { useScrollReveal } from '../hooks/useScrollReveal';
import { useTopBarVisibility } from '../contexts/TopBarVisibilityContext';
import apiClient from '../services/api';

interface VocabularyViewProps {
  analysis: ScriptAnalysisResult;
  tmdbMetadata: TMDBMetadata | null;
  userId?: number;
  isPreview?: boolean;
  movieId?: number;
}

interface CEFRGroup {
  level: string;
  description: string;
  words: WordFrequency[];
  color: string;
}

interface TabScrollState {
  scrollTop: number;
  loadedCount: number;
}

const LEVEL_COLORS: Record<string, string> = {
  A1: '#4caf50',
  A2: '#8bc34a',
  B1: '#ffc107',
  B2: '#ff9800',
  C1: '#f44336',
  C2: '#9c27b0'
};

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
  const [otherMovies, setOtherMovies] = useState<Record<string, Array<{ movie_id: number; title: string }>>>({});

  // Scroll reveal for topbar (tabs always stay visible once scrolling starts)
  const { suppressScrollReveal } = useScrollReveal({
    revealThreshold: 20,
    hideThreshold: 30,
    enabled: !isPreview
  });

  // Get TopBar visibility for proper tab positioning
  const { showTopBar } = useTopBarVisibility();

  // Track scroll position for sticky tab shadow
  const [scrolledPastTop, setScrolledPastTop] = useState(false);

  // Tab switching debounce
  const tabSwitchTimerRef = useRef<number | null>(null);
  const [pendingTab, setPendingTab] = useState<number | null>(null);

  // Scroll position preservation per tab
  const scrollStateRef = useRef<Record<string, TabScrollState>>({});
  const isRestoringScrollRef = useRef(false);
  const listContainerRef = useRef<HTMLDivElement | null>(null);

  // Track Grid item dimensions for fade mask positioning
  const gridItemRef = useRef<HTMLDivElement | null>(null);
  const [fadeMaskStyle, setFadeMaskStyle] = useState({ left: 0, width: '100%' });

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

  // Initialize groups
  useEffect(() => {
    const initialGroups: CEFRGroup[] = mergedCategories.map(category => ({
      level: category.level,
      description: category.description,
      words: category.words,
      color: LEVEL_COLORS[category.level] || '#4caf50'
    }));
    setGroups(initialGroups);
  }, [mergedCategories]);

  // Get active group
  const activeGroup = groups[activeTab];

  // Infinite scroll feed for active group
  const {
    visibleWords,
    translations,
    isLoadingMore,
    hasMore,
    error,
    sentinelRef
  } = useInfiniteWordFeed({
    rawWords: activeGroup?.words || [],
    targetLanguage,
    userId,
    isAuthenticated,
    isPreview,
    batchSize: 20
  });

  // Save scroll position before tab change
  const saveScrollPosition = useCallback(() => {
    if (activeGroup && listContainerRef.current) {
      const scrollTop = window.scrollY;
      scrollStateRef.current[activeGroup.level] = {
        scrollTop,
        loadedCount: visibleWords.length
      };
    }
  }, [activeGroup, visibleWords.length]);

  // Restore scroll position after tab change
  const restoreScrollPosition = useCallback(() => {
    if (activeGroup && listContainerRef.current) {
      const savedState = scrollStateRef.current[activeGroup.level];
      if (savedState && savedState.scrollTop > 0) {
        isRestoringScrollRef.current = true;

        // Suppress scroll reveal for 200ms during programmatic scroll
        suppressScrollReveal(200);

        setTimeout(() => {
          window.scrollTo({ top: savedState.scrollTop, behavior: 'instant' });
          setTimeout(() => {
            isRestoringScrollRef.current = false;
          }, 100);
        }, 50);
      }
    }
  }, [activeGroup, suppressScrollReveal]);

  // Restore scroll when visibleWords changes (after data loads)
  useEffect(() => {
    if (visibleWords.length > 0 && !isLoadingMore) {
      restoreScrollPosition();
    }
  }, [visibleWords.length, isLoadingMore, restoreScrollPosition]);

  // Fetch other movies for word tooltips
  useEffect(() => {
    if (!isAuthenticated || !movieId || groups.length === 0) return;

    const fetchOtherMovies = async () => {
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

  // Debounced tab change handler
  const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
    if (newValue === activeTab) return;

    // Save current scroll position
    saveScrollPosition();

    // Clear existing timer
    if (tabSwitchTimerRef.current) {
      clearTimeout(tabSwitchTimerRef.current);
    }

    // Set pending tab
    setPendingTab(newValue);

    // Debounce: wait 100ms before actually switching
    tabSwitchTimerRef.current = setTimeout(() => {
      setActiveTab(newValue);
      setPendingTab(null);
    }, 100);
  };

  // Detect scroll position for sticky tab shadow
  useEffect(() => {
    const handleScroll = () => {
      setScrolledPastTop(window.scrollY > 10);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Update fade mask position to match Grid item
  useEffect(() => {
    const updateFadeMaskPosition = () => {
      if (gridItemRef.current) {
        const rect = gridItemRef.current.getBoundingClientRect();
        // Grid spacing adds 12px padding on left side, adjust to match content
        setFadeMaskStyle({
          left: rect.left + 24,
          width: `${rect.width - 24}px` // Subtract both left (12) and right (12) spacing
        });
      }
    };

    updateFadeMaskPosition();
    window.addEventListener('resize', updateFadeMaskPosition);
    return () => window.removeEventListener('resize', updateFadeMaskPosition);
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (tabSwitchTimerRef.current) {
        clearTimeout(tabSwitchTimerRef.current);
      }
    };
  }, []);

  // Show skeleton on initial load
  if (groups.length === 0 && analysis.categories.length === 0) {
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

  if (!activeGroup) return null;

  return (
    <Box sx={{ width: '100%' }}>
      {/* Two-Column Layout: Vocabulary (Left) + TMDB Metadata (Right) */}
      <Grid container spacing={3} alignItems="stretch">
        {/* Left Column: Vocabulary Tabs */}
        <Grid item xs={12} md={9} sx={{ display: 'flex', flexDirection: 'column' }} ref={gridItemRef}>
          {/* Top fade mask with iOS-style blur - only visible when TopBar is hidden */}
          <Box
            sx={{
              position: 'fixed',
              top: 0, // Top of viewport
              left: `${fadeMaskStyle.left}px`,
              width: fadeMaskStyle.width,
              height: '120px',
              background: (theme) => `linear-gradient(to bottom, ${theme.palette.background.default} 0%, transparent 100%)`,
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)', // Safari support
              pointerEvents: 'none',
              zIndex: 1050, // Behind tabs (tabs are zIndex 1100) and TopBar (zIndex 1200)
              maskImage: 'linear-gradient(to bottom, black 0%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black 0%, transparent 100%)',
              opacity: showTopBar ? 0 : 1,
              transition: 'opacity 0.25s cubic-bezier(0.22, 1, 0.36, 1)'
            }}
          />

          {/* Bottom fade mask with iOS-style blur */}
          <Box
            sx={{
              position: 'fixed',
              bottom: 0,
              left: `${fadeMaskStyle.left}px`,
              width: fadeMaskStyle.width,
              height: '120px',
              background: (theme) => `linear-gradient(to top, ${theme.palette.background.default} 0%, transparent 100%)`,
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)', // Safari support
              pointerEvents: 'none',
              zIndex: 1050,
              maskImage: 'linear-gradient(to top, black 0%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to top, black 0%, transparent 100%)'
            }}
          />

          <Box sx={{ flexGrow: 1 }} ref={listContainerRef}>
            {/* Sticky Tabs - Always Visible */}
            <Box
              sx={{
                position: 'sticky',
                top: '72px', // Always fixed, no change ever
                zIndex: 1100,
                transform: showTopBar ? 'translateY(0)' : 'translateY(-48px)',
                transition: 'transform 0.35s cubic-bezier(0.25, 0.1, 0.25, 1)',
                backgroundColor: 'background.default',
                mb: 3,
                mx: 1 // Slight horizontal margin to reduce width
              }}
            >
              <Paper
                elevation={2}
                sx={{
                  borderRadius: '16px',
                  boxShadow: scrolledPastTop
                    ? '0px 4px 12px rgba(0, 0, 0, 0.08)'
                    : 'none',
                  transition: 'box-shadow 0.3s ease',
                  position: 'relative',
                  overflow: 'hidden',
                  '&::before': {
                    content: '""',
                    position: 'absolute',
                    inset: 0,
                    borderRadius: '16px',
                    padding: '2px',
                    background: 'linear-gradient(90deg, #ff6b6b, #4ecdc4, #45b7d1, #96ceb4, #ffeaa7, #fd79a8, #a29bfe, #6c5ce7, #ff6b6b)',
                    backgroundSize: '400% 100%',
                    WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                    WebkitMaskComposite: 'xor',
                    maskComposite: 'exclude',
                    animation: 'gradient-shift 15s linear infinite',
                    pointerEvents: 'none'
                  },
                  '@keyframes gradient-shift': {
                    '0%': {
                      backgroundPosition: '0% 50%'
                    },
                    '100%': {
                      backgroundPosition: '400% 50%'
                    }
                  }
                }}
              >
                <Box sx={{ position: 'relative' }}>
                  {/* Animated background indicator that slides between tabs */}
                  <motion.div
                    animate={{
                      left: `${activeTab * (100 / groups.length)}%`,
                    }}
                    transition={{
                      type: 'spring',
                      stiffness: 300,
                      damping: 30
                    }}
                    style={{
                      position: 'absolute',
                      top: 0,
                      width: `${100 / groups.length}%`,
                      height: '100%',
                      zIndex: 0,
                      pointerEvents: 'none'
                    }}
                  >
                    <Box
                      sx={{
                        width: '100%',
                        height: '100%',
                        backgroundColor: `${groups[activeTab]?.color}15`,
                        borderRadius: '14px',
                        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                        transition: 'background-color 0.3s ease'
                      }}
                    />
                  </motion.div>

                  <Tabs
                    value={pendingTab !== null ? pendingTab : activeTab}
                    onChange={handleTabChange}
                    variant="scrollable"
                    scrollButtons={false}
                    sx={{
                      px: 0,
                      py: 0,
                      position: 'relative',
                      zIndex: 1,
                      '& .MuiTabs-indicator': { display: 'none' },
                      '& .MuiTabs-flexContainer': {
                        display: 'flex',
                        justifyContent: 'space-between',
                        width: '100%',
                      },
                      '& .MuiTab-root': {
                        flex: 1,
                        minWidth: 0,
                        padding: 0,
                      }
                    }}
                  >

                  {groups.map((group, index) => (
                    <Tab
                      key={group.level}
                      disableRipple
                      sx={{
                        color: 'text.secondary',
                        border: '1px solid rgba(0,0,0,0.08)',
                        borderRight: index === groups.length - 1 ? '1px solid rgba(0,0,0,0.08)' : 'none',
                        position: 'relative',
                        transition: 'all 200ms ease-in-out',
                        backgroundColor: 'transparent',
                        borderRadius: '14px',
                        overflow: 'hidden',
                        '&.Mui-selected': {
                          color: group.color,
                          borderColor: `${group.color}30`
                        }
                    }}
                      label={
                        <Box
                          sx={{
                            position: 'relative',
                            padding: '6px 20px',
                          }}
                        >
                          <Stack direction="column" spacing={0} alignItems="center">
                            <Typography
                              variant="h5"                              
                              sx={{
                                fontWeight: 700,
                                
                            }}>
                              {group.level}
                            </Typography>
                          </Stack>
                        </Box>
                      }
                    />
                  ))}
                </Tabs>
                </Box>
              </Paper>
            </Box>

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
                    Sign in to unlock the full vocabulary list with translations
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
                  label={
                    isPreview
                      ? `3 sample words`
                      : `${activeGroup.words.length} words`
                  }
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

              {/* Infinite Scroll Word List */}
              <Paper elevation={1} sx={{ borderRadius: 2, overflow: 'hidden', mb: 3 }}>
                <List sx={{ py: 0 }}>
                    {visibleWords.length === 0 && !isLoadingMore ? (
                      <ListItem>
                        <Typography variant="body2" color="text.secondary">
                          {isPreview ? 'Sign in to view vocabulary' : 'No words in this level'}
                        </Typography>
                      </ListItem>
                    ) : (
                      <>
                        {visibleWords.map((wordFreq, index) => {
                          const translatedWord = translations.get(wordFreq.word.toLowerCase());

                          // In preview mode, show first 3 words without translations
                          if (isPreview && index < 3) {
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
                                {index < 2 && <Divider />}
                              </Box>
                            );
                          }

                          if (isPreview) return null;

                          // Skip if no translation (filtered out by useInfiniteWordFeed)
                          if (!translatedWord) {
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
                                      {translatedWord.cached && (
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
                                      {translatedWord.provider && (
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
                              </ListItem>
                              {index < visibleWords.length - 1 && <Divider />}
                            </Box>
                          );
                        })}

                        {/* Loading Indicator */}
                        {isLoadingMore && (
                          <ListItem sx={{ py: 3, justifyContent: 'center' }}>
                            <Stack spacing={2} alignItems="center">
                              <CircularProgress size={32} sx={{ color: activeGroup.color }} />
                              <Typography variant="body2" color="text.secondary">
                                Loading more words...
                              </Typography>
                            </Stack>
                          </ListItem>
                        )}
                      </>
                    )}
                  </List>
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
