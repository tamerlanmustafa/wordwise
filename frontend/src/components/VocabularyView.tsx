import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react';
import {
  Box,
  Grid,
  Skeleton,
  Stack
} from '@mui/material';
import { TabsHeader } from './TabsHeader';
import { WordListWorkerBased } from './WordListWorkerBased';
import { MovieSidebar } from './MovieSidebar';
import { ScrollToTop } from './ScrollToTop';
import { EnrichmentStatus } from './EnrichmentStatus';
import type { ScriptAnalysisResult, DifficultyCategory, WordFrequency, CEFRLevel } from '../types/script';
import type { TMDBMetadata } from '../services/scriptService';
import type { MovieDifficultyResult } from '../utils/computeMovieDifficulty';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { useUserWords } from '../hooks/useUserWords';
import { useScrollReveal } from '../hooks/useScrollReveal';
import { useTopBarVisibility } from '../contexts/TopBarVisibilityContext';
import apiClient from '../services/api';

interface VocabularyViewProps {
  analysis: ScriptAnalysisResult;
  tmdbMetadata: TMDBMetadata | null;
  userId?: number;
  isPreview?: boolean;
  movieId?: number;
  difficulty?: MovieDifficultyResult | null;
  difficultyIsMock?: boolean;
}

interface CEFRGroup {
  level: CEFRLevel;
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

// Base component implementation
function VocabularyViewBase({
  analysis,
  tmdbMetadata,
  userId,
  isPreview = false,
  movieId,
  difficulty,
  difficultyIsMock = false
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

  // Memoize groups data for TabsHeader
  const tabsHeaderGroups = useMemo(() =>
    groups.map(g => ({
      level: g.level,
      description: g.description,
      color: g.color,
      wordCount: g.words.length
    })),
    [groups]
  );

  // Save scroll position before tab change
  const saveScrollPosition = useCallback(() => {
    if (activeGroup && listContainerRef.current) {
      const scrollTop = window.scrollY;
      scrollStateRef.current[activeGroup.level] = {
        scrollTop,
        loadedCount: 0  // Worker handles loading internally
      };
    }
  }, [activeGroup]);

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

  // Restore scroll when tab changes
  useEffect(() => {
    if (activeGroup) {
      restoreScrollPosition();
    }
  }, [activeGroup, restoreScrollPosition]);

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

  // Tab change handler - wrapped in useCallback for stable reference
  const handleTabChange = useCallback((_: React.SyntheticEvent, newValue: number) => {
    if (newValue === activeTab) return;

    // Save current scroll position
    saveScrollPosition();

    // Wrap in requestAnimationFrame for zero-jank tab switching
    requestAnimationFrame(() => {
      setActiveTab(newValue);
    });
  }, [activeTab, saveScrollPosition]);

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
      {/* REMOVED all animations from Grid to prevent layout thrashing */}
      <Grid container spacing={3} sx={{
        // Fixed layout to prevent reflow
        contain: 'layout style'
      }}>
        {/* Left Column: Vocabulary Tabs */}
        <Grid item xs={12} md={9} ref={gridItemRef}>
          {/* Top fade mask with iOS-style blur - only visible when TopBar is hidden */}
          <Box
            sx={{
              position: 'fixed',
              top: 0,
              left: `${fadeMaskStyle.left}px`,
              width: fadeMaskStyle.width,
              height: '120px',
              background: (theme) => `linear-gradient(to bottom, ${theme.palette.background.default} 0%, transparent 100%)`,
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              pointerEvents: 'none',
              zIndex: 1050,
              maskImage: 'linear-gradient(to bottom, black 0%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black 0%, transparent 100%)',
              opacity: showTopBar ? 0 : 1,
              // GPU-accelerated transition
              transition: 'opacity 0.25s cubic-bezier(0.22, 1, 0.36, 1)',
              willChange: 'opacity'
            }}
          />

          {/* TabsHeader - Isolated component, only re-renders on activeTab/scroll changes */}
          <TabsHeader
            groups={tabsHeaderGroups}
            activeTab={activeTab}
            onTabChange={handleTabChange}
            scrolledPastTop={scrolledPastTop}
            showTopBar={showTopBar}
          />

          {/* Enrichment Status Indicator - Shows when sentence examples are being generated */}
          <EnrichmentStatus movieId={movieId} targetLang={targetLanguage} />

          {/* WordListWorkerBased - Worker-based component with numbering */}
          {/* Key ensures remount on tab change, triggering fade-in animation */}
          <Box
            key={activeGroup.level}
            sx={{
              animation: 'fadeIn 0.25s ease-out',
              '@keyframes fadeIn': {
                from: { opacity: 0, transform: 'translateY(8px)' },
                to: { opacity: 1, transform: 'translateY(0)' }
              }
            }}
          >
            <WordListWorkerBased
              groupLevel={activeGroup.level}
              groupDescription={activeGroup.description}
              groupColor={activeGroup.color}
              totalWordCount={activeGroup.words.length}
              rawWords={activeGroup.words}
              isPreview={isPreview}
              isWordSavedInMovie={isWordSavedInMovie}
              saveWord={saveWord}
              toggleLearned={toggleLearned}
              learnedWords={learnedWords}
              savedWords={savedWords}
              otherMovies={otherMovies}
              movieId={movieId}
              targetLanguage={targetLanguage}
              userId={userId}
              isAuthenticated={isAuthenticated}
              idioms={analysis.idioms}
              listContainerRef={listContainerRef}
            />
          </Box>
        </Grid>

        {/* Right Column: TMDB Metadata Sidebar - Isolated component */}
        <Grid item xs={12} md={3}>
          <MovieSidebar tmdbMetadata={tmdbMetadata} difficulty={difficulty} difficultyIsMock={difficultyIsMock} />
        </Grid>
      </Grid>

      {/* Bottom fade mask - fixed to viewport bottom for "rows coming out" effect */}
      <Box
        sx={{
          position: 'fixed',
          bottom: 0,
          left: `${fadeMaskStyle.left}px`,
          width: fadeMaskStyle.width,
          height: '100px',
          background: (theme) => `linear-gradient(to top, ${theme.palette.background.default} 0%, transparent 100%)`,
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          pointerEvents: 'none',
          zIndex: 1050,
          maskImage: 'linear-gradient(to top, black 0%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to top, black 0%, transparent 100%)'
        }}
      />

      {/* Scroll to top button */}
      <ScrollToTop threshold={400} />
    </Box>
  );
}

// Export memoized version to prevent upward re-renders from bubbling down
// AWS/Cloudscape-level pattern for performance-critical orchestrator components
export default memo(VocabularyViewBase);
VocabularyViewBase.displayName = 'VocabularyView';
