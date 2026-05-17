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
import { JourneyScreen, type SetIntroPayload } from '../components/JourneyScreen';
import { SetIntroScreen, type SetIntroWord } from '../components/SetIntroScreen';
import { UserMenuSheet } from '../components/UserMenuSheet';
import { SplashIntro } from '../components/SplashIntro';
import { GlobalBottomBar, type BottomTab } from '../components/GlobalBottomBar';
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

  // Journey tile progress — persisted to AsyncStorage so it survives
  // cold starts. Streaks, daily goals, and the "Up next" teaser all
  // depend on this being durable. Backend mirror is a follow-up.
  const [journeyCompletedCount, setJourneyCompletedCount] = useState(0);
  const [journeyProgressHydrated, setJourneyProgressHydrated] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem('journey.completedCount').then((v) => {
      if (v) {
        const n = parseInt(v, 10);
        if (Number.isFinite(n) && n >= 0) setJourneyCompletedCount(n);
      }
      setJourneyProgressHydrated(true);
    }).catch(() => setJourneyProgressHydrated(true));
  }, []);
  // Which tile index was active when the quiz started; incremented on return.
  const journeyTileInProgressRef = useRef<number | null>(null);

  // Set Intro payload — populated when the user taps the active tile and
  // we've successfully started a journey session. Held until the user
  // taps "Start learning" (advances to quiz) or backs out.
  const [setIntroData, setSetIntroData] = useState<SetIntroPayload | null>(null);

  const handleJourneySessionStart = (session: QuizStartSessionResponse, level: string, tileIndex: number) => {
    journeyTileInProgressRef.current = tileIndex;
    setQuizSession({ session, level });
    setCurrentScreen('quizLesson');
  };

  const handleShowSetIntro = (payload: SetIntroPayload) => {
    setSetIntroData(payload);
    setCurrentScreen('setIntro');
  };

  const handleSetIntroStart = () => {
    if (!setIntroData) return;
    const { session, level, tileIndex } = setIntroData;
    setSetIntroData(null);
    handleJourneySessionStart(session, level, tileIndex);
  };

  const handleSetIntroBack = () => {
    setSetIntroData(null);
    setCurrentScreen('journey');
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
    upNext: {
      tileIdx: number;
      label: number;
      movie: string;
      poster: string | null;
    } | null;
  } | null>(null);

  const handleQuizComplete = (
    result: QuizCompleteResponse,
    level: string,
    cardResults: QuizCardResultInput[] = [],
  ) => {
    // Bump persisted progress + the daily counter NOW so the result
    // screen reads fresh values. handleQuizResultDone only handles
    // navigation after the user dismisses.
    if (journeyTileInProgressRef.current !== null) {
      const completedIdx = journeyTileInProgressRef.current;
      setJourneyCompletedCount((n) => {
        const next = Math.max(n, completedIdx + 1);
        AsyncStorage.setItem('journey.completedCount', String(next)).catch(() => {});
        return next;
      });
      const bump = useDailyGoalStore.getState().bump();
      // Compute "Up next" from the current reel snapshot. The tile
      // *after* the one the user just finished becomes the next active.
      const nextIdx = completedIdx + 1;
      const reelTiles = useReelStore.getState().tiles;
      const nextTile = reelTiles[nextIdx];
      const upNext = nextTile
        ? {
            tileIdx: nextIdx,
            label: nextIdx + 1,
            movie: nextTile.title,
            poster: nextTile.poster_path ?? null,
          }
        : null;
      setJourneyResultMeta({
        completedTileIdx: completedIdx,
        dailyDone: bump.done,
        dailyStreak: bump.streak,
        justHit3: bump.justHit3,
        cardResults,
        upNext,
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
    if (journeyTileInProgressRef.current !== null) {
      journeyTileInProgressRef.current = null;
      setCurrentScreen('journey');
      return;
    }
    if (batch) setCurrentScreen('quizBatchJourney');
    else setCurrentScreen(selectedMovie ? 'quizJourney' : 'home');
  };

  // Chain directly into the next active tile's Set Intro instead of
  // dropping back to the reel. Only available in journey mode and only
  // when there IS a next tile loaded. After the daily-3 wall this is
  // surfaced as the secondary "+1 bonus tile" path.
  const handleJourneyNextSet = useCallback(async () => {
    if (!journeyResultMeta?.upNext) return;
    const nextTile = useReelStore.getState().tiles[journeyResultMeta.upNext.tileIdx];
    if (!nextTile) return;
    const nextIdx = journeyResultMeta.upNext.tileIdx;
    const nextLevel = (user?.proficiency_level || 'A1').toUpperCase();
    try {
      const session = await quizApi.startJourneySession(nextLevel, nextIdx, 5, nextTile.tmdb_id);
      setQuizSession(null);
      setQuizResult(null);
      setJourneyResultMeta(null);
      handleShowSetIntro({
        session,
        level: nextLevel as any,
        tileIndex: nextIdx,
        movie: { title: nextTile.title, poster_path: nextTile.poster_path },
        setNumber: nextIdx + 1,
        reelNumber: 1,
      });
    } catch (err: any) {
      Alert.alert('Could not start next set', err?.message ?? 'Please try again.');
    }
  }, [journeyResultMeta, user?.proficiency_level]);

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
            completedCount={journeyProgressHydrated ? journeyCompletedCount : -1}
            onShowSetIntro={handleShowSetIntro}
            onAddMovies={() => setCurrentScreen('addToReel')}
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
            onNextSet={journeyResultMeta?.upNext ? handleJourneyNextSet : undefined}
          />
        ) : currentScreen === 'movieDetail' && selectedMovie ? (
          <MovieDetailScreen
            movie={selectedMovie}
            onBack={navigateToHome}
            targetLanguage={targetLanguage}
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

      {/* First-launch splash — absolute over everything, auto-dismisses */}
      <SplashIntro />
    </SafeAreaProvider>
  );
}

