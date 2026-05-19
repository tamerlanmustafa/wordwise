import React, { useEffect, useRef, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar, Alert, Platform, UIManager, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { useAuthStore } from '../stores/authStore';
import { useEntitlementsStore } from '../stores/entitlementsStore';
import { useThemeStore } from '../stores/themeStore';
import { useDailyGoalStore } from '../stores/dailyGoalStore';
import { useThemeColors } from '../theme/tokens';
import { GOOGLE_CLIENT_ID_IOS } from '../config/env';
import { AdminScreen } from '../components/AdminScreen';
import { ReviewScreen } from '../components/ReviewScreen';
import { PaywallScreen } from '../components/PaywallScreen';
import { StatsScreen } from '../components/StatsScreen';
import { NotebookScreen } from '../components/NotebookScreen';
import { registerForPushNotifications, scheduleDailyWordReminder, scheduleReviewReminder } from '../services/notifications';
import { AchievementsScreen } from '../components/AchievementsScreen';
import { LeaderboardScreen } from '../components/LeaderboardScreen';
import { FamilyPlanScreen } from '../components/FamilyPlanScreen';
import { PrivacyScreen } from '../components/PrivacyScreen';
import { QuizJourneyScreen } from '../components/QuizJourneyScreen';
import { QuizLessonScreen } from '../components/QuizLessonScreen';
import { QuizResultScreen } from '../components/QuizResultScreen';
import { QuizBatchBuilderScreen } from '../components/QuizBatchBuilderScreen';
import { JourneyScreen, type MoviePreviewPayload } from '../components/JourneyScreen';
import { MoviePreviewHub } from '../components/MoviePreviewHub';
import { SetIntroScreen, type SetIntroWord } from '../components/SetIntroScreen';
import type { ReelTile } from '../services/api';
import type { NodeLevel } from '../components/journey/JourneyNode';
import { UserMenuSheet } from '../components/UserMenuSheet';
import { SplashIntro } from '../components/SplashIntro';
import { GlobalBottomBar, type BottomTab } from '../components/GlobalBottomBar';
import { PosterFlight } from '../components/PosterFlight';
import { useReelBadgeStore } from '../stores/reelBadgeStore';
import { quizApi, type QuizStartSessionResponse, type QuizCompleteResponse, type QuizCardResultInput } from '../services/api';
import { useReelStore } from '../stores/reelStore';
import type { Screen, ListFilter, MovieData } from './types';
import { colors } from '../theme/palette';
import { LoadingScreen } from '../components/ui/LoadingScreen';
import { SearchResultsScreen } from '../components/screens/SearchResultsScreen';
import { LoginScreen } from '../components/screens/LoginScreen';
import { VocabularyScreen } from '../components/screens/VocabularyScreen';
import { LearnedWordsScreen } from '../components/screens/LearnedWordsScreen';
import { SettingsScreen } from '../components/screens/SettingsScreen';
import { ListsScreen } from '../components/screens/ListsScreen';
import { HomeScreen } from '../components/screens/HomeScreen';
import { MovieDetailScreen } from '../components/screens/MovieDetailScreen';

// Android requires opt-in for LayoutAnimation; iOS is on by default.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

GoogleSignin.configure({
  iosClientId: GOOGLE_CLIENT_ID_IOS,
  scopes: ['profile', 'email'],
});



export default function App() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);
  const logout = useAuthStore((s) => s.logout);
  const initialize = useAuthStore((s) => s.initialize);

  const tc = useThemeColors();
  const resolvedTheme = useThemeStore((s) => s.resolved);

  // Navigation state
  const [currentScreen, setCurrentScreen] = useState<Screen>('home');
  const [selectedMovie, setSelectedMovie] = useState<MovieData | null>(null);
  const [searchQueryNav, setSearchQueryNav] = useState('');
  const [listFilter, setListFilter] = useState<ListFilter>('saved');
  // Header dropdown's chosen translation language. Persisted to AsyncStorage
  // (key: targetLanguage) so the user's last pick survives app restarts
  // instead of snapping back to user.learning_language every cold start.
  const [targetLanguage, _setTargetLanguage] = useState(user?.learning_language?.toUpperCase() || 'ES');
  const [targetLanguageLoaded, setTargetLanguageLoaded] = useState(false);

  const setTargetLanguage = useCallback((lang: string) => {
    _setTargetLanguage(lang);
    AsyncStorage.setItem('targetLanguage', lang).catch((e) =>
      console.warn('Failed to persist targetLanguage:', e)
    );
  }, []);

  useEffect(() => {
    initialize();
    // Hydrate the admin preview toggle from AsyncStorage so a refresh
    // doesn't reset an admin's "viewing as free" selection.
    useEntitlementsStore.getState().hydrate();
    useThemeStore.getState().hydrate();
    useDailyGoalStore.getState().hydrate();
    // Schedule daily notifications (Today's Word at 9am, review reminder at 6pm).
    // registerForPushNotifications is a no-op on simulator.
    registerForPushNotifications().then(() => {
      scheduleDailyWordReminder();
      scheduleReviewReminder();
    }).catch(() => {});
  }, [initialize]);

  // On first mount, try to restore the last chosen target language before
  // letting user.learning_language win. If there's a saved value, lock it
  // in and ignore the profile default.
  useEffect(() => {
    AsyncStorage.getItem('targetLanguage').then((saved) => {
      if (saved) _setTargetLanguage(saved);
      setTargetLanguageLoaded(true);
    });
  }, []);

  // Only fall back to user.learning_language if the user hasn't made a
  // local override yet. Otherwise the header would reset to 'ES' on every
  // auth hydration.
  useEffect(() => {
    if (!targetLanguageLoaded) return;
    AsyncStorage.getItem('targetLanguage').then((saved) => {
      if (!saved && user?.learning_language) {
        _setTargetLanguage(user.learning_language.toUpperCase());
      }
    });
  }, [user?.learning_language, targetLanguageLoaded]);

  const handleLogin = async (user: any, token: string) => {
    await login(user, token, token);
  };

  const navigateToMovie = (movie: MovieData) => {
    // WordWise currently only processes English subtitles. If the user taps
    // a film whose original language isn't English, warn them up front
    // instead of letting them hit a script-fetch failure deep in the flow.
    // (Multi-language support is on the roadmap.)
    const lang = (movie.original_language || '').toLowerCase();
    if (lang && lang !== 'en') {
      Alert.alert(
        'Not yet supported',
        "WordWise currently only processes English-language films. We're working on support for other languages — check back soon!",
        [{ text: 'OK', style: 'default' }]
      );
      return;
    }
    setSelectedMovie(movie);
    setCurrentScreen('movieDetail');
  };

  const navigateToHome = () => {
    setSelectedMovie(null);
    setSearchQueryNav('');
    setResolvedMovieId(null);
    setCurrentScreen('home');
  };

  const navigateToSearch = (query: string) => {
    setSearchQueryNav(query);
    setCurrentScreen('searchResults');
  };

  const navigateToSettings = () => {
    setCurrentScreen('settings');
  };

  const navigateToAdmin = () => {
    setCurrentScreen('admin');
  };

  const [paywallProps, setPaywallProps] = useState({ previewsUsed: 0, previewsLimit: 3 });

  const navigateToReview = () => {
    setCurrentScreen('review');
  };

  const navigateToPaywall = (previewsUsed: number, previewsLimit: number) => {
    setPaywallProps({ previewsUsed, previewsLimit });
    setCurrentScreen('paywall');
  };

  const navigateToStats = () => {
    setCurrentScreen('stats');
  };

  const navigateToNotebook = (filter: ListFilter = 'saved') => {
    setListFilter(filter);
    setCurrentScreen('notebook');
  };

  const navigateToLists = () => {
    setCurrentScreen('lists');
  };

  const navigateToAchievements = () => {
    setCurrentScreen('achievements');
  };

  const navigateToLeaderboard = () => {
    setCurrentScreen('leaderboard');
  };

  const navigateToFamilyPlan = () => {
    setCurrentScreen('familyPlan');
  };

  const navigateToPrivacy = () => {
    setCurrentScreen('privacy');
  };

  const navigateToTerms = () => {
    setCurrentScreen('terms');
  };

  const navigateToLearnedWords = () => {
    setCurrentScreen('learnedWords');
  };

  const navigateToVocabulary = () => {
    setCurrentScreen('vocabulary');
  };

  // Quiz state. Journey shows units for a movie; lesson plays a session;
  // result shows stars + XP. selectedMovie already gives us movieId/title for
  // the journey screen, but a quiz session can outlive the movieDetail
  // navigation context (user exits back, stats persist), so we stash the
  // session separately.
  const [quizSession, setQuizSession] = useState<{
    session: QuizStartSessionResponse;
    level: string;
  } | null>(null);
  const [quizResult, setQuizResult] = useState<{
    result: QuizCompleteResponse;
    level: string;
  } | null>(null);

  // Movies surfaced from TMDB search carry a TMDB id in `selectedMovie.id`,
  // but backend endpoints need the internal movie id. MovieDetailScreen
  // resolves it during vocabulary load and hands it back via these callbacks.
  const [resolvedMovieId, setResolvedMovieId] = useState<number | null>(null);

  // Multi-movie batch journey state.
  const [batch, setBatch] = useState<{ ids: number[]; title: string } | null>(null);

  // Global Journey tab — lands the user on the new multi-section
  // practice screen backed by their Watch Later list. Legacy
  // batch-builder route stays around for the old home button.
  const navigateToJourney = () => {
    // Visiting the reel resets the "new since last visit" badge that
    // RankedMovieList bumps when the user adds a movie from home.
    useReelBadgeStore.getState().clear();
    setCurrentScreen('journey');
  };

  // Single dispatcher for the global 4-tab bar. Every screen feeds its
  // taps through here so navigation stays consistent.
  const [showUserSheet, setShowUserSheet] = useState(false);
  const [barHeight, setBarHeight] = useState(0);

  const handleTabPress = (t: BottomTab) => {
    if (t === 'home') navigateToHome();
    else if (t === 'words') navigateToLists();
    else if (t === 'journey') navigateToJourney();
    else if (t === 'rankings') navigateToLeaderboard();
    else if (t === 'profile') setShowUserSheet((prev) => !prev);
  };

  const handleBatchBuilt = (ids: number[], title: string) => {
    setBatch({ ids, title });
    setCurrentScreen('quizBatchJourney');
  };

  // ── Movie preview hub state ───────────────────────────────────────
  // When the user taps a tile in the Journey Reel, we stash the tile
  // here and route to the 'moviePreview' screen. The hub owns the
  // "Study" / "Quiz me" / "Remove" branches; we keep the active tile
  // around so post-quiz can return to the same hub.
  type ActivePreview = { tile: ReelTile; level: NodeLevel; tileIndex: number };
  const [activePreviewTile, setActivePreviewTile] = useState<ActivePreview | null>(null);

  // Set Intro payload — populated after the hub's Quiz CTA successfully
  // starts a journey session. Held until the user taps "Start learning"
  // (advances to quiz) or backs out.
  type SetIntroPayload = {
    session: QuizStartSessionResponse;
    level: NodeLevel;
    tileIndex: number;
    movie: { title: string; poster_path: string | null };
    setNumber: number;
    reelNumber: number;
  };
  const [setIntroData, setSetIntroData] = useState<SetIntroPayload | null>(null);

  // Tracks where the in-flight quiz came from so we know where to land
  // when the user dismisses the result screen. Set when a journey
  // session is started.
  type QuizSource =
    | { kind: 'reel-preview'; tile: ReelTile; level: NodeLevel; tileIndex: number }
    | { kind: 'movie-detail'; movie: MovieData };
  const quizSourceRef = useRef<QuizSource | null>(null);

  // Spinner shown on the preview hub's Quiz CTA while we wait for the
  // backend to assemble the session payload.
  const [hubQuizStarting, setHubQuizStarting] = useState(false);

  const handleOpenMoviePreview = (payload: MoviePreviewPayload) => {
    setActivePreviewTile({
      tile: payload.tile,
      level: payload.level,
      tileIndex: payload.tileIndex,
    });
    setCurrentScreen('moviePreview');
  };

  // Convert a reel tile into the MovieData shape MovieDetailScreen
  // expects. The reel only has tmdb_id / title / poster_path / year;
  // the rest is filled in later by the detail screen as it fetches.
  const reelTileToMovieData = (tile: ReelTile): MovieData => ({
    id: tile.tmdb_id,
    tmdb_id: tile.tmdb_id,
    title: tile.title,
    poster_path: tile.poster_path,
    release_date: tile.year ? `${tile.year}-01-01` : '',
  });

  const handleHubStudy = () => {
    if (!activePreviewTile) return;
    setSelectedMovie(reelTileToMovieData(activePreviewTile.tile));
    setCurrentScreen('movieDetail');
  };

  const handleHubQuiz = async () => {
    if (!activePreviewTile || hubQuizStarting) return;
    setHubQuizStarting(true);
    const { tile, level, tileIndex } = activePreviewTile;
    try {
      const session = await quizApi.startJourneySession(level, tileIndex, 5, tile.tmdb_id);
      quizSourceRef.current = { kind: 'reel-preview', tile, level, tileIndex };
      setSetIntroData({
        session,
        level,
        tileIndex,
        movie: { title: tile.title, poster_path: tile.poster_path },
        setNumber: tileIndex + 1,
        reelNumber: 1,
      });
      setCurrentScreen('setIntro');
    } catch (err: any) {
      Alert.alert('Could not start quiz', err?.message ?? 'Please try again.');
    } finally {
      setHubQuizStarting(false);
    }
  };

  const handleHubRemove = async () => {
    if (!activePreviewTile) return;
    const tmdbId = activePreviewTile.tile.tmdb_id;
    setActivePreviewTile(null);
    setCurrentScreen('journey');
    try {
      await useReelStore.getState().remove(tmdbId);
    } catch (err: any) {
      Alert.alert('Could not remove', err?.message ?? 'Please try again.');
    }
  };

  const handleHubBack = () => {
    setActivePreviewTile(null);
    setCurrentScreen('journey');
  };

  // Start a journey quiz from the MovieDetailScreen's "Quiz me" pill.
  // Mirrors the hub path but tracks the source so post-quiz returns to
  // the movie-detail screen instead of the preview hub.
  const handleMovieDetailQuiz = async (movie: MovieData, level: NodeLevel) => {
    const tmdbId = movie.tmdb_id ?? movie.id;
    try {
      // tileIndex 0 is safe for the standalone-movie case: it's only
      // used by the backend for offset paging when there's no movie
      // binding, and we always pass tmdbId so the movie-specific path
      // wins.
      const session = await quizApi.startJourneySession(level, 0, 5, tmdbId);
      quizSourceRef.current = { kind: 'movie-detail', movie };
      setSetIntroData({
        session,
        level,
        tileIndex: 0,
        movie: { title: movie.title, poster_path: movie.poster_path ?? null },
        setNumber: 1,
        reelNumber: 1,
      });
      setCurrentScreen('setIntro');
    } catch (err: any) {
      Alert.alert('Could not start quiz', err?.message ?? 'Please try again.');
    }
  };

  const handleSetIntroStart = () => {
    if (!setIntroData) return;
    const { session, level } = setIntroData;
    setSetIntroData(null);
    setQuizSession({ session, level });
    setCurrentScreen('quizLesson');
  };

  const handleSetIntroBack = () => {
    setSetIntroData(null);
    // Drop back to wherever the quiz was started from.
    const src = quizSourceRef.current;
    if (src?.kind === 'movie-detail') {
      setCurrentScreen('movieDetail');
    } else if (activePreviewTile) {
      setCurrentScreen('moviePreview');
    } else {
      setCurrentScreen('journey');
    }
  };


  const handleQuizSessionStart = (session: QuizStartSessionResponse, level: string) => {
    setQuizSession({ session, level });
    setCurrentScreen('quizLesson');
  };

  // Journey-result snapshot — populated up-front in handleQuizComplete
  // so QuizResultScreen renders the post-completion streak/pip values
  // and can decide whether to show the daily-3 wall. Null for non-
  // journey sessions (movie / batch quizzes use the legacy fallback).
  const [journeyResultMeta, setJourneyResultMeta] = useState<{
    completedTileIdx: number;
    dailyDone: number;
    dailyStreak: number;
    justHit3: boolean;
    cardResults: QuizCardResultInput[];
  } | null>(null);

  const handleQuizComplete = (
    result: QuizCompleteResponse,
    level: string,
    cardResults: QuizCardResultInput[] = [],
  ) => {
    // Bump the daily counter NOW so the result screen reads fresh
    // values. Bump for ANY journey-kind quiz (reel-preview AND
    // movie-detail) since they all share the daily-habit loop.
    const src = quizSourceRef.current;
    if (src) {
      const tileIdx = src.kind === 'reel-preview' ? src.tileIndex : 0;
      const bump = useDailyGoalStore.getState().bump();
      setJourneyResultMeta({
        completedTileIdx: tileIdx,
        dailyDone: bump.done,
        dailyStreak: bump.streak,
        justHit3: bump.justHit3,
        cardResults,
      });
    } else {
      setJourneyResultMeta(null);
    }
    setQuizResult({ result, level });
    setCurrentScreen('quizResult');
  };

  const handleQuizResultDone = () => {
    setQuizSession(null);
    setQuizResult(null);
    setJourneyResultMeta(null);
    const src = quizSourceRef.current;
    quizSourceRef.current = null;
    if (src?.kind === 'reel-preview' && activePreviewTile) {
      // Return to the same movie's preview hub so the user sees fresh
      // stars/state for what they just quizzed.
      setCurrentScreen('moviePreview');
      return;
    }
    if (src?.kind === 'movie-detail') {
      setCurrentScreen('movieDetail');
      return;
    }
    if (batch) setCurrentScreen('quizBatchJourney');
    else setCurrentScreen(selectedMovie ? 'quizJourney' : 'home');
  };

  const handleUserUpdated = (updatedUser: any) => {
    // PATCH /auth/me returns a camelCase payload but the app reads snake_case
    // everywhere. Normalize every field we care about so the merged user has
    // the right keys — otherwise edits look like they save but reload back
    // to the old value because `proficiencyLevel` never overwrote
    // `proficiency_level`, the Google avatar vanishes, etc.
    const current: any = useAuthStore.getState().user || {};
    const merged = {
      ...current,
      id: updatedUser.id ?? current.id,
      email: updatedUser.email ?? current.email,
      username: updatedUser.username ?? current.username,
      profile_picture_url:
        updatedUser.profile_picture_url ??
        updatedUser.profilePictureUrl ??
        current.profile_picture_url,
      native_language:
        updatedUser.native_language ??
        updatedUser.nativeLanguage ??
        current.native_language,
      learning_language:
        updatedUser.learning_language ??
        updatedUser.learningLanguage ??
        current.learning_language,
      proficiency_level:
        updatedUser.proficiency_level ??
        updatedUser.proficiencyLevel ??
        current.proficiency_level,
      default_tab:
        updatedUser.default_tab ??
        updatedUser.defaultTab ??
        current.default_tab,
      is_admin:
        updatedUser.is_admin ??
        updatedUser.isAdmin ??
        current.is_admin,
    };
    useAuthStore.getState().setUser(merged);
  };

  if (status === 'loading') {
    return (
      <SafeAreaProvider>
        <StatusBar barStyle={resolvedTheme === "dark" ? "light-content" : "dark-content"} backgroundColor={tc.background} />
        <LoadingScreen />
      </SafeAreaProvider>
    );
  }

  const isAuthenticated = status === 'authenticated' || status === 'offline_authenticated';

  // Derive the active bottom tab from current screen so the bar stays
  // highlighted correctly regardless of where the user navigates.
  const activeTab: BottomTab | null = (() => {
    if (showUserSheet) return 'profile';
    switch (currentScreen) {
      case 'home':
      case 'searchResults': return 'home';
      case 'lists':
      case 'notebook':
      case 'review': return 'words';
      case 'journey':
      case 'moviePreview':
      case 'setIntro': return 'journey';
      case 'leaderboard': return 'rankings';
      default: return null;
    }
  })();

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={resolvedTheme === "dark" ? "light-content" : "dark-content"} backgroundColor={tc.paper} />
      {isAuthenticated ? (
        <View style={{ flex: 1 }}>
        {currentScreen === 'settings' ? (
          <SettingsScreen onBack={navigateToHome} user={user} onUserUpdated={handleUserUpdated} onNavigateToFamilyPlan={navigateToFamilyPlan} onNavigateToPrivacy={navigateToPrivacy} onNavigateToTerms={navigateToTerms} targetLanguage={targetLanguage} setTargetLanguage={setTargetLanguage} />
        ) : currentScreen === 'vocabulary' ? (
          <VocabularyScreen onBack={navigateToHome} onNavigateToLearnedWords={navigateToLearnedWords} />
        ) : currentScreen === 'learnedWords' ? (
          <LearnedWordsScreen onBack={() => setCurrentScreen('vocabulary')} />
        ) : currentScreen === 'admin' ? (
          <AdminScreen onBack={navigateToHome} />
        ) : currentScreen === 'review' ? (
          <ReviewScreen onBack={navigateToHome} onPaywall={navigateToPaywall} />
        ) : currentScreen === 'paywall' ? (
          <PaywallScreen onBack={navigateToHome} previewsUsed={paywallProps.previewsUsed} previewsLimit={paywallProps.previewsLimit} />
        ) : currentScreen === 'stats' ? (
          <StatsScreen onBack={navigateToHome} onStartReview={navigateToReview} />
        ) : currentScreen === 'notebook' ? (
          <NotebookScreen onBack={navigateToLists} filter={listFilter} />
        ) : currentScreen === 'lists' ? (
          <ListsScreen onBack={navigateToHome} onOpenList={navigateToNotebook} />
        ) : currentScreen === 'achievements' ? (
          <AchievementsScreen onBack={navigateToHome} />
        ) : currentScreen === 'leaderboard' ? (
          <LeaderboardScreen onBack={navigateToHome} />
        ) : currentScreen === 'familyPlan' ? (
          <FamilyPlanScreen onBack={navigateToHome} userId={user!.id} />
        ) : currentScreen === 'privacy' ? (
          <PrivacyScreen onBack={navigateToHome} mode="privacy" />
        ) : currentScreen === 'terms' ? (
          <PrivacyScreen onBack={navigateToHome} mode="terms" />
        ) : currentScreen === 'journey' ? (
          <JourneyScreen
            onTabPress={handleTabPress}
            onOpenMoviePreview={handleOpenMoviePreview}
          />
        ) : currentScreen === 'moviePreview' && activePreviewTile ? (
          <MoviePreviewHub
            tile={activePreviewTile.tile}
            level={activePreviewTile.level}
            onBack={handleHubBack}
            onStudy={handleHubStudy}
            onQuiz={handleHubQuiz}
            onRemove={handleHubRemove}
            quizStarting={hubQuizStarting}
          />
        ) : currentScreen === 'setIntro' && setIntroData ? (
          <SetIntroScreen
            setNumber={setIntroData.setNumber}
            reelNumber={setIntroData.reelNumber}
            movie={setIntroData.movie}
            level={setIntroData.level}
            words={setIntroData.session.cards.map<SetIntroWord>((c) => ({
              word: c.word,
              rank: null,
            }))}
            onBack={handleSetIntroBack}
            onStart={handleSetIntroStart}
          />
        ) : currentScreen === 'addToReel' ? (
          <SearchResultsScreen
            query=""
            mode="addToReel"
            onBack={() => setCurrentScreen('journey')}
            onMoviePress={() => {}}
          />
        ) : currentScreen === 'quizJourney' && selectedMovie && resolvedMovieId != null ? (
          <QuizJourneyScreen
            movieId={resolvedMovieId}
            movieTitle={selectedMovie.title}
            onBack={() => setCurrentScreen('movieDetail')}
            onStartSession={handleQuizSessionStart}
          />
        ) : currentScreen === 'quizBatchBuilder' ? (
          <QuizBatchBuilderScreen
            userLevel={user?.proficiency_level}
            onBack={navigateToHome}
            onStart={handleBatchBuilt}
          />
        ) : currentScreen === 'quizBatchJourney' && batch ? (
          <QuizJourneyScreen
            movieIds={batch.ids}
            movieTitle={batch.title}
            onBack={() => setCurrentScreen('quizBatchBuilder')}
            onStartSession={handleQuizSessionStart}
          />
        ) : currentScreen === 'quizLesson' && quizSession ? (
          <QuizLessonScreen
            session={quizSession.session}
            level={quizSession.level}
            onExit={() => {
              setQuizSession(null);
              setCurrentScreen(selectedMovie ? 'quizJourney' : 'home');
            }}
            onComplete={handleQuizComplete}
          />
        ) : currentScreen === 'quizResult' && quizResult ? (
          <QuizResultScreen
            result={quizResult.result}
            level={quizResult.level}
            onDone={handleQuizResultDone}
            journey={journeyResultMeta}
          />
        ) : currentScreen === 'movieDetail' && selectedMovie ? (
          <MovieDetailScreen
            movie={selectedMovie}
            onBack={() => {
              // If we came from the reel preview hub, return there;
              // otherwise drop back to home as before.
              if (activePreviewTile) {
                setCurrentScreen('moviePreview');
              } else {
                navigateToHome();
              }
            }}
            targetLanguage={targetLanguage}
            onStartQuiz={(level) => handleMovieDetailQuiz(selectedMovie, level.toUpperCase() as NodeLevel)}
          />
        ) : currentScreen === 'searchResults' && searchQueryNav ? (
          <SearchResultsScreen query={searchQueryNav} onBack={navigateToHome} onMoviePress={navigateToMovie} />
        ) : (
          <HomeScreen onLogout={logout} onMoviePress={navigateToMovie} onSearch={navigateToSearch} user={user} targetLanguage={targetLanguage} setTargetLanguage={setTargetLanguage} onNavigateToSettings={navigateToSettings} onNavigateToAdmin={navigateToAdmin} onNavigateToReview={navigateToReview} onNavigateToStats={navigateToStats} onNavigateToNotebook={navigateToNotebook} onNavigateToLists={navigateToLists} onNavigateToAchievements={navigateToAchievements} onNavigateToLeaderboard={navigateToLeaderboard} onNavigateToVocabulary={navigateToVocabulary} onNavigateToBatchJourney={navigateToJourney} onNavigateToProfile={() => setShowUserSheet(true)} />
        )}
        <UserMenuSheet
          visible={showUserSheet}
          onClose={() => setShowUserSheet(false)}
          user={user}
          onNavigateToSettings={() => { setShowUserSheet(false); navigateToSettings(); }}
          onNavigateToAdmin={() => { setShowUserSheet(false); navigateToAdmin(); }}
          onNavigateToLists={() => { setShowUserSheet(false); navigateToNotebook(); }}
          onNavigateToVocabulary={() => { setShowUserSheet(false); navigateToVocabulary(); }}
          onNavigateToStats={() => { setShowUserSheet(false); navigateToStats(); }}
          onNavigateToAchievements={() => { setShowUserSheet(false); navigateToAchievements(); }}
          onLogout={() => { setShowUserSheet(false); logout(); }}
          isAdmin={!!user?.is_admin}
          bottomOffset={barHeight}
        />
        <GlobalBottomBar active={activeTab} onTabPress={handleTabPress} onLayout={(h) => setBarHeight(h)} />
        </View>
      ) : (
        <LoginScreen onLogin={handleLogin} />
      )}

      {/* Global poster-flight overlay — animates added-to-reel posters
          from the home card to the Reel tab. */}
      <PosterFlight />

      {/* First-launch splash — absolute over everything, auto-dismisses */}
      <SplashIntro />
    </SafeAreaProvider>
  );
}

