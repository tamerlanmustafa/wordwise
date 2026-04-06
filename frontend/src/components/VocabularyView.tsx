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
import { ReportDialog } from './ReportDialog';
import { createReport } from '../services/api';
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
  isUploadedContent?: boolean;
  gutenbergId?: number;
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
  difficultyIsMock = false,
  isUploadedContent = false,
  gutenbergId
}: VocabularyViewProps) {
  const { targetLanguage } = useLanguage();
  const { isAuthenticated } = useAuth();
  const { savedWords, learnedWords, saveWord, toggleLearned, isWordSavedInMovie, logInteraction } = useUserWords();
  const [activeTab, setActiveTab] = useState(0);
  const [viewMode, setViewMode] = useState<'levels' | 'idioms'>('levels');
  const [groups, setGroups] = useState<CEFRGroup[]>([]);
  const [otherMovies, setOtherMovies] = useState<Record<string, Array<{ movie_id: number; title: string }>>>({});

  // Report dialog state
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [reportWord, setReportWord] = useState('');
  const [reportTranslationSource, setReportTranslationSource] = useState<string | undefined>(undefined);

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

  // Show all CEFR levels including C2 separately
  const mergedCategories = useMemo(() => {
    return analysis.categories;
  }, [analysis.categories]);

  // Create idioms "category" if idioms exist
  // Store idioms as a map for quick lookup
  const idiomsMap = useMemo(() => {
    if (!analysis.idioms) return new Map();
    return new Map(analysis.idioms.map(idiom => [idiom.phrase, idiom]));
  }, [analysis.idioms]);

  // Idioms grouped by CEFR level — same shape as `groups`, so it can drive the SAME TabsHeader
  const idiomsGroups: CEFRGroup[] = useMemo(() => {
    if (!analysis.idioms || analysis.idioms.length === 0) return [];

    const byLevel: Record<string, WordFrequency[]> = {};
    analysis.idioms.forEach((idiom, idx) => {
      const lvl = (idiom.cefr_level || 'C1').toUpperCase();
      if (!byLevel[lvl]) byLevel[lvl] = [];
      byLevel[lvl].push({
        word: idiom.phrase,
        lemma: idiom.phrase,
        count: 0,
        frequency: 0,
        confidence: 1,
        frequency_rank: idx
      });
    });

    const allLevels: CEFRLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    return allLevels.map(level => ({
      level,
      description: mergedCategories.find(c => c.level === level)?.description || '',
      words: byLevel[level] || [],
      color: LEVEL_COLORS[level] || '#9c27b0'
    }));
  }, [analysis.idioms, mergedCategories]);

  const hasIdioms = idiomsGroups.some(g => g.words.length > 0);

  // Initialize groups (CEFR levels only — idioms are now a separate top-level view)
  useEffect(() => {
    const initialGroups: CEFRGroup[] = mergedCategories.map(category => ({
      level: category.level,
      description: category.description,
      words: category.words,
      color: LEVEL_COLORS[category.level] || '#4caf50'
    }));

    setGroups(initialGroups);
  }, [mergedCategories]);

  // If user switches to 'idioms' view but there are no idioms, fall back to 'levels'
  useEffect(() => {
    if (viewMode === 'idioms' && !hasIdioms) {
      setViewMode('levels');
    }
  }, [viewMode, hasIdioms]);

  // Pick which set of groups drives the tabs based on viewMode
  const activeGroups = viewMode === 'idioms' ? idiomsGroups : groups;
  const activeGroup = activeGroups[activeTab];

  // Memoize groups data for TabsHeader (always reflects the current view's groups)
  const tabsHeaderGroups = useMemo(() =>
    activeGroups.map(g => ({
      level: g.level,
      description: g.description,
      color: g.color,
      wordCount: g.words.length
    })),
    [activeGroups]
  );

  // Save scroll position before tab change (key includes viewMode to avoid Words/Expressions clash)
  const saveScrollPosition = useCallback(() => {
    if (activeGroup && listContainerRef.current) {
      const scrollTop = window.scrollY;
      scrollStateRef.current[`${viewMode}-${activeGroup.level}`] = {
        scrollTop,
        loadedCount: 0  // Worker handles loading internally
      };
    }
  }, [activeGroup, viewMode]);

  // Restore scroll position after tab change
  const restoreScrollPosition = useCallback(() => {
    if (activeGroup && listContainerRef.current) {
      const savedState = scrollStateRef.current[`${viewMode}-${activeGroup.level}`];
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
  }, [activeGroup, viewMode, suppressScrollReveal]);

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

  // Report handlers
  const handleOpenReport = useCallback((word: string, translationSource?: string) => {
    setReportWord(word);
    setReportTranslationSource(translationSource);
    setReportDialogOpen(true);
  }, []);

  const handleCloseReport = useCallback(() => {
    setReportDialogOpen(false);
    setReportWord('');
    setReportTranslationSource(undefined);
  }, []);

  const handleSubmitReport = useCallback(async (data: {
    word: string;
    movie_id?: number;
    movie_title?: string;
    reason: 'WRONG_TRANSLATION' | 'WRONG_CONTEXT' | 'WRONG_SPELLING' | 'INAPPROPRIATE_CONTENT' | 'OTHER';
    details?: string;
    translation_source?: string;
  }) => {
    await createReport(data);
  }, []);

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

          {/* Words / Expressions top-level toggle with sliding indicator */}
          {hasIdioms && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
              <Box
                sx={{
                  position: 'relative',
                  display: 'inline-flex',
                  bgcolor: 'background.paper',
                  borderRadius: '12px',
                  border: '1px solid rgba(0,0,0,0.08)',
                  padding: '4px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}
              >
                {/* Sliding background indicator */}
                <Box
                  sx={{
                    position: 'absolute',
                    top: '4px',
                    left: '4px',
                    width: 'calc(50% - 4px)',
                    height: 'calc(100% - 8px)',
                    bgcolor: '#9c27b015',
                    borderRadius: '8px',
                    transform: viewMode === 'idioms' ? 'translateX(100%)' : 'translateX(0)',
                    transition: 'transform 0.32s cubic-bezier(0.4, 0, 0.2, 1)',
                    willChange: 'transform',
                    zIndex: 0,
                  }}
                />
                {(['levels', 'idioms'] as const).map((mode) => {
                  const isActive = viewMode === mode;
                  const totalIdioms = idiomsGroups.reduce((sum, g) => sum + g.words.length, 0);
                  const label = mode === 'levels' ? 'Words' : `Expressions (${totalIdioms})`;
                  return (
                    <Box
                      key={mode}
                      onClick={() => setViewMode(mode)}
                      sx={{
                        position: 'relative',
                        zIndex: 1,
                        px: 3,
                        py: 0.75,
                        cursor: 'pointer',
                        userSelect: 'none',
                        fontSize: '0.875rem',
                        fontWeight: 600,
                        color: isActive ? '#9c27b0' : 'text.secondary',
                        transition: 'color 0.25s ease',
                        textAlign: 'center',
                        minWidth: 110,
                      }}
                    >
                      {label}
                    </Box>
                  );
                })}
              </Box>
            </Box>
          )}

          {/* TabsHeader - same component drives both Words and Expressions views */}
          <TabsHeader
            groups={tabsHeaderGroups}
            activeTab={activeTab}
            onTabChange={handleTabChange}
            scrolledPastTop={scrolledPastTop}
            showTopBar={showTopBar}
          />


          {/* WordListWorkerBased - Worker-based component with numbering */}
          {/* Key ensures remount on tab change or viewMode switch, triggering fade-in animation */}
          <Box
            key={`${viewMode}-${activeGroup.level}`}
            sx={{
              animation: 'fadeIn 0.3s ease-out',
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
              movieTitle={tmdbMetadata?.title}
              targetLanguage={targetLanguage}
              userId={userId}
              isAuthenticated={isAuthenticated}
              idioms={analysis.idioms}
              idiomsMap={idiomsMap}
              isIdiomsTab={viewMode === 'idioms'}
              listContainerRef={listContainerRef}
              onReport={isAuthenticated ? handleOpenReport : undefined}
              logInteraction={logInteraction}
            />
          </Box>
        </Grid>

        {/* Right Column: TMDB Metadata Sidebar - Isolated component */}
        <Grid item xs={12} md={3}>
          <MovieSidebar tmdbMetadata={tmdbMetadata} difficulty={difficulty} difficultyIsMock={difficultyIsMock} isUploadedContent={isUploadedContent} gutenbergId={gutenbergId} />
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

      {/* Report Dialog */}
      <ReportDialog
        open={reportDialogOpen}
        onClose={handleCloseReport}
        word={reportWord}
        movieId={movieId}
        movieTitle={tmdbMetadata?.title}
        translationSource={reportTranslationSource}
        onSubmit={handleSubmitReport}
      />
    </Box>
  );
}

// Export memoized version to prevent upward re-renders from bubbling down
// AWS/Cloudscape-level pattern for performance-critical orchestrator components
export default memo(VocabularyViewBase);
VocabularyViewBase.displayName = 'VocabularyView';
