import React, { useEffect, useRef, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar, Alert, Platform, UIManager, View, InteractionManager, BackHandler } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { useAuthStore } from '../stores/authStore';
import { useEntitlementsStore } from '../stores/entitlementsStore';
import { useThemeStore } from '../stores/themeStore';
import { useDailyGoalStore } from '../stores/dailyGoalStore';
import { useOnboardingStore } from '../stores/onboardingStore';
import { useThemeColors } from '../theme/tokens';
import { GOOGLE_CLIENT_ID_IOS, GOOGLE_CLIENT_ID_WEB } from '../config/env';
import { AdminScreen } from '../components/AdminScreen';
import { ReviewScreen } from '../components/ReviewScreen';
import { PaywallScreen } from '../components/PaywallScreen';
import { StatsScreen } from '../components/StatsScreen';
import { NotebookScreen } from '../components/NotebookScreen';
import { registerForPushNotifications, scheduleWordReminder, scheduleReviewReminder } from '../services/notifications';
import { track } from '../services/analytics';
import { AchievementsScreen } from '../components/AchievementsScreen';
import { LeaderboardScreen } from '../components/LeaderboardScreen';
import { FamilyPlanScreen } from '../components/FamilyPlanScreen';
import { PrivacyScreen } from '../components/PrivacyScreen';
import { QuizJourneyScreen } from '../components/QuizJourneyScreen';
import { QuizLessonScreen } from '../components/QuizLessonScreen';
import { QuizResultScreen } from '../components/QuizResultScreen';
import { QuizBatchBuilderScreen } from '../components/QuizBatchBuilderScreen';
import type { MoviePreviewPayload } from '../components/journey/sharedTypes';
import { MyMoviesScreen } from '../components/MyMoviesScreen';
import { PracticeScreen } from '../components/PracticeScreen';
import { MoviePreviewHub } from '../components/MoviePreviewHub';
import { SetIntroScreen, type SetIntroWord } from '../components/SetIntroScreen';
import type { ReelTile } from '../services/api';
import type { NodeLevel } from '../components/journey/JourneyNode';
import { UserMenuSheet } from '../components/UserMenuSheet';
import { NotificationsSheet } from '../components/NotificationsSheet';
import { useNotificationsStore, type NotificationTarget } from '../stores/notificationsStore';
import { SplashIntro } from '../components/SplashIntro';
import { GlobalBottomBar, type BottomTab } from '../components/GlobalBottomBar';
import { KeepAlive } from '../components/KeepAlive';
import { OnboardingFlow } from '../components/onboarding/OnboardingFlow';
import { AddFilmFlow } from '../components/movies/AddFilmFlow';
import { ToastHost } from '../components/common/Toast';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { showToast } from '../stores/toastStore';
import { PosterFlight } from '../components/PosterFlight';
import { useReelBadgeStore } from '../stores/reelBadgeStore';
import { quizApi, setOnSessionExpired, type QuizStartSessionResponse, type QuizCompleteResponse, type QuizCardResultInput } from '../services/api';
import { useReelStore } from '../stores/reelStore';
import type { Screen, ListFilter, MovieData } from './types';
import { LoadingScreen } from '../components/ui/LoadingScreen';
import { SearchResultsScreen } from '../components/screens/SearchResultsScreen';
import { LoginScreen } from '../components/screens/LoginScreen';
import { VocabularyScreen } from '../components/screens/VocabularyScreen';
import { LearnedWordsScreen } from '../components/screens/LearnedWordsScreen';
import { SettingsScreen } from '../components/screens/SettingsScreen';
import { ListsScreen } from '../components/screens/ListsScreen';
import { WatchedScreen } from '../components/screens/WatchedScreen';
import { HomeScreen } from '../components/screens/HomeScreen';
import { MovieDetailScreen } from '../components/screens/MovieDetailScreen';
import { initI18n, hydrateAppLanguage } from '../i18n';
import { syncRtlLayout, reloadForRtl } from '../i18n/rtl';

// Bring up i18next before the first render so no screen ever paints raw
// translation keys. The real language is resolved a moment later by
// hydrateAppLanguage (it needs AsyncStorage, which is async); English is the
// correct thing to show for that one frame.
initI18n();

// Android requires opt-in for LayoutAnimation; iOS is on by default.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

GoogleSignin.configure({
  iosClientId: GOOGLE_CLIENT_ID_IOS,
  // Required on Android to receive an idToken (audience = web client, which
  // the backend verifies as GOOGLE_CLIENT_ID). iOS keeps using iosClientId.
  webClientId: GOOGLE_CLIENT_ID_WEB,
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

  // First-run onboarding gate (Launch §A). We hold the app behind a loader
  // until the store hydrates so a returning user never flashes the flow.
  const onboardingHydrated = useOnboardingStore((s) => s.hydrated);
  const onboardingDone = useOnboardingStore((s) => s.completed);

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

  // When a token refresh fails (refresh token expired/revoked), tear the
  // session down so the user lands on the login screen instead of silently
  // hitting empty/401 responses everywhere.
  useEffect(() => {
    setOnSessionExpired(() => {
      void useAuthStore.getState().logout();
    });
  }, []);

  useEffect(() => {
    initialize();
    // Hydrate the admin preview toggle from AsyncStorage so a refresh
    // doesn't reset an admin's "viewing as free" selection.
    useEntitlementsStore.getState().hydrate();
    useThemeStore.getState().hydrate();
    useDailyGoalStore.getState().hydrate();
    useOnboardingStore.getState().hydrate();
    track('app_open');
    // Defer notification setup until after first paint/interactions so it never
    // contends with getting the user to the home screen (playbook §4). Push
    // registration touches native permissions + network and is non-critical to
    // render. registerForPushNotifications is a no-op on simulator.
    const task = InteractionManager.runAfterInteractions(() => {
      registerForPushNotifications().then(() => {
        scheduleWordReminder();
        scheduleReviewReminder();
      }).catch(() => {});
    });
    return () => task.cancel();
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

  // App UI language follows the translation language, so picking Spanish in
  // onboarding gives a Spanish interface without asking a second question.
  // hydrateAppLanguage re-checks the Settings pin on every run, so a user who
  // explicitly chose a UI language keeps it when they change translations.
  // Gated on targetLanguageLoaded so we derive from the *restored* value rather
  // than the 'ES' initial state.
  useEffect(() => {
    if (!targetLanguageLoaded) return;
    void hydrateAppLanguage(targetLanguage).then((resolved) => {
      // Layout direction is native state fixed when the bridge boots, so a
      // language that disagrees with it only takes effect after a reload. Doing
      // it here, silently, is safe: this runs during startup, before there is
      // any user work on screen to lose. A direction change made later from
      // Settings is prompted for instead.
      if (syncRtlLayout(resolved)) void reloadForRtl();
    });
  }, [targetLanguage, targetLanguageLoaded]);

  const handleLogin = async (user: any, token: string, refreshToken: string) => {
    await login(user, token, refreshToken);
  };

  // Explicit logout also clears the native Google session. Without this the
  // Google SDK keeps the last account signed in, so the next "Sign in with
  // Google" silently reuses it instead of showing the account chooser. Guarded
  // because non-Google users (Apple/email) have no Google session to clear.
  const handleLogout = async () => {
    setShowUserSheet(false);
    try {
      await GoogleSignin.signOut();
    } catch {
      // No active Google session (Apple/email login) — nothing to clear.
    }
    await logout();
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
    // Home stays mounted under KeepAlive, so its mount-time refresh won't
    // re-run — recompute here so the bell dot reflects e.g. a just-finished
    // review session.
    void useNotificationsStore.getState().refresh();
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

  // v0.7.2 — when the Practice screen launches a review it passes the
  // tile kind (+ optional movie id for Deep-Dive). Legacy callers
  // (StatsScreen, HomeScreen) pass nothing → falls through to
  // quick_recall server-side.
  const [reviewLaunch, setReviewLaunch] = useState<{
    kind?: import('../services/api').SessionKind;
    movieId?: number;
  }>({});

  const navigateToReview = (
    kind?: import('../services/api').SessionKind,
    movieId?: number,
  ) => {
    setReviewLaunch({ kind, movieId });
    setCurrentScreen('review');
  };

  const navigateToPaywall = (previewsUsed: number, previewsLimit: number) => {
    setPaywallProps({ previewsUsed, previewsLimit });
    setCurrentScreen('paywall');
  };

  const navigateToStats = () => {
    setCurrentScreen('stats');
  };

  // Back from a Profile-sheet-launched screen returns to the sheet (its
  // origin) rather than teleporting to Home (UX audit F-006).
  const backToProfile = () => {
    navigateToHome();
    setShowUserSheet(true);
  };

  const navigateToNotebook = (filter: ListFilter = 'saved') => {
    setListFilter(filter);
    setCurrentScreen('notebook');
  };

  const navigateToLists = () => {
    setCurrentScreen('lists');
  };

  const navigateToWatched = () => {
    setCurrentScreen('watched');
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
    /** v0.7 §7 — movie title for the QuizHeader chip. Captured at
     *  setQuizSession time because by the time the lesson renders the
     *  upstream context (setIntroData, preview tile) is usually cleared. */
    movieTitle?: string;
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

  // v0.7: navigation targets for the new two-tab world.
  const navigateToMyMovies = () => {
    useReelBadgeStore.getState().clear();
    setCurrentScreen('movies');
  };
  const navigateToPractice = () => {
    setCurrentScreen('practice');
  };

  // Single dispatcher for the global 4-tab bar. Every screen feeds its
  // taps through here so navigation stays consistent.
  const [showUserSheet, setShowUserSheet] = useState(false);
  const [showNotifSheet, setShowNotifSheet] = useState(false);
  const [barHeight, setBarHeight] = useState(0);

  // Bell-tap targets: notifications deep-link into the practice loop.
  const handleNotificationNavigate = (target: NotificationTarget) => {
    if (target === 'review') navigateToReview();
    else navigateToPractice();
  };

  const handleTabPress = (t: BottomTab) => {
    // Switching to any other tab collapses the profile sheet if it's open.
    if (t !== 'profile') setShowUserSheet(false);
    // Any tab tap dismisses the notifications sheet.
    setShowNotifSheet(false);
    if (t === 'home') navigateToHome();
    else if (t === 'movies') navigateToMyMovies();
    else if (t === 'practice') navigateToPractice();
    else if (t === 'profile') setShowUserSheet((prev) => !prev);
  };

  // Android hardware back — map it to in-app navigation so it never exits the
  // app mid-flow from a deep screen (UX audit F-036). No-op on iOS.
  useEffect(() => {
    const authed = status === 'authenticated' || status === 'offline_authenticated';
    const onHardwareBack = () => {
      if (showNotifSheet) {
        setShowNotifSheet(false);
        return true;
      }
      if (showUserSheet) {
        setShowUserSheet(false);
        return true;
      }
      const rootTabs: Screen[] = ['home', 'movies', 'journey', 'practice'];
      if (authed && !rootTabs.includes(currentScreen)) {
        navigateToHome();
        return true;
      }
      return false; // on a root tab (or login) — let Android do its default
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);
    return () => sub.remove();
  }, [currentScreen, showUserSheet, showNotifSheet, status]);

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
      // Transient async failure — toast (Motion §E5), not a blocking alert.
      showToast({ tone: 'error', message: err?.message ?? 'Could not start the quiz. Please try again.' });
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
      showToast({ tone: 'error', message: err?.message ?? 'Could not remove the movie. Please try again.' });
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
      showToast({ tone: 'error', message: err?.message ?? 'Could not start the quiz. Please try again.' });
    }
  };

  const handleSetIntroStart = () => {
    if (!setIntroData) return;
    const { session, level, movie } = setIntroData;
    setSetIntroData(null);
    setQuizSession({ session, level, movieTitle: movie.title });
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
    setQuizSession({
      session,
      level,
      movieTitle: selectedMovie?.title ?? activePreviewTile?.tile.title,
    });
    setCurrentScreen('quizLesson');
  };

  // Journey-result snapshot — populated up-front in handleQuizComplete
  // so QuizResultScreen renders the post-completion streak/pip values
  // Per-tile movie-quiz result metadata. Under v0.6 these quizzes are an
  // optional drill — the daily habit anchor moved to the SRS review
  // (ReviewScreen), which is where the streak gets bumped. We still read
  // the current daily state so the result screen can show the streak/pip
  // context, but we don't trigger a bump from here.
  const [journeyResultMeta, setJourneyResultMeta] = useState<{
    completedTileIdx: number;
    dailyDone: number;
    dailyStreak: number;
    justHitGoal: boolean;
    cardResults: QuizCardResultInput[];
  } | null>(null);

  const handleQuizComplete = (
    result: QuizCompleteResponse,
    level: string,
    cardResults: QuizCardResultInput[] = [],
  ) => {
    const src = quizSourceRef.current;
    if (src) {
      const tileIdx = src.kind === 'reel-preview' ? src.tileIndex : 0;
      const daily = useDailyGoalStore.getState();
      setJourneyResultMeta({
        completedTileIdx: tileIdx,
        dailyDone: daily.done,
        dailyStreak: daily.streak,
        justHitGoal: false,  // never celebrate the wall here; that's ReviewScreen's job
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
  // v0.7 4-tab map: Home · My Movies · Practice · Profile.
  const activeTab: BottomTab | null = (() => {
    if (showUserSheet) return 'profile';
    switch (currentScreen) {
      case 'home':
      case 'searchResults':
        return 'home';
      case 'movies':
      case 'moviePreview':
        return 'movies';
      // Practice tab owns the daily SRS habit + per-movie lesson nodes.
      // Set intro / quiz / review all originate from Practice now.
      case 'practice':
      case 'setIntro':
      case 'review':
        return 'practice';
      // Account / profile-area screens are all reached from the Profile sheet,
      // so keep the Profile tab lit while they're open (UX audit F-006).
      case 'settings':
      case 'stats':
      case 'achievements':
      case 'leaderboard':
      case 'vocabulary':
      case 'learnedWords':
      case 'notebook':
      case 'lists':
      case 'admin':
      case 'familyPlan':
      case 'privacy':
      case 'terms':
        return 'profile';
      default:
        return null;
    }
  })();

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={resolvedTheme === "dark" ? "light-content" : "dark-content"} backgroundColor={tc.paper} />
      {isAuthenticated && !onboardingHydrated ? (
        // Authenticated but onboarding state hasn't loaded yet — hold on a
        // loader so we never flash the first-run flow at a returning user.
        <LoadingScreen />
      ) : isAuthenticated && !onboardingDone ? (
        <OnboardingFlow initialLanguage={targetLanguage} onLanguageChange={setTargetLanguage} />
      ) : isAuthenticated ? (
        <View style={{ flex: 1 }}>
        {/* Persistent bottom-tab layer. Each tab is mounted lazily on first
            visit and then kept alive (hidden via display:none) so switching
            tabs — or opening a detail screen and pressing back — retains its
            scroll position and list/data state instead of remounting. Deep
            screens render in the ternary below, on top of this layer. */}
        <KeepAlive visible={currentScreen === 'home'}>
          <HomeScreen onMoviePress={navigateToMovie} onSearch={navigateToSearch} user={user} targetLanguage={targetLanguage} onOpenNotifications={() => setShowNotifSheet(true)} />
        </KeepAlive>
        <KeepAlive visible={currentScreen === 'movies' || currentScreen === 'journey'}>
          <MyMoviesScreen
            onSearchPress={() => navigateToSearch('')}
            onOpenMoviePreview={handleOpenMoviePreview}
          />
        </KeepAlive>
        <KeepAlive visible={currentScreen === 'practice'}>
          <PracticeScreen onStartDailyReview={navigateToReview} active={currentScreen === 'practice'} />
        </KeepAlive>

        {currentScreen === 'settings' ? (
          <SettingsScreen onBack={backToProfile} user={user} onUserUpdated={handleUserUpdated} onNavigateToFamilyPlan={navigateToFamilyPlan} onNavigateToPrivacy={navigateToPrivacy} onNavigateToTerms={navigateToTerms} targetLanguage={targetLanguage} setTargetLanguage={setTargetLanguage} />
        ) : currentScreen === 'vocabulary' ? (
          <VocabularyScreen onBack={backToProfile} onNavigateToLearnedWords={navigateToLearnedWords} />
        ) : currentScreen === 'learnedWords' ? (
          <LearnedWordsScreen onBack={() => setCurrentScreen('vocabulary')} />
        ) : currentScreen === 'admin' ? (
          <AdminScreen onBack={navigateToHome} />
        ) : currentScreen === 'review' ? (
          <ReviewScreen
            kind={reviewLaunch.kind}
            movieId={reviewLaunch.movieId}
            onBack={navigateToHome}
            onPaywall={navigateToPaywall}
          />
        ) : currentScreen === 'paywall' ? (
          <PaywallScreen onBack={navigateToHome} previewsUsed={paywallProps.previewsUsed} previewsLimit={paywallProps.previewsLimit} />
        ) : currentScreen === 'stats' ? (
          <StatsScreen onBack={backToProfile} onStartReview={navigateToReview} />
        ) : currentScreen === 'notebook' ? (
          <NotebookScreen onBack={navigateToLists} filter={listFilter} />
        ) : currentScreen === 'lists' ? (
          <ListsScreen onBack={backToProfile} onOpenList={navigateToNotebook} onOpenWatched={navigateToWatched} />
        ) : currentScreen === 'watched' ? (
          <WatchedScreen onBack={navigateToLists} onMoviePress={navigateToMovie} />
        ) : currentScreen === 'achievements' ? (
          <AchievementsScreen onBack={backToProfile} />
        ) : currentScreen === 'leaderboard' ? (
          <LeaderboardScreen onBack={backToProfile} />
        ) : currentScreen === 'familyPlan' ? (
          <FamilyPlanScreen onBack={navigateToHome} userId={user!.id} />
        ) : currentScreen === 'privacy' ? (
          <PrivacyScreen onBack={navigateToHome} mode="privacy" />
        ) : currentScreen === 'terms' ? (
          <PrivacyScreen onBack={navigateToHome} mode="terms" />
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
            movieTitle={quizSession.movieTitle}
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
          // Home, My Movies and Practice are rendered by the persistent
          // KeepAlive layer above, so the deep-screen ternary renders
          // nothing for them — the live tab shows through.
          null
        )}
        <UserMenuSheet
          visible={showUserSheet}
          onClose={() => setShowUserSheet(false)}
          user={user}
          onNavigateToSettings={() => { setShowUserSheet(false); navigateToSettings(); }}
          onNavigateToAdmin={() => { setShowUserSheet(false); navigateToAdmin(); }}
          onNavigateToLists={() => { setShowUserSheet(false); navigateToLists(); }}
          onNavigateToVocabulary={() => { setShowUserSheet(false); navigateToVocabulary(); }}
          onNavigateToStats={() => { setShowUserSheet(false); navigateToStats(); }}
          onNavigateToAchievements={() => { setShowUserSheet(false); navigateToAchievements(); }}
          onNavigateToLeaderboard={() => { setShowUserSheet(false); navigateToLeaderboard(); }}
          onLogout={handleLogout}
          isAdmin={!!user?.is_admin}
          bottomOffset={barHeight}
        />
        <NotificationsSheet
          visible={showNotifSheet}
          onClose={() => setShowNotifSheet(false)}
          onNavigate={handleNotificationNavigate}
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

      {/* Add-a-film analyzing → reel-ready overlay (Add-a-film §B) */}
      <AddFilmFlow />

      {/* Transient confirmation toasts (Motion §E5) */}
      <ToastHost />

      {/* Themed confirm dialogs (logout, delete account, …) — honors the
          in-app light/dark theme, unlike a native Alert. */}
      <ConfirmDialog />

      {/* First-launch splash — absolute over everything, auto-dismisses */}
      <SplashIntro />
    </SafeAreaProvider>
  );
}

