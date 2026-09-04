import React, { useEffect, useRef, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { StatusBar, Alert, Platform, UIManager, View, InteractionManager, BackHandler } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { useAuthStore } from '../stores/authStore';
import { useEntitlementsStore } from '../stores/entitlementsStore';
import { useThemeStore } from '../stores/themeStore';
import { useDailyGoalStore } from '../stores/dailyGoalStore';
import { useOnboardingStore } from '../stores/onboardingStore';
import { useFeedbackPrefsStore, getFeedbackPrefs } from '../stores/feedbackPrefsStore';
import { setPronunciationGate } from '../utils/pronunciation';
import { useThemeColors } from '../theme/tokens';
import { GOOGLE_CLIENT_ID_IOS, GOOGLE_CLIENT_ID_WEB } from '../config/env';
import { AdminScreen } from '../components/AdminScreen';
import { ReviewScreen } from '../components/ReviewScreen';
import { PaywallScreen } from '../components/PaywallScreen';
import type { PaywallReason } from '../components/paywallPricing';
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
import { ExploreScreen } from '../components/ExploreScreen';
import { SavedMoviesScreen } from '../components/SavedMoviesScreen';
import { PracticeScreen } from '../components/PracticeScreen';
import { MoviePreviewHub } from '../components/MoviePreviewHub';
import { SetIntroScreen, type SetIntroWord } from '../components/SetIntroScreen';
import type { ReelTile, SrsSessionStart } from '../services/api';
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
import { useWordFeedStore } from '../stores/wordFeedStore';
import type { Screen, ListFilter, MovieData, ListSummary } from './types';
import { PARENT_OF, PROFILE_SHEET } from './navParents';
import { quizReturnScreen, type QuizOriginKind } from './quizReturn';
import { guardQuizExit, useQuizGuardStore } from '../stores/quizGuardStore';
import { SwipeBackView } from '../components/common/SwipeBackView';
import { LoadingScreen } from '../components/ui/LoadingScreen';
import { SearchResultsScreen } from '../components/screens/SearchResultsScreen';
import { LoginScreen } from '../components/screens/LoginScreen';
import { VocabularyScreen } from '../components/screens/VocabularyScreen';
import { LearnedWordsScreen } from '../components/screens/LearnedWordsScreen';
import { SettingsScreen } from '../components/screens/SettingsScreen';
import { ListsIndexScreen } from '../components/screens/ListsIndexScreen';
import { ListDetailScreen } from '../components/screens/ListDetailScreen';
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

  const { t } = useTranslation();
  const tc = useThemeColors();
  const resolvedTheme = useThemeStore((s) => s.resolved);

  // First-run onboarding gate (Launch §A). We hold the app behind a loader
  // until the store hydrates so a returning user never flashes the flow.
  const onboardingHydrated = useOnboardingStore((s) => s.hydrated);
  const onboardingDone = useOnboardingStore((s) => s.completed);

  // Navigation state
  // The word feed. It is the first tab and the one now labelled "Home", so it
  // is what a launch lands on — a tab bar whose leftmost cell says Home while
  // the app opens on the one beside it reads as a bug.
  const [currentScreen, setCurrentScreen] = useState<Screen>('explore');
  // Base tab the Profile sheet was last opened over, so closing a screen
  // launched from the sheet returns there instead of teleporting to Home.
  const rootTabForSheet = useRef<Screen>('home');
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
    useFeedbackPrefsStore.getState().hydrate();
    // The Sound switch covers word audio too, so the player asks the same
    // preference the chimes do (#179). Injected rather than imported by
    // utils/pronunciation so that module stays free of store dependencies.
    setPronunciationGate(() => getFeedbackPrefs().soundEnabled);
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
  //
  // `language_preference` is the account-level copy of that pin (#98), which is
  // what makes a new install come up in the right language. It is a dependency
  // because it arrives *after* first paint: initialize() shows the cached user
  // immediately and refreshes /auth/me in the background.
  useEffect(() => {
    if (!targetLanguageLoaded) return;
    void hydrateAppLanguage(targetLanguage, user?.language_preference).then((resolved) => {
      // Layout direction is native state fixed when the bridge boots, so a
      // language that disagrees with it only takes effect after a reload. Doing
      // it here, silently, is safe: this runs during startup, before there is
      // any user work on screen to lose. A direction change made later from
      // Settings is prompted for instead.
      if (syncRtlLayout(resolved)) void reloadForRtl();
    });
  }, [targetLanguage, targetLanguageLoaded, user?.language_preference]);

  // Warm the Explore feed during boot instead of on the first tab tap. The
  // tab is lazily mounted (KeepAlive), so without this its first request
  // doesn't even start until the user is already looking at the screen —
  // and that request is the slowest one the app makes. Gated on the restored
  // target language so we never fetch, or cache, a page of translations in
  // the wrong language, and on `user` so a logged-out boot doesn't fire a
  // guaranteed 401. `hydrate` is idempotent, so the Explore screen's own
  // mount effect becomes a no-op when this wins the race.
  useEffect(() => {
    if (!targetLanguageLoaded || !user) return;
    void useWordFeedStore.getState().hydrate(user.proficiency_level, targetLanguage);
  }, [targetLanguageLoaded, user?.proficiency_level, targetLanguage, user]);

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

  // `reason` decides the paywall's subtitle — the daily cap and the legacy
  // preview budget are different sentences, and the daily-cap 402 carries no
  // counts to put in the old one. `origin` is the screen the user was turned
  // away from, so backing out returns them there instead of dropping them on
  // Home: the cap is hit by tapping the Practice coin, and Back sent them to
  // a tab they hadn't asked for.
  const [paywallProps, setPaywallProps] = useState<{
    previewsUsed: number;
    previewsLimit: number;
    reason: PaywallReason;
    origin: Screen;
  }>({ previewsUsed: 0, previewsLimit: 3, reason: null, origin: 'home' });

  // Where a review session came from. The Practice tab and the other
  // entry points (StatsScreen, notification deep links) pass nothing and
  // get the server's `practice` default; only the Lists tab fills these in.
  const [reviewLaunch, setReviewLaunch] = useState<{
    kind?: import('../services/api').SessionKind;
    listId?: number;
    /** Set only by the Lists tab — see ReviewScreen's `initialSession`. */
    session?: SrsSessionStart;
  }>({});

  const navigateToReview = () => {
    setReviewLaunch({});
    setCurrentScreen('review');
  };

  // The Lists tab's gold button already started the session (so the server
  // could 409 an empty pool before we navigate). Hand it straight to
  // ReviewScreen rather than letting it start a second one, which would burn
  // two of a free user's one-per-day sessions.
  const handleListPractice = (session: SrsSessionStart, listId: number) => {
    setReviewLaunch({
      kind: session.kind as import('../services/api').SessionKind,
      listId,
      session,
    });
    setCurrentScreen('review');
  };

  const navigateToPaywall = (
    previewsUsed: number,
    previewsLimit: number,
    reason: PaywallReason = null,
  ) => {
    // Where to return on Back. A review that 402s is launched from Practice
    // (or the open list), and `currentScreen` is still 'review' here because
    // ReviewScreen calls this from its own start-session failure path.
    const origin: Screen =
      currentScreen === 'review'
        ? (reviewLaunch.listId ? 'lists' : 'practice')
        : currentScreen;
    setPaywallProps({ previewsUsed, previewsLimit, reason, origin });
    setCurrentScreen('paywall');
  };

  const leavePaywall = () => setCurrentScreen(paywallProps.origin);

  const navigateToStats = () => {
    setCurrentScreen('stats');
  };

  // Back from a Profile-sheet-launched screen returns to the sheet (its
  // origin) rather than teleporting to Home (UX audit F-006). We drop back to
  // the base tab the sheet was opened over — Home/My Movies/Practice are all
  // mounted under KeepAlive, so that switch is instant and the sheet animates
  // straight back with no Home flash. Deliberately skips navigateToHome's
  // movie/search resets and notification refresh, which caused that flash.
  // Stable identity (it only touches setters and a ref) so the hardware-back
  // effect below can depend on it without re-subscribing every render.
  const backToProfile = useCallback(() => {
    setCurrentScreen(rootTabForSheet.current);
    setShowUserSheet(true);
  }, []);

  const navigateToNotebook = (filter: ListFilter = 'saved') => {
    setListFilter(filter);
    setCurrentScreen('notebook');
  };

  const navigateToLists = () => {
    setCurrentScreen('lists');
  };

  // Which list the detail screen is showing. Held here rather than in the
  // store because it is navigation state, not data — the store keeps the
  // list's contents, App keeps "which one is open".
  const [openList, setOpenList] = useState<ListSummary | null>(null);
  const navigateToListDetail = (list: ListSummary) => {
    setOpenList(list);
    setCurrentScreen('listDetail');
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

  // ── Back navigation for the account area ──────────────────────────
  // On-screen Back and Android's hardware back both resolve through
  // PARENT_OF, so they can't disagree about where a screen returns to.

  /** Navigate to `from`'s parent. False when it has none (not in the map). */
  const goToParent = useCallback((from: Screen): boolean => {
    const parent = PARENT_OF[from];
    if (!parent) return false;
    if (parent === PROFILE_SHEET) backToProfile();
    else setCurrentScreen(parent);
    return true;
  }, [backToProfile]);

  /** `onBack` handler for a screen, derived from its parent. */
  const backFrom = (from: Screen) => () => {
    goToParent(from);
  };

  /** Back-button label — names the destination so Back is never a guess. */
  const backLabelFor = (from: Screen): string => {
    switch (PARENT_OF[from]) {
      case PROFILE_SHEET:
        return t('nav.profile');
      case 'settings':
        return t('settings:title');
      case 'vocabulary':
        return t('vocabulary:screenTitle');
      case 'lists':
        return t('vocabulary:lists.title');
      default:
        return t('action.back');
    }
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
  const navigateToExplore = () => {
    useReelBadgeStore.getState().clear();
    setCurrentScreen('explore');
  };
  const navigateToSavedMovies = () => {
    setCurrentScreen('savedMovies');
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

  /** The one wording for "are you sure you want to leave this deck?". */
  const quizExitCopy = {
    title: t('quiz:review.quitTitle'),
    message: t('quiz:review.quitBody'),
    confirmLabel: t('quiz:review.quitConfirm'),
    cancelLabel: t('quiz:review.quitCancel'),
  };

  const handleTabPress = (tab: BottomTab) => {
    // The profile tab opens a sheet *over* the current screen — the deck stays
    // mounted underneath — so it is not an exit and must not ask.
    if (tab !== 'profile' && useQuizGuardStore.getState().inProgress) {
      guardQuizExit(quizExitCopy, () => handleTabPressUnguarded(tab));
      return;
    }
    handleTabPressUnguarded(tab);
  };

  const handleTabPressUnguarded = (tab: BottomTab) => {
    // Switching to any other tab collapses the profile sheet if it's open.
    if (tab !== 'profile') setShowUserSheet(false);
    // Any tab tap dismisses the notifications sheet.
    setShowNotifSheet(false);
    if (tab === 'home') navigateToHome();
    else if (tab === 'explore') navigateToExplore();
    else if (tab === 'practice') navigateToPractice();
    else if (tab === 'lists') navigateToLists();
    else if (tab === 'profile') {
      setShowUserSheet((prev) => {
        // Remember what the sheet is opening over, so backToProfile can
        // return there rather than to Home.
        if (!prev) {
          rootTabForSheet.current = (['home', 'explore', 'practice', 'lists'] as Screen[]).includes(currentScreen)
            ? currentScreen
            : 'home';
        }
        return !prev;
      });
    }
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
      // An open Explore panel swallows the first back press, exactly as the
      // profile/notification sheets above do.
      if (currentScreen === 'explore' && useWordFeedStore.getState().openPanel) {
        useWordFeedStore.getState().setPanelOpen(null);
        return true;
      }
      // 'explore' is deliberately absent: back from the feed lands on Home
      // rather than exiting the app, since it's a browsing surface rather
      // than the app's root.
      const rootTabs: Screen[] = ['home', 'practice', 'lists'];
      if (authed && !rootTabs.includes(currentScreen)) {
        // Same resolver the header chevron and the edge swipe use, so the
        // hardware button can no longer disagree with them — it used to send
        // every non-account screen to Home, abandoning a quiz mid-flow and
        // stranding its session state.
        const back = resolveBackRef.current(currentScreen);
        if (back) back();
        else navigateToHome();
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

  // Both hub exits return to the reel the hub was opened from. They used to
  // route to the legacy 'journey' screen, which no tab lights up and which
  // renders the Explore feed in its inactive state — so backing out of a film
  // dropped the user on a dead surface instead of the list they came from.
  const handleHubRemove = async () => {
    if (!activePreviewTile) return;
    const tmdbId = activePreviewTile.tile.tmdb_id;
    setActivePreviewTile(null);
    setCurrentScreen('savedMovies');
    try {
      await useReelStore.getState().remove(tmdbId);
    } catch (err: any) {
      showToast({ tone: 'error', message: err?.message ?? 'Could not remove the movie. Please try again.' });
    }
  };

  const handleHubBack = () => {
    setActivePreviewTile(null);
    setCurrentScreen('savedMovies');
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

  // Every way out of the quiz — backing out of the Set Intro, quitting a lesson
  // mid-deck, dismissing the result, Android back, the edge swipe — unwinds
  // through this one function, so no two exits can disagree about where the
  // flow came from. It clears the whole flow's state, not just its own screen's
  // slice: leaving a stale session or source behind is what let the *next*
  // quiz's result screen navigate somewhere the user had never been.
  const leaveQuizFlow = () => {
    const src = quizSourceRef.current;
    quizSourceRef.current = null;
    setSetIntroData(null);
    setQuizSession(null);
    setQuizResult(null);
    setJourneyResultMeta(null);
    // Returning to the preview hub also refreshes the stars/state for the film
    // that was just quizzed, which is why the origin is preferred over Home.
    setCurrentScreen(
      quizReturnScreen({
        origin: (src?.kind ?? null) as QuizOriginKind | null,
        hasPreviewTile: !!activePreviewTile,
        hasSelectedMovie: !!selectedMovie,
      }),
    );
  };

  const handleSetIntroBack = () => leaveQuizFlow();
  const handleQuizExit = () => leaveQuizFlow();
  const handleQuizResultDone = () => leaveQuizFlow();

  const handleMovieDetailBack = () => {
    // If we came from the reel preview hub, return there; otherwise drop back
    // to Home as before.
    if (activePreviewTile) setCurrentScreen('moviePreview');
    else navigateToHome();
  };

  // ── One answer to "where does Back go from here" ──────────────────────
  // `PARENT_OF` already unified the account area, but its answers are static
  // and the flows below choose at runtime (which film, which quiz origin, which
  // list started the review). They stayed hand-wired per call site, so the
  // header chevron, Android's back button and the new edge swipe could each
  // send the user somewhere different from the same screen. Everything now
  // resolves here; `null` means the screen is a root and Back does nothing.
  const resolveBack = (from: Screen): (() => void) | null => {
    switch (from) {
      // Quiz flow — all three exits share leaveQuizFlow.
      case 'setIntro':
        return handleSetIntroBack;
      case 'quizLesson':
        return handleQuizExit;
      case 'quizResult':
        return handleQuizResultDone;
      case 'moviePreview':
        return handleHubBack;
      case 'movieDetail':
        return handleMovieDetailBack;
      case 'searchResults':
        return navigateToHome;
      case 'addToReel':
        return navigateToSavedMovies;
      case 'review': {
        // Back goes to the tile path you launched from, not Home. Home was
        // the old default from before Practice had a path, and it made
        // leaving a lesson feel like leaving the app — you had to find your
        // way back to the tiles to carry on. A list session still returns to
        // its list.
        //
        // Chevron, Android hardware back and the edge swipe all resolve here,
        // so guarding this one place covers all three.
        const leave = reviewLaunch.listId ? navigateToLists : navigateToPractice;
        return () => guardQuizExit(quizExitCopy, leave);
      }
      case 'paywall':
        return leavePaywall;
      // Orphaned by the v0.7 nav and unreachable, but if anything ever lands
      // here there has to be a way out — QuizJourneyScreen renders no back
      // control of its own.
      case 'quizJourney':
        return () => setCurrentScreen('movieDetail');
      case 'quizBatchJourney':
        return () => setCurrentScreen('quizBatchBuilder');
      case 'quizBatchBuilder':
        return navigateToHome;
      default:
        return PARENT_OF[from] ? () => goToParent(from) : null;
    }
  };

  // Read by the hardware-back listener, which is registered once per screen
  // rather than re-subscribed on every render just to see fresh handlers.
  const resolveBackRef = useRef(resolveBack);
  resolveBackRef.current = resolveBack;

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
      // `?? current` is wrong for this one: clearing the app-language pin
      // legitimately sets it to null, and falling back to the old value would
      // put the pin straight back on the next hydrate. PATCH /auth/me now
      // answers with a real UserResponse, so an absent key means "this caller
      // didn't send a user object at all", not "the server had nothing".
      language_preference:
        updatedUser.language_preference !== undefined
          ? updatedUser.language_preference
          : current.language_preference ?? null,
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
      case 'explore':
        return 'explore';
      // The Lists tab owns both its index and any list opened from it.
      case 'lists':
      case 'listDetail':
        return 'lists';
      // The preview hub is only reachable through the saved reel, which now
      // hangs off the Profile sheet — so Profile keeps the highlight. It used
      // to light Home, from a Home entry point that no longer exists.
      case 'moviePreview':
        return 'profile';
      // Practice tab owns the daily SRS habit.
      case 'practice':
      case 'review':
        return 'practice';
      // Set intro / lesson / result are a full-screen flow reached from either
      // the preview hub or a film's detail screen, so no single tab owns them.
      // Lighting Practice was a leftover from when the path started there.
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
      case 'savedMovies':
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
        // Themed ground under every layer. It is what the back swipe uncovers
        // when the screen it dismisses isn't sitting on top of a live tab, so
        // the gesture never flashes a bare white window in dark mode.
        <View style={{ flex: 1, backgroundColor: tc.background }}>
        {/* Persistent bottom-tab layer. Each tab is mounted lazily on first
            visit and then kept alive (hidden via display:none) so switching
            tabs — or opening a detail screen and pressing back — retains its
            scroll position and list/data state instead of remounting. Deep
            screens render in the ternary below, on top of this layer. */}
        <KeepAlive visible={currentScreen === 'home'}>
          <HomeScreen onMoviePress={navigateToMovie} onSearch={navigateToSearch} user={user} targetLanguage={targetLanguage} bottomOffset={barHeight} />
        </KeepAlive>
        {/* Explore keeps its place in KeepAlive so the feed doesn't lose
            its scroll position when the user dips into Profile. */}
        <KeepAlive visible={currentScreen === 'explore' || currentScreen === 'journey'}>
          <ExploreScreen
            active={currentScreen === 'explore'}
            proficiencyLevel={user?.proficiency_level}
            targetLanguage={targetLanguage}
            bottomOffset={barHeight}
          />
        </KeepAlive>
        <KeepAlive visible={currentScreen === 'practice'}>
          <PracticeScreen onStartDailyReview={navigateToReview} active={currentScreen === 'practice'} bottomOffset={barHeight} />
        </KeepAlive>
        {/* Lists keeps its place in KeepAlive so the selected segment and
            scroll position survive a tab switch, same as Home and Explore. */}
        <KeepAlive visible={currentScreen === 'lists'}>
          <ListsIndexScreen
            active={currentScreen === 'lists'}
            onOpenList={navigateToListDetail}
            bottomOffset={barHeight}
          />
        </KeepAlive>

        {/* Deep screens, plus the edge-swipe-back gesture that dismisses them.
            The swipe reads the same `resolveBack` the header chevron and
            Android's back button do, so all three land in the same place; it
            goes inert on a root tab, where the ternary renders nothing. */}
        <SwipeBackView screenKey={currentScreen} onBack={resolveBack(currentScreen)}>
        {currentScreen === 'settings' ? (
          <SettingsScreen onBack={backFrom('settings')} backLabel={backLabelFor('settings')} user={user} onUserUpdated={handleUserUpdated} onNavigateToFamilyPlan={navigateToFamilyPlan} onNavigateToPrivacy={navigateToPrivacy} onNavigateToTerms={navigateToTerms} targetLanguage={targetLanguage} setTargetLanguage={setTargetLanguage} />
        ) : currentScreen === 'vocabulary' ? (
          <VocabularyScreen onBack={backFrom('vocabulary')} backLabel={backLabelFor('vocabulary')} onNavigateToLearnedWords={navigateToLearnedWords} />
        ) : currentScreen === 'learnedWords' ? (
          <LearnedWordsScreen onBack={backFrom('learnedWords')} backLabel={backLabelFor('learnedWords')} />
        ) : currentScreen === 'admin' ? (
          <AdminScreen onBack={backFrom('admin')} backLabel={backLabelFor('admin')} />
        ) : currentScreen === 'review' ? (
          <ReviewScreen
            kind={reviewLaunch.kind}
            listId={reviewLaunch.listId}
            initialSession={reviewLaunch.session}
            // Routed through `resolveBack`, not a second copy of the
            // destination. This prop *was* that second copy — it still said
            // `navigateToHome` after the resolver moved to Practice, and
            // because the header chevron calls it directly it also skipped
            // the quit guard entirely. One resolver, so the chevron, hardware
            // back, the swipe and a tab tap cannot disagree about either
            // where they go or whether they ask first.
            onBack={() => resolveBack('review')?.()}
            onPaywall={navigateToPaywall}
          />
        ) : currentScreen === 'paywall' ? (
          <PaywallScreen
            onBack={leavePaywall}
            previewsUsed={paywallProps.previewsUsed}
            previewsLimit={paywallProps.previewsLimit}
            reason={paywallProps.reason}
          />
        ) : currentScreen === 'stats' ? (
          <StatsScreen onBack={backFrom('stats')} backLabel={backLabelFor('stats')} onStartReview={navigateToReview} />
        ) : currentScreen === 'notebook' ? (
          <NotebookScreen onBack={backFrom('notebook')} backLabel={backLabelFor('notebook')} filter={listFilter} />
        ) : currentScreen === 'listDetail' && openList ? (
          <ListDetailScreen
            list={openList}
            onBack={navigateToLists}
            onStartSession={handleListPractice}
            onOpenFilm={(item) => navigateToMovie({
              id: item.tmdbId,
              title: item.title,
              poster_path: item.posterPath,
              release_date: item.year ? `${item.year}-01-01` : '',
            })}
            onOpenWord={() => navigateToNotebook('saved')}
            onPaywall={() => navigateToPaywall(0, 0)}
            bottomOffset={barHeight}
          />
        ) : currentScreen === 'savedMovies' ? (
          <SavedMoviesScreen
            onBack={backFrom('savedMovies')}
            backLabel={backLabelFor('savedMovies')}
            onSearchPress={() => navigateToSearch('')}
            onOpenMoviePreview={handleOpenMoviePreview}
          />
        ) : currentScreen === 'watched' ? (
          <WatchedScreen onBack={backFrom('watched')} backLabel={backLabelFor('watched')} onMoviePress={navigateToMovie} />
        ) : currentScreen === 'achievements' ? (
          <AchievementsScreen onBack={backFrom('achievements')} backLabel={backLabelFor('achievements')} />
        ) : currentScreen === 'leaderboard' ? (
          <LeaderboardScreen onBack={backFrom('leaderboard')} backLabel={backLabelFor('leaderboard')} />
        ) : currentScreen === 'familyPlan' ? (
          <FamilyPlanScreen onBack={backFrom('familyPlan')} backLabel={backLabelFor('familyPlan')} userId={user!.id} />
        ) : currentScreen === 'privacy' ? (
          <PrivacyScreen onBack={backFrom('privacy')} backLabel={backLabelFor('privacy')} mode="privacy" />
        ) : currentScreen === 'terms' ? (
          <PrivacyScreen onBack={backFrom('terms')} backLabel={backLabelFor('terms')} mode="terms" />
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
            onBack={navigateToSavedMovies}
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
            onExit={handleQuizExit}
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
            onBack={handleMovieDetailBack}
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
        </SwipeBackView>
        <UserMenuSheet
          visible={showUserSheet}
          onClose={() => setShowUserSheet(false)}
          user={user}
          onNavigateToSettings={() => { setShowUserSheet(false); navigateToSettings(); }}
          onNavigateToAdmin={() => { setShowUserSheet(false); navigateToAdmin(); }}
          onNavigateToNotebook={() => { setShowUserSheet(false); navigateToNotebook('saved'); }}
          onNavigateToWatched={() => { setShowUserSheet(false); navigateToWatched(); }}
          onNavigateToSavedMovies={() => { setShowUserSheet(false); navigateToSavedMovies(); }}
          onNavigateToVocabulary={() => { setShowUserSheet(false); navigateToVocabulary(); }}
          onNavigateToStats={() => { setShowUserSheet(false); navigateToStats(); }}
          onNavigateToAchievements={() => { setShowUserSheet(false); navigateToAchievements(); }}
          onNavigateToLeaderboard={() => { setShowUserSheet(false); navigateToLeaderboard(); }}
          onNavigateToNotifications={() => { setShowUserSheet(false); setShowNotifSheet(true); }}
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
        <GlobalBottomBar active={activeTab} onTabPress={handleTabPress} onHeightChange={setBarHeight} />
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

