import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  StatusBar,
  TextInput,
  ScrollView,
  Image,
  ImageBackground,
  ActivityIndicator,
  FlatList,
  Animated,
  Modal,
  Alert,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { useAuthStore } from '../stores/authStore';
import { useEntitlementsStore, useShowAds, useIsPremium } from '../stores/entitlementsStore';
import { wordwiseApi, tmdbApi, srsApi, premiumApi, API_BASE_URL, type VocabularyResponse, type WordInfo, type IdiomInfo, type TodaysWord, type CrossMovieSentence } from '../services/api';
import { GOOGLE_CLIENT_ID_IOS } from '../config/env';
import { ReportDialog } from '../components/ReportDialog';
import { AdminScreen } from '../components/AdminScreen';
import { ReviewScreen } from '../components/ReviewScreen';
import { PaywallScreen } from '../components/PaywallScreen';
import { StatsScreen } from '../components/StatsScreen';
import { NotebookScreen } from '../components/NotebookScreen';
import { offlineCache } from '../services/offlineCache';
import { registerForPushNotifications, scheduleDailyWordReminder, scheduleReviewReminder } from '../services/notifications';
import { AchievementsScreen } from '../components/AchievementsScreen';
import { LeaderboardScreen } from '../components/LeaderboardScreen';
import { FamilyPlanScreen } from '../components/FamilyPlanScreen';
import { PrivacyScreen } from '../components/PrivacyScreen';
import { initializeBilling } from '../services/billing';

// Configure Google Sign-In
console.log('[Google Sign-In] Configuring with iOS Client ID:', GOOGLE_CLIENT_ID_IOS);
GoogleSignin.configure({
  iosClientId: GOOGLE_CLIENT_ID_IOS,
  scopes: ['profile', 'email'],
});
console.log('[Google Sign-In] Configuration complete');

// Types for navigation
type Screen = 'home' | 'movieDetail' | 'searchResults' | 'settings' | 'admin' | 'review' | 'paywall' | 'stats' | 'notebook' | 'achievements' | 'leaderboard' | 'familyPlan' | 'privacy' | 'terms';
interface MovieData {
  id: number;
  title: string;
  poster_path: string | null;
  release_date: string;
  overview?: string;
  genre_ids?: number[];
  vote_average?: number;
  original_language?: string;
}

// TMDB genre ID to name mapping
const tmdbGenres: Record<number, string> = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
  27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance',
  878: 'Sci-Fi', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
};

// Colors from web app
const colors = {
  primary: '#7C5CBF',
  primaryLight: '#9B7ED9',
  secondary: '#E07A5F',
  background: '#FAFAF8',
  paper: '#FFFFFF',
  text: '#2D3142',
  textSecondary: '#5C6378',
  border: '#E8E8EC',
  success: '#4CAF9A',
  warning: '#F4A261',
  error: '#D66A6A',
};

// CEFR level colors
const cefrColors: Record<string, string> = {
  A1: '#4CAF50',  // Green - Beginner
  A2: '#8BC34A',  // Light Green
  B1: '#FFC107',  // Amber - Intermediate
  B2: '#FF9800',  // Orange
  C1: '#F44336',  // Red - Advanced
  C2: '#9C27B0',  // Purple
};

const cefrLabels: Record<string, string> = {
  A1: 'Beginner',
  A2: 'Elementary',
  B1: 'Intermediate',
  B2: 'Upper Int.',
  C1: 'Advanced',
  C2: 'Mastery',
  IDIOMS: 'Idioms & Phrases',
};


// Login Screen
const LoginScreen = ({ onLogin }: { onLogin: (user: any, token: string) => void }) => {
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGoogleSignIn = async () => {
    console.log('[Google Sign-In] Button pressed, starting sign-in flow...');
    setError('');
    setGoogleLoading(true);

    try {
      console.log('[Google Sign-In] Calling GoogleSignin.signIn()...');
      // Sign in with Google (no hasPlayServices check needed for iOS)
      const signInResult = await GoogleSignin.signIn();
      console.log('[Google Sign-In] signIn() completed');

      console.log('[Google Sign-In] Result:', JSON.stringify(signInResult, null, 2));

      // Handle different response formats from the library
      const userData = signInResult.data?.user || signInResult.user || signInResult.data;
      if (!userData) {
        throw new Error('No user data received from Google');
      }

      // Get the ID token - try multiple approaches
      let idToken = signInResult.data?.idToken || signInResult.idToken;

      // If no idToken in result, try to get tokens separately
      if (!idToken) {
        try {
          const tokens = await GoogleSignin.getTokens();
          idToken = tokens.idToken || tokens.accessToken;
        } catch (tokenErr) {
          console.log('[Google Sign-In] Could not get tokens separately:', tokenErr);
        }
      }

      const email = userData.email;
      const name = userData.name || userData.givenName;
      const photo = userData.photo;
      const googleId = userData.id;

      console.log('[Google Sign-In] User data:', { email, name, photo, googleId, hasIdToken: !!idToken });

      // Send to backend for login/registration
      const { config } = await import('../config/env');
      console.log('[Google Sign-In] Calling backend:', `${config.API_URL}/auth/google/login`);

      const backendResponse = await fetch(`${config.API_URL}/auth/google/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_token: idToken,
          email,
          name,
          picture: photo,
          google_id: googleId,
        }),
      });

      console.log('[Google Sign-In] Backend response status:', backendResponse.status);
      const data = await backendResponse.json();
      console.log('[Google Sign-In] Backend response data:', data);

      if (!backendResponse.ok) {
        throw new Error(data.detail || 'Google login failed');
      }

      // Map backend user format to app user format
      const user = {
        id: data.user.id,
        email: data.user.email,
        username: data.user.username,
        profile_picture_url: data.user.profile_picture_url || data.user.profilePictureUrl,
        native_language: data.user.native_language || data.user.nativeLanguage || 'en',
        learning_language: data.user.learning_language || data.user.learningLanguage || 'es',
        proficiency_level: data.user.proficiency_level || data.user.proficiencyLevel || 'B1',
        default_tab: (data.user.default_tab || data.user.defaultTab || 'movies') as 'movies' | 'books',
        is_admin: data.user.is_admin || data.user.isAdmin || false,
      };

      onLogin(user, data.access_token || data.token);
    } catch (err: any) {
      console.log('[Google Sign-In] Error:', err.code, err.message, err);
      if (err.code === statusCodes.SIGN_IN_CANCELLED) {
        setError('Sign-in cancelled');
      } else if (err.code === statusCodes.IN_PROGRESS) {
        setError('Sign-in already in progress');
      } else {
        setError(err.message || 'Google sign-in failed');
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleAuth = async () => {
    if (!email || !password || (!isLoginMode && !username)) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { config } = await import('../config/env');
      const endpoint = isLoginMode ? '/auth/login' : '/auth/register';
      const body = isLoginMode
        ? { email: email.trim(), password }
        : { email: email.trim(), password, username: username.trim(), language_preference: 'en' };

      console.log('Sending auth request:', endpoint, JSON.stringify(body));

      const authResponse = await fetch(`${config.API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await authResponse.json();
      console.log('Auth response:', authResponse.status, data);

      if (!authResponse.ok) {
        throw new Error(data.detail || 'Authentication failed');
      }

      // Map backend user format to app user format
      const user = {
        id: data.user.id,
        email: data.user.email,
        username: data.user.username,
        profile_picture_url: data.user.profilePictureUrl,
        native_language: data.user.nativeLanguage || 'en',
        learning_language: data.user.learningLanguage || 'es',
        proficiency_level: data.user.proficiencyLevel || 'B1',
        default_tab: (data.user.defaultTab || 'movies') as 'movies' | 'books',
        is_admin: data.user.isAdmin,
      };

      onLogin(user, data.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const isLoading = loading || googleLoading;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.loginContent}>
        <Text style={styles.logo}>WordWise</Text>
        <Text style={styles.tagline}>Learn vocabulary from movies & books</Text>

        <View style={styles.formContainer}>
          {/* Google Sign-In Button */}
          <TouchableOpacity
            style={[styles.googleButton, isLoading && styles.buttonDisabled]}
            onPress={handleGoogleSignIn}
            disabled={isLoading}
          >
            {googleLoading ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <>
                <Text style={styles.googleIcon}>G</Text>
                <Text style={styles.googleButtonText}>Continue with Google</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          {!isLoginMode && (
            <TextInput
              style={styles.input}
              placeholder="Username"
              placeholderTextColor={colors.textSecondary}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
            />
          )}
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={colors.textSecondary}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={colors.textSecondary}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          {error ? <Text style={styles.loginError}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.primaryButton, isLoading && styles.buttonDisabled]}
            onPress={handleAuth}
            disabled={isLoading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>
                {isLoginMode ? 'Login' : 'Register'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.switchButton}
            onPress={() => setIsLoginMode(!isLoginMode)}
          >
            <Text style={styles.switchButtonText}>
              {isLoginMode
                ? "Don't have an account? Register"
                : 'Already have an account? Login'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

// Movie Card Component
// Book Card Component
const BookCard = ({ book, onPress }: { book: any; onPress: () => void }) => (
  <TouchableOpacity style={styles.movieCard} onPress={onPress} activeOpacity={0.8}>
    <Image
      source={{ uri: book.cover }}
      style={styles.moviePoster}
    />
    <Text style={styles.movieTitle} numberOfLines={2}>{book.title}</Text>
    <Text style={styles.movieYear}>{book.author}</Text>
  </TouchableOpacity>
);

// ── Hero Section ────────────────────────────────────────────────────────────
const MobileHeroSection = ({
  movie,
  onPress,
}: {
  movie: any | null;
  onPress: (movie: any) => void;
}) => {
  if (!movie) return null;
  const backdrop = movie.backdrop_path
    ? `https://image.tmdb.org/t/p/w780${movie.backdrop_path}`
    : null;

  return (
    <TouchableOpacity activeOpacity={0.95} onPress={() => onPress(movie)}>
      <View style={heroStyles.container}>
        {backdrop ? (
          <ImageBackground source={{ uri: backdrop }} style={heroStyles.backdrop} resizeMode="cover">
            {/* Gradient overlay — darkens bottom 38% so the backdrop stays visible */}
            <View style={heroStyles.overlayBottom} />
            <View style={heroStyles.content}>
              <Text style={heroStyles.title} numberOfLines={1}>{movie.title}</Text>
              {movie.overview ? (
                <Text style={heroStyles.overview} numberOfLines={1}>
                  {movie.overview}
                </Text>
              ) : null}
              <TouchableOpacity
                style={heroStyles.ctaButton}
                onPress={() => onPress(movie)}
                activeOpacity={0.85}
              >
                <Text style={heroStyles.ctaText}>▶  Start Learning</Text>
              </TouchableOpacity>
            </View>
          </ImageBackground>
        ) : (
          <View style={[heroStyles.backdrop, { backgroundColor: colors.primary }]}>
            <View style={heroStyles.content}>
              <Text style={heroStyles.title}>{movie.title}</Text>
            </View>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
};

const heroStyles = StyleSheet.create({
  container: { width: '100%', height: 360 },
  backdrop: { width: '100%', height: '100%', justifyContent: 'flex-end' },
  overlayBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '38%',
    backgroundColor: 'rgba(0,0,0,0.78)',
    zIndex: 1,
  },
  content: {
    zIndex: 2,
    paddingHorizontal: 20,
    paddingBottom: 18,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 4,
    lineHeight: 27,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  overview: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.78)',
    lineHeight: 16,
    marginBottom: 10,
  },
  ctaButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  ctaText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
});

// ── Quick Start Row ──────────────────────────────────────────────────────────
// Genre filters use TMDB genre IDs, encoded as `genre:<id>:<name>` so
// SearchResultsScreen routes to TMDB discover. The first chip is a CEFR
// difficulty dropdown (Elementary / Intermediate / Advanced) backed by our
// own DB via `/movies/by-level`, encoded as `level:<LEVEL>:<displayName>`.
const QUICK_FILTERS = [
  { id: 'drama',     icon: '🎭', label: 'Drama',            query: 'genre:18:Drama' },
  { id: 'comedy',    icon: '😂', label: 'Comedy',           query: 'genre:35:Comedy' },
  { id: 'crime',     icon: '🔍', label: 'Crime & Thriller', query: 'genre:80|53:Crime & Thriller' },
  { id: 'family',    icon: '🏠', label: 'Family Friendly',  query: 'genre:10751:Family' },
  { id: 'romance',   icon: '💞', label: 'Romance',          query: 'genre:10749:Romance' },
  { id: 'animation', icon: '🎨', label: 'Animation',        query: 'genre:16:Animation' },
];

const LEVEL_OPTIONS: Array<{ value: string; label: string; icon: string }> = [
  { value: 'A1', label: 'A1 Beginner',       icon: '🟢' },
  { value: 'A2', label: 'A2 Elementary',      icon: '🟢' },
  { value: 'B1', label: 'B1 Intermediate',    icon: '🟡' },
  { value: 'B2', label: 'B2 Upper-Int.',      icon: '🟠' },
  { value: 'C1', label: 'C1 Advanced',        icon: '🔴' },
  { value: 'C2', label: 'C2 Proficiency',     icon: '🔴' },
];

const MobileQuickStartRow = ({ onSearch }: { onSearch: (q: string) => void }) => {
  const [selectedLevel, setSelectedLevel] = useState<string>('A1');
  const [levelOpen, setLevelOpen] = useState(false);
  // Captured via onLayout so the menu can center under the chip regardless
  // of the selected label's width.
  const [chipLayout, setChipLayout] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  const currentLevel = LEVEL_OPTIONS.find((o) => o.value === selectedLevel) ?? LEVEL_OPTIONS[0];

  const MENU_WIDTH = 165;
  const menuLeft = chipLayout
    ? Math.max(0, chipLayout.x + chipLayout.width / 2 - MENU_WIDTH / 2)
    : 0;
  // Sit the menu directly below the chip, with a small 6px gap.
  const menuTop = chipLayout ? chipLayout.y + chipLayout.height + 6 : 0;

  const pickLevel = (value: string) => {
    setSelectedLevel(value);
    setLevelOpen(false);
    const opt = LEVEL_OPTIONS.find((o) => o.value === value)!;
    onSearch(`level:${opt.value}:${opt.label}`);
  };

  return (
    <View style={quickStyles.container}>
      <Text style={quickStyles.title}>Quick Start</Text>
      <View style={quickStyles.row}>
        {/* Level dropdown chip — pinned outside the ScrollView so its
            absolute menu isn't clipped by horizontal overflow. */}
        <TouchableOpacity
          style={[quickStyles.chip, quickStyles.levelChip]}
          onPress={() => setLevelOpen((o) => !o)}
          activeOpacity={0.7}
          onLayout={(e) => {
            const { x, y, width, height } = e.nativeEvent.layout;
            setChipLayout({ x, y, width, height });
          }}
        >
          <Text style={quickStyles.chipIcon}>{currentLevel.icon}</Text>
          <Text style={quickStyles.chipLabel}>{currentLevel.label}</Text>
          <Text style={quickStyles.chipChevron}>{levelOpen ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={quickStyles.scroll}
        >
          {QUICK_FILTERS.map((f) => (
            <TouchableOpacity
              key={f.id}
              style={quickStyles.chip}
              onPress={() => onSearch(f.query)}
              activeOpacity={0.7}
            >
              <Text style={quickStyles.chipIcon}>{f.icon}</Text>
              <Text style={quickStyles.chipLabel}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {levelOpen && (
          <View
            style={[
              quickStyles.levelMenu,
              { left: menuLeft, top: menuTop, width: MENU_WIDTH },
            ]}
          >
          {LEVEL_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[
                quickStyles.levelItem,
                opt.value === selectedLevel && quickStyles.levelItemActive,
              ]}
              onPress={() => pickLevel(opt.value)}
              activeOpacity={0.7}
            >
              <Text style={quickStyles.levelItemIcon}>{opt.icon}</Text>
              <Text style={quickStyles.levelItemText}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
          </View>
        )}
      </View>
    </View>
  );
};

const quickStyles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    marginBottom: 24,
    // Don't clip the absolutely-positioned level menu.
    overflow: 'visible',
    zIndex: 100,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'visible',
  },
  // Clip scrolling chips to the ScrollView's bounds so they don't slide
  // over the pinned level chip on the left. (The dropdown menu is rendered
  // as a sibling of the ScrollView, so this clip doesn't affect it.)
  scroll: { flex: 1, overflow: 'hidden' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.paper,
    marginRight: 10,
  },
  levelChip: {
    borderColor: colors.primary,
  },
  chipIcon: { fontSize: 14 },
  chipLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  chipChevron: { fontSize: 10, color: colors.textSecondary, marginLeft: 2 },
  levelMenu: {
    position: 'absolute',
    // `left`, `top`, and `width` are set inline from the chip's measured
    // layout so the menu stays centered directly below it.
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.paper,
    overflow: 'hidden',
    zIndex: 1000,
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
  },
  levelItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  levelItemActive: { backgroundColor: colors.background },
  levelItemIcon: { fontSize: 14, marginRight: 10 },
  levelItemText: { fontSize: 14, fontWeight: '500', color: colors.text },
});

// ── Helpers for level movies ────────────────────────────────────────────────
const formatVoteCount = (count: number): string => {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return `${count}`;
};

const scoreToCefr = (score: number | null | undefined): string | null => {
  if (score == null) return null;
  if (score <= 24) return 'A1';
  if (score <= 34) return 'A2';
  if (score <= 44) return 'B1';
  if (score <= 54) return 'B2';
  if (score <= 69) return 'C1';
  return 'C2';
};

const tmdbPosterCache: Record<number, string | null> = {};

const TmdbPoster = ({ tmdbId, style }: { tmdbId: number; style: any }) => {
  const [uri, setUri] = useState<string | null>(tmdbPosterCache[tmdbId] ?? null);
  const [loaded, setLoaded] = useState(!!tmdbPosterCache[tmdbId]);

  useEffect(() => {
    if (tmdbPosterCache[tmdbId] !== undefined) {
      setUri(tmdbPosterCache[tmdbId]);
      setLoaded(true);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=9dece7a38786ac0c58794d6db4af3d51`);
        const data = await res.json();
        const posterPath = data.poster_path ? `https://image.tmdb.org/t/p/w185${data.poster_path}` : null;
        tmdbPosterCache[tmdbId] = posterPath;
        setUri(posterPath);
      } catch {
        tmdbPosterCache[tmdbId] = null;
      }
      setLoaded(true);
    })();
  }, [tmdbId]);

  if (!loaded) return <View style={[style, { backgroundColor: colors.border }]} />;
  if (!uri) return (
    <View style={[style, { alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ fontSize: 24 }}>🎬</Text>
    </View>
  );
  return <Image source={{ uri }} style={style} />;
};

// ── Top Rated for Your Level: numbered vertical list ───────────────────────

const RankedMovieList = ({
  movies,
  onMoviePress,
}: {
  movies: any[];
  onMoviePress: (movie: any) => void;
}) => {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const OVERVIEW_LIMIT = 100;

  if (movies.length === 0) return (
    <Text style={{ textAlign: 'center', color: colors.textSecondary, fontSize: 13, paddingVertical: 16 }}>
      No classified movies found for this level yet.
    </Text>
  );

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <View>
      {movies.slice(0, 10).map((movie) => {
        const movieId = movie.id || movie.movie_id;
        const posterUri = movie.poster_path
          ? `https://image.tmdb.org/t/p/w185${movie.poster_path}`
          : movie.poster_url || undefined;
        const overview = movie.overview || movie.description || '';
        const isLong = overview.length > OVERVIEW_LIMIT;
        const expanded = expandedIds.has(movieId);
        const displayText = isLong && !expanded
          ? overview.slice(0, OVERVIEW_LIMIT).trimEnd() + '…'
          : overview;

        return (
          <TouchableOpacity
            key={movieId}
            style={rankedStyles.row}
            onPress={() => onMoviePress(movie)}
            activeOpacity={0.7}
          >
            {posterUri ? (
              <Image source={{ uri: posterUri }} style={rankedStyles.poster} />
            ) : movie.tmdb_id ? (
              <TmdbPoster tmdbId={movie.tmdb_id} style={rankedStyles.poster} />
            ) : (
              <View style={[rankedStyles.poster, { alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={{ fontSize: 24 }}>🎬</Text>
              </View>
            )}
            <View style={rankedStyles.info}>
              <View>
                <Text style={rankedStyles.title} numberOfLines={2}>{movie.title}</Text>
                {(movie.vote_average > 0 || movie.difficulty_score != null) && (
                  <Text style={rankedStyles.ratingInline}>
                    {movie.vote_average > 0 ? `★ ${Number(movie.vote_average).toFixed(1)}` : ''}
                    {movie.vote_count > 0 ? `  ·  ${formatVoteCount(movie.vote_count)} votes` : ''}
                    {movie.difficulty_score != null && (
                      <Text>  ·  <Text style={{ color: cefrColors[scoreToCefr(movie.difficulty_score)!] || colors.textSecondary }}>{scoreToCefr(movie.difficulty_score)} ({movie.difficulty_score}%)</Text></Text>
                    )}
                  </Text>
                )}
              </View>
              {overview.length > 0 && (
                <View>
                  <Text style={rankedStyles.overview}>{displayText}</Text>
                  {isLong && (
                    <TouchableOpacity
                      onPress={(e) => { e.stopPropagation(); toggleExpand(movieId); }}
                      hitSlop={8}
                      style={rankedStyles.expandBtn}
                    >
                      <Text style={rankedStyles.expandArrow}>{expanded ? '▲' : '▼'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const rankedStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rank: {
    width: 36,
    fontSize: 22,
    fontWeight: '800',
    color: colors.textSecondary,
    textAlign: 'center',
    marginRight: 12,
  },
  rankTop: { color: colors.primary },
  poster: {
    width: 60,
    height: 90,
    borderRadius: 6,
    backgroundColor: colors.border,
    marginRight: 14,
  },
  info: {
    flex: 1,
    minHeight: 90,
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  ratingInline: {
    fontSize: 12,
    color: '#F5A623',
    fontWeight: '600',
    marginTop: 3,
  },
  overview: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
    marginTop: 6,
  },
  expandBtn: {
    alignSelf: 'flex-start',
    marginTop: 2,
    paddingVertical: 2,
  },
  expandArrow: {
    fontSize: 10,
    color: colors.primary,
  },
});

// ── Trending Now: snap pager with dots ──────────────────────────────────────
const SNAP_CARD_WIDTH = 150;
const SNAP_CARD_GAP = 12;
const SNAP_INTERVAL = SNAP_CARD_WIDTH + SNAP_CARD_GAP;

const SnapPager = ({
  movies,
  onMoviePress,
}: {
  movies: any[];
  onMoviePress: (movie: any) => void;
}) => {
  const [activeIndex, setActiveIndex] = useState(0);
  if (movies.length === 0) return null;

  const dotCount = Math.ceil(movies.length / 3);
  const activeDot = Math.floor(activeIndex / 3);

  return (
    <View>
      <FlatList
        data={movies}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => String(item.id)}
        snapToInterval={SNAP_INTERVAL}
        decelerationRate="fast"
        snapToAlignment="start"
        contentContainerStyle={{ paddingRight: 16 }}
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / SNAP_INTERVAL);
          setActiveIndex(idx);
        }}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={snapStyles.card}
            onPress={() => onMoviePress(item)}
            activeOpacity={0.8}
          >
            <Image
              source={{ uri: `https://image.tmdb.org/t/p/w300${item.poster_path}` }}
              style={snapStyles.poster}
            />
            <Text style={snapStyles.title} numberOfLines={2}>{item.title}</Text>
            <Text style={snapStyles.year}>{item.release_date?.slice(0, 4)}</Text>
          </TouchableOpacity>
        )}
      />
      {/* Page dots */}
      <View style={snapStyles.dots}>
        {Array.from({ length: dotCount }).map((_, i) => (
          <View
            key={i}
            style={[
              snapStyles.dot,
              i === activeDot && snapStyles.dotActive,
            ]}
          />
        ))}
      </View>
    </View>
  );
};

const snapStyles = StyleSheet.create({
  card: {
    width: SNAP_CARD_WIDTH,
    marginRight: SNAP_CARD_GAP,
  },
  poster: {
    width: SNAP_CARD_WIDTH,
    height: SNAP_CARD_WIDTH * 1.5,
    borderRadius: 8,
    backgroundColor: colors.border,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginTop: 8,
  },
  year: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  dotActive: {
    width: 18,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
});

// Available Languages (same as web app)
const AVAILABLE_LANGUAGES = [
  { code: 'ES', name: 'Spanish', nativeName: 'Español' },
  { code: 'FR', name: 'French', nativeName: 'Français' },
  { code: 'DE', name: 'German', nativeName: 'Deutsch' },
  { code: 'IT', name: 'Italian', nativeName: 'Italiano' },
  { code: 'PT', name: 'Portuguese', nativeName: 'Português' },
  { code: 'RU', name: 'Russian', nativeName: 'Русский' },
  { code: 'TR', name: 'Turkish', nativeName: 'Türkçe' },
  { code: 'JA', name: 'Japanese', nativeName: '日本語' },
  { code: 'ZH', name: 'Chinese', nativeName: '中文' },
  { code: 'NL', name: 'Dutch', nativeName: 'Nederlands' },
  { code: 'PL', name: 'Polish', nativeName: 'Polski' },
  { code: 'AZ', name: 'Azerbaijani', nativeName: 'Azərbaycan' },
];

// Home Screen
const HomeScreen = ({
  onLogout,
  onMoviePress,
  onSearch,
  user,
  targetLanguage,
  setTargetLanguage,
  onNavigateToSettings,
  onNavigateToAdmin,
  onNavigateToReview,
  onNavigateToStats,
  onNavigateToNotebook,
  onNavigateToAchievements,
  onNavigateToLeaderboard,
}: {
  onLogout: () => void;
  onMoviePress: (movie: MovieData) => void;
  onSearch: (query: string) => void;
  user: any;
  targetLanguage: string;
  setTargetLanguage: (lang: string) => void;
  onNavigateToSettings: () => void;
  onNavigateToAdmin: () => void;
  onNavigateToReview: () => void;
  onNavigateToStats: () => void;
  onNavigateToNotebook: () => void;
  onNavigateToAchievements: () => void;
  onNavigateToLeaderboard: () => void;
}) => {
  // Admin preview toggle — show a sticky badge when an admin is previewing
  // the free or premium experience so they never mistake the simulated
  // state for a bug. See docs/MONETIZATION_PLAN.md §6.
  const adminViewMode = useEntitlementsStore((s) => s.adminViewMode);
  const showViewAsBadge = !!user?.is_admin && adminViewMode !== 'admin';
  const showAdsEntitlement = useShowAds();
  const [isFirstSession, setIsFirstSession] = useState(true);
  const showAds = showAdsEntitlement && !isFirstSession;
  const [activeTab] = useState<'movies' | 'books'>('movies');
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [allResults, setAllResults] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [trendingMovies, setTrendingMovies] = useState<any[]>([]);
  const [topRatedMovies, setTopRatedMovies] = useState<any[]>([]);
  const [homeTab, setHomeTab] = useState<'level' | 'trending'>('level');
  const [tabSwitching, setTabSwitching] = useState(false);
  const [levelSort, setLevelSort] = useState<'rating' | 'popularity' | 'level'>('rating');
  const [levelSortAsc, setLevelSortAsc] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showLanguageMenu, setShowLanguageMenu] = useState(false);
  const [srsDueCount, setSrsDueCount] = useState<number | null>(null);
  const [srsTotalSaved, setSrsTotalSaved] = useState(0);
  const [todaysWord, setTodaysWord] = useState<TodaysWord | null>(null);
  const [todaysWordSaved, setTodaysWordSaved] = useState(false);

  useEffect(() => {
    // No ads on first session (§5). Mark this session, show ads from the next one.
    AsyncStorage.getItem('has_opened_before').then((val) => {
      if (val) setIsFirstSession(false);
      else AsyncStorage.setItem('has_opened_before', '1');
    });

    srsApi.stats().then((s) => {
      setSrsDueCount(s.due_now);
      setSrsTotalSaved(s.total_saved);
    }).catch(() => {});
    srsApi.todaysWord().then(setTodaysWord).catch(() => {});
  }, []);

  // Sample popular books data
  const popularBooks = [
    { id: 1, title: 'Pride and Prejudice', author: 'Jane Austen', cover: 'https://covers.openlibrary.org/b/id/8231994-M.jpg' },
    { id: 2, title: '1984', author: 'George Orwell', cover: 'https://covers.openlibrary.org/b/id/7222246-M.jpg' },
    { id: 3, title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', cover: 'https://covers.openlibrary.org/b/id/7222161-M.jpg' },
    { id: 4, title: 'To Kill a Mockingbird', author: 'Harper Lee', cover: 'https://covers.openlibrary.org/b/id/8228691-M.jpg' },
    { id: 5, title: 'Jane Eyre', author: 'Charlotte Bronte', cover: 'https://covers.openlibrary.org/b/id/12648655-M.jpg' },
    { id: 6, title: 'Moby Dick', author: 'Herman Melville', cover: 'https://covers.openlibrary.org/b/id/7222078-M.jpg' },
  ];

  const classicBooks = [
    { id: 7, title: 'Frankenstein', author: 'Mary Shelley', cover: 'https://covers.openlibrary.org/b/id/6788005-M.jpg' },
    { id: 8, title: 'Dracula', author: 'Bram Stoker', cover: 'https://covers.openlibrary.org/b/id/8477514-M.jpg' },
    { id: 9, title: 'Wuthering Heights', author: 'Emily Bronte', cover: 'https://covers.openlibrary.org/b/id/12818862-M.jpg' },
    { id: 10, title: 'The Picture of Dorian Gray', author: 'Oscar Wilde', cover: 'https://covers.openlibrary.org/b/id/12547191-M.jpg' },
    { id: 11, title: 'Crime and Punishment', author: 'Dostoevsky', cover: 'https://covers.openlibrary.org/b/id/12783408-M.jpg' },
    { id: 12, title: 'Anna Karenina', author: 'Leo Tolstoy', cover: 'https://covers.openlibrary.org/b/id/8234196-M.jpg' },
  ];

  useEffect(() => {
    fetchMovies();
  }, []);

  const userLevel = user?.proficiency_level || 'B1';

  const fetchMovies = async () => {
    try {
      const trendingRes = await fetch('https://api.themoviedb.org/3/trending/movie/day?api_key=9dece7a38786ac0c58794d6db4af3d51');
      const trendingData = await trendingRes.json();
      setTrendingMovies(trendingData.results?.slice(0, 15) || []);

      try {
        const levelRes = await fetch(`${API_BASE_URL}/movies/by-cefr?level=${userLevel}&limit=15`);
        if (levelRes.ok) {
          const levelData = await levelRes.json();
          const raw = (levelData.movies || []).map((m: any) => ({
            ...m,
            id: m.tmdb_id || m.movie_id,
          }));
          // Enrich with TMDB data (poster + overview) in parallel
          const enriched = await Promise.all(
            raw.map(async (m: any) => {
              if (!m.tmdb_id) return m;
              try {
                const r = await fetch(`https://api.themoviedb.org/3/movie/${m.tmdb_id}?api_key=9dece7a38786ac0c58794d6db4af3d51`);
                const t = await r.json();
                return {
                  ...m,
                  overview: t.overview || m.description || '',
                  poster_path: t.poster_path || null,
                  release_date: t.release_date || (m.year ? `${m.year}-01-01` : ''),
                };
              } catch { return m; }
            })
          );
          setTopRatedMovies(enriched);
        }
      } catch {}
    } catch (error) {
      console.error('Failed to fetch movies:', error);
    } finally {
      setLoading(false);
    }
  };

  const onSearchTextChange = (text: string) => {
    setSearchQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (text.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const results = await tmdbApi.searchMovies(text.trim());
        setSuggestions(results.slice(0, 5));
        setAllResults(results);
        setShowSuggestions(true);
      } catch (err) {
        console.error('Autocomplete failed:', err);
      }
    }, 300);
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSuggestions([]);
    setAllResults([]);
    setShowSuggestions(false);
  };

  const handleMoviePress = (movie: any) => {
    onMoviePress({
      id: movie.id || movie.tmdb_id || movie.movie_id,
      title: movie.title,
      poster_path: movie.poster_path,
      release_date: movie.release_date || (movie.year ? `${movie.year}-01-01` : undefined),
      overview: movie.overview || movie.description,
      genre_ids: movie.genre_ids,
      vote_average: movie.vote_average,
      original_language: movie.original_language || 'en',
    });
  };

  const handleBookPress = (book: any) => {
    // TODO: Navigate to book detail
    console.log('Book pressed:', book.title);
  };

  const currentLang = AVAILABLE_LANGUAGES.find(l => l.code === targetLanguage) || AVAILABLE_LANGUAGES[0];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {showViewAsBadge && (
        <TouchableOpacity
          style={styles.viewAsBadge}
          onPress={onNavigateToAdmin}
          activeOpacity={0.8}
        >
          <Text style={styles.viewAsBadgeText}>
            Viewing as: {adminViewMode === 'free' ? 'Free user' : 'Premium user'} · tap to change
          </Text>
        </TouchableOpacity>
      )}
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>WordWise</Text>

        <View style={styles.headerRight}>
          {/* Admin button (admin-only) */}
          {user?.is_admin && (
            <TouchableOpacity
              style={styles.adminButton}
              onPress={onNavigateToAdmin}
            >
              <Text style={styles.adminButtonText}>⚙</Text>
            </TouchableOpacity>
          )}

          {/* Language Selector */}
          <TouchableOpacity
            style={styles.languageButton}
            onPress={() => setShowLanguageMenu(!showLanguageMenu)}
          >
            <Text style={styles.languageButtonText}>{currentLang.code}</Text>
            <Text style={styles.languageDropdownIcon}>▼</Text>
          </TouchableOpacity>

          {/* User Avatar */}
          <TouchableOpacity
            style={styles.avatarButton}
            onPress={() => setShowUserMenu(!showUserMenu)}
          >
            {user?.profile_picture_url ? (
              <Image
                source={{ uri: user.profile_picture_url }}
                style={styles.avatarImage}
              />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitial}>
                  {user?.username?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'U'}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Language Menu Dropdown */}
      {showLanguageMenu && (
        <View style={styles.dropdownMenu}>
          <ScrollView style={styles.dropdownScroll} nestedScrollEnabled>
            {AVAILABLE_LANGUAGES.map((lang) => (
              <TouchableOpacity
                key={lang.code}
                style={[
                  styles.dropdownItem,
                  lang.code === targetLanguage && styles.dropdownItemActive
                ]}
                onPress={() => {
                  setTargetLanguage(lang.code);
                  setShowLanguageMenu(false);
                }}
              >
                <Text style={styles.dropdownItemCode}>{lang.code}</Text>
                <Text style={styles.dropdownItemText}>{lang.nativeName}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* User Menu Dropdown */}
      {showUserMenu && (
        <View style={[styles.dropdownMenu, styles.userDropdownMenu]}>
          <View style={styles.dropdownUserInfo}>
            <Text style={styles.dropdownUserName}>{user?.username || 'User'}</Text>
            <Text style={styles.dropdownUserEmail}>{user?.email}</Text>
          </View>
          <View style={styles.dropdownDivider} />
          <TouchableOpacity
            style={styles.dropdownItem}
            onPress={() => {
              setShowUserMenu(false);
              onNavigateToSettings();
            }}
          >
            <Text style={styles.dropdownItemIcon}>⚙️</Text>
            <Text style={styles.dropdownItemText}>Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.dropdownItem}
            onPress={() => {
              setShowUserMenu(false);
              // TODO: Navigate to word lists
            }}
          >
            <Text style={styles.dropdownItemIcon}>📚</Text>
            <Text style={styles.dropdownItemText}>My Lists</Text>
          </TouchableOpacity>
          <View style={styles.dropdownDivider} />
          <TouchableOpacity
            style={styles.dropdownItem}
            onPress={() => {
              setShowUserMenu(false);
              onLogout();
            }}
          >
            <Text style={styles.dropdownItemIcon}>🚪</Text>
            <Text style={[styles.dropdownItemText, { color: colors.error }]}>Logout</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        {!loading && (
          <MobileHeroSection
            movie={trendingMovies.find((m: any) => m.backdrop_path) ?? trendingMovies[0] ?? null}
            onPress={handleMoviePress}
          />
        )}

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <View style={styles.searchInputWrapper}>
            <TextInput
              style={styles.searchInput}
              placeholder={activeTab === 'movies' ? 'Search movies...' : 'Search books...'}
              placeholderTextColor={colors.textSecondary}
              value={searchQuery}
              onChangeText={onSearchTextChange}
              onSubmitEditing={() => { if (searchQuery.trim()) { onSearch(searchQuery.trim()); clearSearch(); } }}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={clearSearch} style={styles.searchClear}>
                <Text style={styles.searchClearText}>✕</Text>
              </TouchableOpacity>
            )}
            {/* Autocomplete Dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <View style={styles.autocompleteDropdown}>
                {suggestions.map((movie: any) => (
                  <TouchableOpacity
                    key={movie.id}
                    style={styles.searchResultItem}
                    onPress={() => {
                      handleMoviePress(movie);
                      clearSearch();
                    }}
                    activeOpacity={0.7}
                  >
                    {movie.poster_path ? (
                      <Image
                        source={{ uri: `https://image.tmdb.org/t/p/w92${movie.poster_path}` }}
                        style={styles.searchResultPoster}
                      />
                    ) : (
                      <View style={[styles.searchResultPoster, { backgroundColor: colors.border }]} />
                    )}
                    <View style={styles.searchResultInfo}>
                      <Text style={styles.searchResultTitle} numberOfLines={1}>{movie.title}</Text>
                      <Text style={styles.searchResultYear}>{movie.release_date?.slice(0, 4)}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
                {allResults.length > 5 && (
                  <TouchableOpacity
                    style={styles.seeAllButton}
                    onPress={() => {
                      onSearch(searchQuery.trim());
                      clearSearch();
                    }}
                  >
                    <Text style={styles.seeAllText}>See all {allResults.length} results</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
          <TouchableOpacity
            style={styles.searchButton}
            onPress={() => { if (searchQuery.trim()) { onSearch(searchQuery.trim()); clearSearch(); } }}
          >
            <Text style={styles.searchButtonText}>🔍</Text>
          </TouchableOpacity>
        </View>

        {/* Quick Start */}
        {!loading && <MobileQuickStartRow onSearch={(q) => { onSearch(q); }} />}

        {/* SRS Review CTA */}
        {srsTotalSaved > 0 && (
          <View style={styles.reviewCtaWrapper}>
            <TouchableOpacity
              style={styles.reviewCta}
              onPress={() => {
                wordwiseApi.logInteraction('_srs', 'SRS_CTA_TAP', undefined, { due_count: srsDueCount, total_saved: srsTotalSaved });
                onNavigateToReview();
              }}
              activeOpacity={0.8}
            >
              <View style={styles.reviewCtaLeft}>
                <Text style={styles.reviewCtaTitle}>
                  {srsDueCount && srsDueCount > 0
                    ? `Review your words`
                    : 'All caught up!'}
                </Text>
                <Text style={styles.reviewCtaSubtitle}>
                  {srsDueCount && srsDueCount > 0
                    ? `${srsDueCount} word${srsDueCount === 1 ? '' : 's'} due for review`
                    : `${srsTotalSaved} words saved · next review soon`}
                </Text>
              </View>
              <Text style={styles.reviewCtaArrow}>→</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Banner Ad Placeholder */}
        {showAds && (
          <View style={styles.adBanner}>
            <Text style={styles.adBannerText}>Ad</Text>
          </View>
        )}

        {/* 4 Tools */}
        <View style={styles.homeNavToggleWrapper}>
          <TouchableOpacity style={styles.homeNavToggleBtn} onPress={onNavigateToNotebook} activeOpacity={0.7}>
            <Text style={styles.homeNavToggleText}>My Words</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.homeNavToggleBtn} onPress={onNavigateToStats} activeOpacity={0.7}>
            <Text style={styles.homeNavToggleText}>My Progress</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.homeNavToggleBtn} onPress={onNavigateToAchievements} activeOpacity={0.7}>
            <Text style={styles.homeNavToggleText}>Badges</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.homeNavToggleBtn} onPress={onNavigateToLeaderboard} activeOpacity={0.7}>
            <Text style={styles.homeNavToggleText}>Rankings</Text>
          </TouchableOpacity>
        </View>

        {/* Level / Trending toggle */}
        <View style={styles.homeTabToggleWrapper}>
          <TouchableOpacity
            style={[styles.homeTabToggleBtn, homeTab === 'level' && styles.homeTabToggleBtnActive]}
            onPress={() => {
              if (homeTab !== 'level') {
                setTabSwitching(true);
                setHomeTab('level');
                setTimeout(() => setTabSwitching(false), 400);
              }
            }}
            activeOpacity={0.7}
          >
            <Text style={[styles.homeTabToggleText, homeTab === 'level' && styles.homeTabToggleTextActive]}>
              ⭐ Your Level ({userLevel})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.homeTabToggleBtn, homeTab === 'trending' && styles.homeTabToggleBtnActive]}
            onPress={() => {
              if (homeTab !== 'trending') {
                setTabSwitching(true);
                setHomeTab('trending');
                setTimeout(() => setTabSwitching(false), 400);
              }
            }}
            activeOpacity={0.7}
          >
            <Text style={[styles.homeTabToggleText, homeTab === 'trending' && styles.homeTabToggleTextActive]}>
              🔥 Trending Now
            </Text>
          </TouchableOpacity>
        </View>

        {/* Sort filters — only for level tab */}
        {homeTab === 'level' && (
          <View style={styles.levelSortRow}>
            {([
              { key: 'rating' as const, label: 'Rating' },
              { key: 'popularity' as const, label: 'Popularity' },
              { key: 'level' as const, label: 'Level %' },
            ]).map((opt) => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.levelSortChip, levelSort === opt.key && styles.levelSortChipActive]}
                onPress={() => {
                  if (levelSort === opt.key) {
                    setLevelSortAsc((v) => !v);
                  } else {
                    setLevelSort(opt.key);
                    setLevelSortAsc(false);
                  }
                }}
                activeOpacity={0.7}
              >
                <Text style={[styles.levelSortText, levelSort === opt.key && styles.levelSortTextActive]}>
                  {opt.label} {levelSort === opt.key ? (levelSortAsc ? '↑' : '↓') : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Tab content */}
        <View style={styles.section}>
          {loading || tabSwitching ? (
            <View style={styles.skeletonContainer}>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={styles.skeletonRow}>
                  <View style={styles.skeletonPoster} />
                  <View style={styles.skeletonInfo}>
                    <View style={[styles.skeletonLine, { width: '70%' }]} />
                    <View style={[styles.skeletonLine, { width: '40%', marginTop: 8 }]} />
                  </View>
                </View>
              ))}
            </View>
          ) : homeTab === 'level' ? (
            <RankedMovieList
              movies={[...topRatedMovies].sort((a, b) => {
                let diff = 0;
                if (levelSort === 'rating') diff = (b.vote_average || 0) - (a.vote_average || 0);
                else if (levelSort === 'popularity') diff = (b.vote_count || 0) - (a.vote_count || 0);
                else diff = (a.difficulty_score || 0) - (b.difficulty_score || 0);
                return levelSortAsc ? -diff : diff;
              })}
              onMoviePress={handleMoviePress}
            />
          ) : (
            <SnapPager
              movies={trendingMovies}
              onMoviePress={handleMoviePress}
            />
          )}
        </View>

        {/* Today's Word — discovery, not review */}
        {todaysWord && (
          <View style={styles.todayCard}>
            <View style={styles.todayHeader}>
              <Text style={styles.todayLabel}>Today's Word</Text>
              <Text style={styles.todayMovie}>from {todaysWord.movie_title}</Text>
            </View>
            <Text style={styles.todayWord}>{todaysWord.word}</Text>
            {todaysWord.definition && (
              <Text style={styles.todayDef}>{todaysWord.definition}</Text>
            )}
            {todaysWord.example_sentence && (
              <Text style={styles.todaySentence}>"{todaysWord.example_sentence}"</Text>
            )}
            <TouchableOpacity
              style={[styles.todaySaveBtn, todaysWordSaved && styles.todaySaveBtnSaved]}
              onPress={async () => {
                if (todaysWordSaved) return;
                try {
                  await wordwiseApi.saveWord(todaysWord.word, todaysWord.movie_id);
                  setTodaysWordSaved(true);
                  setSrsTotalSaved((n) => n + 1);
                } catch {}
              }}
            >
              <Text style={[styles.todaySaveBtnText, todaysWordSaved && styles.todaySaveBtnTextSaved]}>
                {todaysWordSaved ? '★ Saved' : '☆ Save this word'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Browse All */}
        <View style={{ alignItems: 'center', paddingVertical: 24 }}>
          <TouchableOpacity
            style={styles.browseAllButton}
            onPress={() => onSearch('')}
            activeOpacity={0.7}
          >
            <Text style={styles.browseAllText}>Browse All Movies →</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

// Supported languages (same as web app SettingsPage)
const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'tr', name: 'Turkish' },
  { code: 'pl', name: 'Polish' },
  { code: 'nl', name: 'Dutch' },
  { code: 'sv', name: 'Swedish' },
  { code: 'da', name: 'Danish' },
  { code: 'fi', name: 'Finnish' },
  { code: 'no', name: 'Norwegian' },
  { code: 'cs', name: 'Czech' },
  { code: 'el', name: 'Greek' },
  { code: 'he', name: 'Hebrew' },
  { code: 'th', name: 'Thai' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'id', name: 'Indonesian' },
  { code: 'ms', name: 'Malay' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'ro', name: 'Romanian' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'bg', name: 'Bulgarian' },
];

const PROFICIENCY_LEVELS = [
  { code: 'A1', name: 'A1 - Beginner' },
  { code: 'A2', name: 'A2 - Elementary' },
  { code: 'B1', name: 'B1 - Intermediate' },
  { code: 'B2', name: 'B2 - Upper Intermediate' },
  { code: 'C1', name: 'C1 - Advanced' },
  { code: 'C2', name: 'C2 - Proficient' },
];

// Settings Screen
const SettingsScreen = ({
  onBack,
  user,
  onUserUpdated,
  onNavigateToFamilyPlan,
  onNavigateToPrivacy,
  onNavigateToTerms,
}: {
  onBack: () => void;
  user: any;
  onUserUpdated: (user: any) => void;
  onNavigateToFamilyPlan: () => void;
  onNavigateToPrivacy: () => void;
  onNavigateToTerms: () => void;
}) => {
  const [username, setUsername] = useState(user?.username || '');
  const [nativeLanguage, setNativeLanguage] = useState(user?.native_language || 'en');
  const [learningLanguage, setLearningLanguage] = useState(user?.learning_language || 'en');
  const [proficiencyLevel, setProficiencyLevel] = useState(user?.proficiency_level || 'A1');
  const [defaultTab, setDefaultTab] = useState<'movies' | 'books'>(user?.default_tab || 'movies');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [showNativeLangPicker, setShowNativeLangPicker] = useState(false);
  const [showLearningLangPicker, setShowLearningLangPicker] = useState(false);
  const [showProficiencyPicker, setShowProficiencyPicker] = useState(false);
  const [dailyWordNotif, setDailyWordNotif] = useState(true);
  const [reviewNotif, setReviewNotif] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem('notif_daily_word').then((v) => { if (v === 'off') setDailyWordNotif(false); });
    AsyncStorage.getItem('notif_review').then((v) => { if (v === 'off') setReviewNotif(false); });
  }, []);

  const toggleDailyWord = async () => {
    const next = !dailyWordNotif;
    setDailyWordNotif(next);
    await AsyncStorage.setItem('notif_daily_word', next ? 'on' : 'off');
    if (next) {
      scheduleDailyWordReminder();
    } else {
      const { cancelAllReminders: cancel } = require('../services/notifications');
      // Just cancel this specific one — we'll re-schedule review if needed
      try {
        const Notif = require('expo-notifications');
        await Notif.cancelScheduledNotificationAsync('daily-word');
      } catch {}
    }
  };

  const toggleReview = async () => {
    const next = !reviewNotif;
    setReviewNotif(next);
    await AsyncStorage.setItem('notif_review', next ? 'on' : 'off');
    if (next) {
      scheduleReviewReminder();
    } else {
      try {
        const Notif = require('expo-notifications');
        await Notif.cancelScheduledNotificationAsync('review-reminder');
      } catch {}
    }
  };

  const handleSave = async () => {
    if (!username.trim()) {
      setError('Username is required');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const token = await (await import('../services/auth/tokenStorage')).tokenStorage.getAccessToken();
      const response = await fetch(`${API_BASE_URL}/auth/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          username: username.trim(),
          native_language: nativeLanguage,
          learning_language: learningLanguage,
          proficiency_level: proficiencyLevel,
          default_tab: defaultTab,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to update settings');
      }

      const updatedUser = await response.json();
      onUserUpdated(updatedUser);
      setSuccess('Settings updated successfully!');
    } catch (err: any) {
      setError(err.message || 'Failed to update settings');
    } finally {
      setSaving(false);
    }
  };

  const getLangName = (code: string) =>
    SUPPORTED_LANGUAGES.find((l) => l.code === code)?.name || code;

  const getProfName = (code: string) =>
    PROFICIENCY_LEVELS.find((l) => l.code === code)?.name || code;

  const renderPicker = (
    visible: boolean,
    onClose: () => void,
    items: { code: string; name: string }[],
    selected: string,
    onSelect: (code: string) => void,
    title: string,
  ) => {
    if (!visible) return null;
    return (
      <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
        <View style={settingsStyles.modalOverlay}>
          <View style={settingsStyles.modalContent}>
            <View style={settingsStyles.modalHeader}>
              <Text style={settingsStyles.modalTitle}>{title}</Text>
              <TouchableOpacity onPress={onClose}>
                <Text style={settingsStyles.modalClose}>Done</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={settingsStyles.modalScroll}>
              {items.map((item) => (
                <TouchableOpacity
                  key={item.code}
                  style={[
                    settingsStyles.modalItem,
                    item.code === selected && settingsStyles.modalItemSelected,
                  ]}
                  onPress={() => {
                    onSelect(item.code);
                    onClose();
                  }}
                >
                  <Text
                    style={[
                      settingsStyles.modalItemText,
                      item.code === selected && settingsStyles.modalItemTextSelected,
                    ]}
                  >
                    {item.name}
                  </Text>
                  {item.code === selected && <Text style={settingsStyles.checkmark}>✓</Text>}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

  return (
    <SafeAreaView style={settingsStyles.container} edges={['top']}>
      {/* Header */}
      <View style={settingsStyles.header}>
        <TouchableOpacity onPress={onBack} style={settingsStyles.backButton}>
          <Text style={settingsStyles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={settingsStyles.headerTitle}>Settings</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={settingsStyles.scrollContent} contentContainerStyle={settingsStyles.scrollContainer}>
        {/* Avatar + Email */}
        <View style={settingsStyles.profileHeader}>
          {user?.profile_picture_url ? (
            <Image source={{ uri: user.profile_picture_url }} style={settingsStyles.avatar} />
          ) : (
            <View style={settingsStyles.avatarPlaceholder}>
              <Text style={settingsStyles.avatarInitial}>
                {user?.username?.[0]?.toUpperCase() || 'U'}
              </Text>
            </View>
          )}
          <View style={settingsStyles.profileInfo}>
            <Text style={settingsStyles.profileTitle}>Account Settings</Text>
            <Text style={settingsStyles.profileEmail}>{user?.email}</Text>
          </View>
        </View>

        <View style={settingsStyles.divider} />

        {/* Alerts */}
        {error && (
          <View style={settingsStyles.alertError}>
            <Text style={settingsStyles.alertErrorText}>{error}</Text>
          </View>
        )}
        {success && (
          <View style={settingsStyles.alertSuccess}>
            <Text style={settingsStyles.alertSuccessText}>{success}</Text>
          </View>
        )}

        {/* Profile Section */}
        <Text style={settingsStyles.sectionTitle}>Profile</Text>
        <View style={settingsStyles.inputContainer}>
          <Text style={settingsStyles.inputLabel}>Username</Text>
          <TextInput
            style={settingsStyles.textInput}
            value={username}
            onChangeText={setUsername}
            placeholder="Enter username"
            placeholderTextColor={colors.textSecondary}
          />
        </View>

        <View style={settingsStyles.divider} />

        {/* Language Preferences Section */}
        <Text style={settingsStyles.sectionTitle}>Language Preferences</Text>

        <TouchableOpacity
          style={settingsStyles.selectButton}
          onPress={() => setShowNativeLangPicker(true)}
        >
          <Text style={settingsStyles.selectLabel}>Native Language</Text>
          <Text style={settingsStyles.selectValue}>{getLangName(nativeLanguage)} ▼</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={settingsStyles.selectButton}
          onPress={() => setShowLearningLangPicker(true)}
        >
          <Text style={settingsStyles.selectLabel}>Learning Language</Text>
          <Text style={settingsStyles.selectValue}>{getLangName(learningLanguage)} ▼</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={settingsStyles.selectButton}
          onPress={() => setShowProficiencyPicker(true)}
        >
          <Text style={settingsStyles.selectLabel}>Proficiency Level</Text>
          <Text style={settingsStyles.selectValue}>{getProfName(proficiencyLevel)} ▼</Text>
        </TouchableOpacity>

        <View style={settingsStyles.divider} />

        {/* Default Home Tab */}
        <Text style={settingsStyles.sectionTitle}>Default Home Tab</Text>
        <View style={settingsStyles.tabToggle}>
          <TouchableOpacity
            style={[settingsStyles.tabOption, defaultTab === 'movies' && settingsStyles.tabOptionActive]}
            onPress={() => setDefaultTab('movies')}
          >
            <Text style={[settingsStyles.tabOptionText, defaultTab === 'movies' && settingsStyles.tabOptionTextActive]}>
              Movies
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[settingsStyles.tabOption, defaultTab === 'books' && settingsStyles.tabOptionActive]}
            onPress={() => setDefaultTab('books')}
          >
            <Text style={[settingsStyles.tabOptionText, defaultTab === 'books' && settingsStyles.tabOptionTextActive]}>
              Books
            </Text>
          </TouchableOpacity>
        </View>

        {/* Save Button */}
        <TouchableOpacity
          style={[settingsStyles.saveButton, saving && settingsStyles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.7}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={settingsStyles.saveButtonText}>Save Changes</Text>
          )}
        </TouchableOpacity>

        <View style={settingsStyles.divider} />

        {/* Notifications */}
        <Text style={settingsStyles.sectionTitle}>Notifications</Text>
        <View style={settingsStyles.notifRow}>
          <View style={settingsStyles.notifInfo}>
            <Text style={settingsStyles.notifLabel}>Today's Word (9:00 AM)</Text>
            <Text style={settingsStyles.notifDesc}>Daily word discovery from popular movies</Text>
          </View>
          <TouchableOpacity
            style={[settingsStyles.notifToggle, dailyWordNotif && settingsStyles.notifToggleOn]}
            onPress={toggleDailyWord}
          >
            <Text style={settingsStyles.notifToggleText}>{dailyWordNotif ? 'ON' : 'OFF'}</Text>
          </TouchableOpacity>
        </View>
        <View style={settingsStyles.notifRow}>
          <View style={settingsStyles.notifInfo}>
            <Text style={settingsStyles.notifLabel}>Review Reminder (6:00 PM)</Text>
            <Text style={settingsStyles.notifDesc}>Reminder to review your saved words</Text>
          </View>
          <TouchableOpacity
            style={[settingsStyles.notifToggle, reviewNotif && settingsStyles.notifToggleOn]}
            onPress={toggleReview}
          >
            <Text style={settingsStyles.notifToggleText}>{reviewNotif ? 'ON' : 'OFF'}</Text>
          </TouchableOpacity>
        </View>

        {/* Subscription & Family */}
        <Text style={settingsStyles.sectionTitle}>Subscription</Text>
        <TouchableOpacity style={settingsStyles.settingsLink} onPress={onNavigateToFamilyPlan}>
          <Text style={settingsStyles.settingsLinkText}>Family Plan</Text>
          <Text style={settingsStyles.settingsLinkArrow}>→</Text>
        </TouchableOpacity>
        <TouchableOpacity style={settingsStyles.settingsLink} onPress={async () => {
          const { restorePurchases } = require('../services/billing');
          const result = await restorePurchases();
          Alert.alert(result.restored ? 'Restored!' : 'Not found', result.message);
        }}>
          <Text style={settingsStyles.settingsLinkText}>Restore Purchases</Text>
          <Text style={settingsStyles.settingsLinkArrow}>→</Text>
        </TouchableOpacity>

        {/* Legal */}
        <Text style={settingsStyles.sectionTitle}>Legal</Text>
        <TouchableOpacity style={settingsStyles.settingsLink} onPress={onNavigateToPrivacy}>
          <Text style={settingsStyles.settingsLinkText}>Privacy Policy</Text>
          <Text style={settingsStyles.settingsLinkArrow}>→</Text>
        </TouchableOpacity>
        <TouchableOpacity style={settingsStyles.settingsLink} onPress={onNavigateToTerms}>
          <Text style={settingsStyles.settingsLinkText}>Terms of Service</Text>
          <Text style={settingsStyles.settingsLinkArrow}>→</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Pickers */}
      {renderPicker(showNativeLangPicker, () => setShowNativeLangPicker(false), SUPPORTED_LANGUAGES, nativeLanguage, setNativeLanguage, 'Native Language')}
      {renderPicker(showLearningLangPicker, () => setShowLearningLangPicker(false), SUPPORTED_LANGUAGES, learningLanguage, setLearningLanguage, 'Learning Language')}
      {renderPicker(showProficiencyPicker, () => setShowProficiencyPicker(false), PROFICIENCY_LEVELS, proficiencyLevel, setProficiencyLevel, 'Proficiency Level')}
    </SafeAreaView>
  );
};

const settingsStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.paper,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  backButton: {
    width: 60,
  },
  backButtonText: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: '500',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  scrollContent: {
    flex: 1,
  },
  scrollContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  avatarPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
  },
  profileInfo: {
    marginLeft: 16,
  },
  profileTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
  },
  profileEmail: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: 20,
  },
  alertError: {
    backgroundColor: '#FDEAEA',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  alertErrorText: {
    color: colors.error,
    fontSize: 14,
  },
  alertSuccess: {
    backgroundColor: '#E8F5E9',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  alertSuccessText: {
    color: colors.success,
    fontSize: 14,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  inputContainer: {
    marginBottom: 4,
  },
  inputLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
  },
  selectButton: {
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  selectLabel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  selectValue: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '500',
  },
  tabToggle: {
    flexDirection: 'row',
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    overflow: 'hidden',
  },
  tabOption: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabOptionActive: {
    backgroundColor: colors.primary,
  },
  tabOptionText: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  tabOptionTextActive: {
    color: '#fff',
  },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 28,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '60%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  modalClose: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
  },
  modalScroll: {
    paddingBottom: 30,
  },
  modalItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  modalItemSelected: {
    backgroundColor: `${colors.primary}10`,
  },
  modalItemText: {
    fontSize: 16,
    color: colors.text,
  },
  modalItemTextSelected: {
    color: colors.primary,
    fontWeight: '600',
  },
  checkmark: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: '700',
  },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  notifInfo: { flex: 1 },
  notifLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
  notifDesc: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  notifToggle: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#E0DDD8',
    marginLeft: 12,
  },
  notifToggleOn: { backgroundColor: colors.primary },
  notifToggleText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
  settingsLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 16, backgroundColor: colors.paper,
    borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: colors.border,
  },
  settingsLinkText: { fontSize: 15, color: colors.text },
  settingsLinkArrow: { fontSize: 16, color: colors.textSecondary },
});

// Loading Screen
const LoadingScreen = () => (
  <View style={[styles.container, styles.centered]}>
    <Text style={styles.logo}>WordWise</Text>
    <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 20 }} />
  </View>
);

// Word Row Component - Polished design matching web app
interface SentenceExample {
  sentence: string;
  word_position: number;
  matched_form?: string;
  translation?: string;
}

const WordRow = ({
  word,
  index,
  rowNumber,
  groupColor,
  movieId,
  movieTitle,
  targetLang,
  isSaved,
  onSave,
  isAuthenticated,
}: {
  word: WordInfo;
  index: number;
  rowNumber: number;
  groupColor: string;
  movieId?: number | null;
  movieTitle?: string;
  targetLang?: string;
  isSaved?: boolean;
  onSave?: (word: string) => void;
  isAuthenticated?: boolean;
}) => {
  const [expanded, setExpanded] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [sentenceExamples, setSentenceExamples] = useState<SentenceExample[]>([]);
  const [reportOpen, setReportOpen] = useState(false);
  const [crossMovieSentences, setCrossMovieSentences] = useState<CrossMovieSentence[]>([]);
  const [playingAudio, setPlayingAudio] = useState(false);
  const isPremium = useIsPremium();

  const handlePress = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }

    // Log interaction (fire-and-forget)
    if (isAuthenticated) {
      wordwiseApi.logInteraction(word.word, 'ROW_CLICK', movieId);
    }

    if (translation) {
      setExpanded(true);
      return;
    }

    setTranslating(true);
    try {
      const promises: Promise<void>[] = [];

      // Fetch translation (with movieId for V2 sense-aware path)
      promises.push(
        wordwiseApi.translate(word.word, targetLang || 'ES', undefined, movieId)
          .then((result) => setTranslation(result.translated))
          .catch(() => setTranslation('Translation failed'))
      );

      // Fetch sentence examples + translation in one call
      if (movieId) {
        const langParam = targetLang ? `&target_lang=${encodeURIComponent(targetLang)}` : '';
        promises.push(
          fetch(`${API_BASE_URL}/api/enrichment/movies/${movieId}/sentences/${encodeURIComponent(word.word)}?max_examples=1${langParam}`)
            .then((res) => res.json())
            .then((data) => {
              if (data.sentences && Array.isArray(data.sentences)) {
                setSentenceExamples(data.sentences);
              }
            })
            .catch(() => {})
        );
      }

      await Promise.all(promises);
      setExpanded(true);

      if (isPremium) {
        premiumApi.crossMovieSentences(word.word).then(setCrossMovieSentences).catch(() => {});
      }
    } finally {
      setTranslating(false);
    }
  };

  const handlePronounce = async () => {
    if (playingAudio) return;
    setPlayingAudio(true);
    try {
      const { Audio } = require('expo-av');
      const { sound } = await Audio.Sound.createAsync(
        { uri: premiumApi.pronounceUrl(word.word) },
        { shouldPlay: true }
      );
      sound.setOnPlaybackStatusUpdate((status: any) => {
        if (status.didJustFinish) {
          sound.unloadAsync();
          setPlayingAudio(false);
        }
      });
    } catch {
      setPlayingAudio(false);
    }
  };

  const isUntranslatable = translation && translation.toLowerCase() === word.word.toLowerCase();

  // Highlight the target word (and its lemma form) in a sentence
  const renderHighlightedSentence = (sentence: string, targetWord: string, matchedForm?: string) => {
    const words = new Set([targetWord.toLowerCase()]);
    if (matchedForm) words.add(matchedForm.toLowerCase());
    const escaped = [...words].map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');
    const parts = sentence.split(regex);
    return (
      <Text style={styles.exampleSentence}>
        {parts.map((part, i) =>
          words.has(part.toLowerCase()) ? (
            <Text key={i} style={styles.highlightedWord}>{part}</Text>
          ) : (
            <Text key={i}>{part}</Text>
          )
        )}
      </Text>
    );
  };

  return (
    <View style={styles.wordRowWrapper}>
      <TouchableOpacity
        style={[styles.wordRow, expanded && styles.wordRowExpanded]}
        onPress={handlePress}
        activeOpacity={0.7}
      >
        <View style={styles.wordRowMain}>
          <Text style={styles.rowNumber}>{rowNumber}.</Text>
          <Text style={styles.wordText}>{word.word}</Text>
          {isPremium && expanded && (
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation(); handlePronounce(); }}
              hitSlop={8}
              style={styles.pronounceBtn}
            >
              <Text style={[styles.pronounceIcon, playingAudio && styles.pronounceIconActive]}>
                {playingAudio ? '...' : '🔊'}
              </Text>
            </TouchableOpacity>
          )}
          {translating && (
            <ActivityIndicator
              size="small"
              color={colors.primary}
              style={styles.inlineSpinner}
            />
          )}
          <Text style={[styles.expandIcon, expanded && styles.expandIconRotated]}>
            ▼
          </Text>
          {isAuthenticated && onSave && (
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation(); onSave(word.word); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.bookmarkButton}
            >
              <Text style={[styles.bookmarkIcon, isSaved && styles.bookmarkIconActive]}>
                {isSaved ? '★' : '☆'}
              </Text>
            </TouchableOpacity>
          )}
          {isAuthenticated && (
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation(); setReportOpen(true); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.flagButton}
            >
              <Text style={styles.flagIcon}>⚑</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>

      <ReportDialog
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        word={word.word}
        movieId={movieId ?? undefined}
        movieTitle={movieTitle}
      />

      {expanded && (
        <View style={[styles.dropdownPanel, { borderLeftColor: groupColor }]}>
          {/* Translation */}
          <View style={styles.translationBox}>
            <Text style={styles.translationDash}>—</Text>
            {translation ? (
              <Text
                style={[
                  styles.translationText,
                  isUntranslatable && styles.translationUntranslatable,
                ]}
              >
                {isUntranslatable ? '(same as source)' : translation.toLowerCase()}
              </Text>
            ) : (
              <Text style={styles.noTranslation}>No translation available</Text>
            )}
          </View>

          {/* Sentence Examples */}
          {sentenceExamples.length > 0 ? (
            sentenceExamples.map((example, idx) => (
              <View key={idx} style={styles.exampleCard}>
                {renderHighlightedSentence(example.sentence, word.word, example.matched_form)}
                {example.translation && (
                  <Text style={styles.exampleTranslation}>
                    {example.translation.toLowerCase()}
                  </Text>
                )}
              </View>
            ))
          ) : movieId ? (
            <Text style={styles.noExamples}>No sentence examples available</Text>
          ) : null}

          {/* Cross-movie sentences (premium) */}
          {isPremium && crossMovieSentences.length > 0 && (
            <View style={styles.crossMovieSection}>
              <Text style={styles.crossMovieLabel}>Also appears in:</Text>
              {crossMovieSentences.slice(0, 3).map((s, i) => (
                <View key={i} style={styles.crossMovieItem}>
                  <Text style={styles.crossMovieMovie}>{s.movie_title}</Text>
                  <Text style={styles.crossMovieSentence}>"{s.sentence}"</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
};

// CEFR Tab Component - Polished design with indicator
const CEFRTab = ({
  level,
  label,
  count,
  active,
  color,
  onPress,
}: {
  level: string;
  label: string;
  count: number;
  active: boolean;
  color: string;
  onPress: () => void;
}) => {
  const isIdioms = level === 'IDIOMS';
  const displayColor = isIdioms ? colors.warning : color;

  return (
    <TouchableOpacity
      style={[
        styles.cefrTab,
        active && styles.cefrTabActive,
        active && { backgroundColor: `${displayColor}20` }, // 20% opacity of the level color
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {isIdioms ? (
        <View style={styles.idiomTabContent}>
          <Text
            style={[
              styles.idiomTabText,
              active && { color: displayColor },
              !active && styles.cefrTabInactive,
            ]}
          >
            Idioms
          </Text>
        </View>
      ) : (
        <Text
          style={[
            styles.cefrTabLevel,
            active && { color: displayColor },
            !active && styles.cefrTabInactive,
          ]}
        >
          {level}
        </Text>
      )}
    </TouchableOpacity>
  );
};

// Idiom Row Component - for the Expressions tab
// Mirrors WordRow: fetches translation + sentence examples on click and supports bookmarking.
const IdiomRow = ({
  idiom,
  rowNumber,
  groupColor,
  movieId,
  targetLang,
  isSaved,
  onSave,
  isAuthenticated,
}: {
  idiom: IdiomInfo;
  index: number;
  rowNumber: number;
  groupColor: string;
  movieId?: number | null;
  targetLang?: string;
  isSaved?: boolean;
  onSave?: (word: string) => void;
  isAuthenticated?: boolean;
}) => {
  const [expanded, setExpanded] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [sentenceExamples, setSentenceExamples] = useState<SentenceExample[]>([]);

  const phrase = idiom.phrase;

  const handlePress = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }

    if (isAuthenticated) {
      wordwiseApi.logInteraction(phrase, 'ROW_CLICK', movieId);
    }

    if (translation) {
      setExpanded(true);
      return;
    }

    setTranslating(true);
    try {
      const promises: Promise<void>[] = [];

      promises.push(
        wordwiseApi.translate(phrase, targetLang || 'ES', undefined, movieId)
          .then((result) => setTranslation(result.translated))
          .catch(() => setTranslation('Translation failed'))
      );

      if (movieId) {
        const langParam = targetLang ? `&target_lang=${encodeURIComponent(targetLang)}` : '';
        promises.push(
          fetch(`${API_BASE_URL}/api/enrichment/movies/${movieId}/sentences/${encodeURIComponent(phrase)}?max_examples=1${langParam}`)
            .then((res) => res.json())
            .then((data) => {
              if (data.sentences && Array.isArray(data.sentences)) {
                setSentenceExamples(data.sentences);
              }
            })
            .catch(() => {})
        );
      }

      await Promise.all(promises);
      setExpanded(true);
    } finally {
      setTranslating(false);
    }
  };

  const isUntranslatable = translation && translation.toLowerCase() === phrase.toLowerCase();

  const renderHighlightedSentence = (sentence: string, target: string, matchedForm?: string) => {
    const words = new Set([target.toLowerCase()]);
    if (matchedForm) words.add(matchedForm.toLowerCase());
    const escaped = [...words].map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
    const parts = sentence.split(regex);
    return (
      <Text style={styles.exampleSentence}>
        {parts.map((part, i) =>
          words.has(part.toLowerCase()) ? (
            <Text key={i} style={styles.highlightedWord}>{part}</Text>
          ) : (
            <Text key={i}>{part}</Text>
          )
        )}
      </Text>
    );
  };

  return (
    <View style={styles.wordRowWrapper}>
      <TouchableOpacity
        style={[styles.wordRow, expanded && styles.wordRowExpanded]}
        onPress={handlePress}
        activeOpacity={0.7}
      >
        <View style={styles.wordRowMain}>
          <Text style={styles.rowNumber}>{rowNumber}.</Text>
          <Text style={styles.wordText}>{phrase}</Text>
          {translating && (
            <ActivityIndicator
              size="small"
              color={colors.primary}
              style={styles.inlineSpinner}
            />
          )}
          <Text style={[styles.expandIcon, expanded && styles.expandIconRotated]}>▼</Text>
          {isAuthenticated && onSave && (
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation(); onSave(phrase); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.bookmarkButton}
            >
              <Text style={[styles.bookmarkIcon, isSaved && styles.bookmarkIconActive]}>
                {isSaved ? '★' : '☆'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={[styles.dropdownPanel, { borderLeftColor: groupColor }]}>
          <View style={styles.translationBox}>
            <Text style={styles.translationDash}>—</Text>
            {translation ? (
              <Text
                style={[
                  styles.translationText,
                  isUntranslatable && styles.translationUntranslatable,
                ]}
              >
                {isUntranslatable ? '(same as source)' : translation.toLowerCase()}
              </Text>
            ) : (
              <Text style={styles.noTranslation}>No translation available</Text>
            )}
          </View>

          {sentenceExamples.length > 0 ? (
            sentenceExamples.map((example, idx) => (
              <View key={idx} style={styles.exampleCard}>
                {renderHighlightedSentence(example.sentence, phrase, example.matched_form)}
                {example.translation && (
                  <Text style={styles.exampleTranslation}>
                    {example.translation.toLowerCase()}
                  </Text>
                )}
              </View>
            ))
          ) : movieId ? (
            <Text style={styles.noExamples}>No sentence examples available</Text>
          ) : null}
        </View>
      )}
    </View>
  );
};

// Search Results Screen
const SearchResultsScreen = ({
  query,
  onBack,
  onMoviePress,
}: {
  query: string;
  onBack: () => void;
  onMoviePress: (movie: MovieData) => void;
}) => {
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Routing prefixes:
  //  - `genre:<id>:<displayName>` → TMDB discover endpoint (legacy quick-start)
  //  - `level:<LEVEL>:<displayName>` → our backend `/movies/by-cefr` (CEFR levels)
  //    or `/movies/by-level` (old enum), with per-row TMDB enrichment.
  //  - anything else → TMDB title text search.
  const levelMatch = query.match(/^level:([A-Z_\d]+):(.+)$/);
  const genreMatch = query.match(/^genre:([\d|]+):(.+)$/);
  const isLevel = !!levelMatch;
  const isGenre = !isLevel && !!genreMatch;
  const levelValue = levelMatch?.[1] ?? '';
  const isCefrLevel = /^[ABC][12]$/.test(levelValue);
  const genreIds = genreMatch?.[1] ?? '';
  const displayTitle = isLevel
    ? `${levelMatch![2]} movies`
    : isGenre
    ? genreMatch![2]
    : `Results for "${query}"`;

  const searchPage = async (pageNum: number) => {
    try {
      if (isLevel) {
        if (pageNum > 1) return { movies: [], totalPages: 1 };
        const data = isCefrLevel
          ? await wordwiseApi.getMoviesByCefr(levelValue, 100)
          : await wordwiseApi.getMoviesByLevel(levelValue, 100);
        // Enrich each row with TMDB metadata when tmdb_id is known. We don't
        // store poster_path locally, so without TMDB the cards would be blank.
        const enriched = await Promise.all(
          (data.movies || []).map(async (m) => {
            let tmdb: any = null;
            if (m.tmdb_id) {
              try { tmdb = await tmdbApi.getMovieDetails(m.tmdb_id); } catch { tmdb = null; }
            }
            return {
              id: tmdb?.id ?? m.tmdb_id ?? -m.movie_id,
              title: tmdb?.title ?? m.title,
              poster_path: tmdb?.poster_path ?? null,
              release_date: tmdb?.release_date ?? (m.year ? `${m.year}-01-01` : ''),
              overview: tmdb?.overview ?? (m.description ?? ''),
              genre_ids: tmdb?.genre_ids ?? [],
              vote_average: tmdb?.vote_average ?? (m as any).vote_average ?? 0,
              original_language: tmdb?.original_language ?? 'en',
            };
          })
        );
        // Drop non-English films — WordWise can't process their subtitles
        // yet, so surfacing them in Quick Start would be misleading.
        const englishOnly = enriched.filter((m) => (m.original_language || 'en') === 'en');
        return { movies: englishOnly, totalPages: 1 };
      }

      // For genre quick-start: top-rated within genre, restricted to widely
      // rated films (>=5k votes) and English originals only — WordWise can
      // only process English subtitles right now, so foreign titles would
      // just dead-end at script fetch.
      const url = isGenre
        ? `https://api.themoviedb.org/3/discover/movie?api_key=9dece7a38786ac0c58794d6db4af3d51&with_genres=${encodeURIComponent(genreIds)}&with_original_language=en&sort_by=vote_average.desc&vote_count.gte=5000&include_adult=false&page=${pageNum}`
        : `https://api.themoviedb.org/3/search/movie?api_key=9dece7a38786ac0c58794d6db4af3d51&query=${encodeURIComponent(query)}&page=${pageNum}`;
      const res = await fetch(url);
      const data = await res.json();
      return {
        movies: data.results || [],
        totalPages: data.total_pages || 1,
      };
    } catch {
      return { movies: [], totalPages: 1 };
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { movies, totalPages } = await searchPage(1);
      setResults(movies);
      setHasMore(1 < totalPages);
      setPage(1);
      setLoading(false);
    })();
  }, [query]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const nextPage = page + 1;
    const { movies, totalPages } = await searchPage(nextPage);
    setResults((prev) => [...prev, ...movies]);
    setPage(nextPage);
    setHasMore(nextPage < totalPages);
    setLoadingMore(false);
  };

  const handlePress = (movie: any) => {
    onMoviePress({
      id: movie.id,
      title: movie.title,
      poster_path: movie.poster_path,
      release_date: movie.release_date,
      overview: movie.overview,
      genre_ids: movie.genre_ids,
      vote_average: movie.vote_average,
      original_language: movie.original_language,
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.detailHeader}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.detailHeaderTitle} numberOfLines={1}>
          {displayTitle}
        </Text>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={[styles.container, styles.centered]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.searchResultItem}
              onPress={() => handlePress(item)}
              activeOpacity={0.7}
            >
              {item.poster_path ? (
                <Image
                  source={{ uri: `https://image.tmdb.org/t/p/w92${item.poster_path}` }}
                  style={styles.searchResultPoster}
                />
              ) : (
                <View style={[styles.searchResultPoster, { backgroundColor: colors.border }]} />
              )}
              <View style={styles.searchResultInfo}>
                <Text style={styles.searchResultTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.searchResultYear}>
                  {item.release_date?.slice(0, 4)}
                  {item.vote_average ? `  ⭐ ${item.vote_average.toFixed(1)}` : ''}
                </Text>
                {item.overview ? (
                  <Text style={styles.searchResultOverview} numberOfLines={2}>{item.overview}</Text>
                ) : null}
              </View>
            </TouchableOpacity>
          )}
          contentContainerStyle={{ paddingHorizontal: 16 }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator size="small" color={colors.primary} style={{ padding: 16 }} />
            ) : hasMore ? (
              <TouchableOpacity style={styles.seeAllButton} onPress={loadMore}>
                <Text style={styles.seeAllText}>Load more</Text>
              </TouchableOpacity>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
};

// Movie Detail Screen
const MovieDetailScreen = ({
  movie,
  onBack,
  targetLanguage,
}: {
  movie: MovieData;
  onBack: () => void;
  targetLanguage: string;
}) => {
  const targetLang = targetLanguage;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vocabulary, setVocabulary] = useState<VocabularyResponse | null>(null);
  const [activeLevel, setActiveLevel] = useState<string>('B1');
  const [viewMode, setViewMode] = useState<'levels' | 'idioms'>('levels');
  const [movieId, setMovieId] = useState<number | null>(null);
  const [difficulty, setDifficulty] = useState<{ level: string; score: number } | null>(null);
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());
  const isAuthenticated = useAuthStore((s) => s.status) === 'authenticated' || useAuthStore((s) => s.status) === 'offline_authenticated';

  // Animation for tab switching
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const prevLevelRef = useRef<string>(activeLevel);
  const prevViewModeRef = useRef<'levels' | 'idioms'>(viewMode);

  // Sliding indicator for Words/Expressions toggle (0 = Words, 1 = Expressions)
  const toggleIndicator = useRef(new Animated.Value(viewMode === 'idioms' ? 1 : 0)).current;

  // Animate when level OR viewMode changes
  useEffect(() => {
    const levelChanged = prevLevelRef.current !== activeLevel;
    const modeChanged = prevViewModeRef.current !== viewMode;

    if (levelChanged || modeChanged) {
      Animated.sequence([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
      prevLevelRef.current = activeLevel;
      prevViewModeRef.current = viewMode;
    }
  }, [activeLevel, viewMode, fadeAnim]);

  // Slide the toggle indicator when viewMode changes
  useEffect(() => {
    Animated.timing(toggleIndicator, {
      toValue: viewMode === 'idioms' ? 1 : 0,
      duration: 280,
      useNativeDriver: true, // transform is native-driver-safe
    }).start();
  }, [viewMode, toggleIndicator]);

  useEffect(() => {
    loadVocabulary();
  }, []);

  const loadVocabulary = async () => {
    setLoading(true);
    setError(null);

    try {
      // Go straight to fetch - the backend tries all sources (DB, subtitles, STANDS4 PDF/API)
      // Search is only needed for user-typed queries in the search bar
      const cleanTitle = movie.title.replace(/["""'']/g, '').trim();
      const scriptResult = await wordwiseApi.fetchScript('', cleanTitle);

      if (!scriptResult.cleaned_text || scriptResult.word_count < 100) {
        setError('Script too short or not found');
        setLoading(false);
        return;
      }

      setMovieId(scriptResult.movie_id);

      // Step 3: Classify vocabulary (pass genre names for difficulty scoring)
      const genreNames = movie.genre_ids?.map(id => tmdbGenres[id]).filter(Boolean) || [];
      await wordwiseApi.classifyVocabulary(scriptResult.movie_id, targetLang, genreNames);

      // Step 3b: Fetch difficulty score
      try {
        const diffRes = await fetch(`${API_BASE_URL}/movies/${scriptResult.movie_id}/difficulty`);
        if (diffRes.ok) {
          const diffData = await diffRes.json();
          if (diffData.difficulty_score != null) {
            setDifficulty({ level: diffData.difficulty_level, score: diffData.difficulty_score });
          }
        }
      } catch (diffErr) {
        console.log('[MovieDetail] Difficulty fetch failed:', diffErr);
      }

      // Step 4: Try to get full vocabulary first, fall back to preview
      let vocabResult: VocabularyResponse;
      try {
        console.log('[MovieDetail] Attempting to get full vocabulary...');
        vocabResult = await wordwiseApi.getVocabularyFull(scriptResult.movie_id);
        console.log('[MovieDetail] Got full vocabulary successfully');
      } catch (fullErr) {
        console.log('[MovieDetail] Full vocabulary failed, falling back to preview:', fullErr);
        // Fall back to preview if full vocabulary requires auth
        vocabResult = await wordwiseApi.getVocabularyPreview(scriptResult.movie_id);
        console.log('[MovieDetail] Got preview vocabulary');
      }
      setVocabulary(vocabResult);

      // Cache for offline access
      offlineCache.saveVocabulary(scriptResult.movie_id, movie.title, vocabResult);

      // Fetch saved words if authenticated
      if (isAuthenticated) {
        try {
          const saved = await wordwiseApi.getSavedWords();
          setSavedWords(new Set(saved.map(w => w.word)));
        } catch {
          // Non-critical: don't block vocabulary display
        }
      }

      // Set initial active level to the one with most words
      const levels = Object.entries(vocabResult.level_distribution);
      const maxLevel = levels.reduce((a, b) => (a[1] > b[1] ? a : b));
      setActiveLevel(maxLevel[0]);
    } catch (err: any) {
      console.error('Failed to load vocabulary:', err);
      // Try offline cache before showing error
      const cached = await offlineCache.getVocabulary(movie.id);
      if (cached) {
        setMovieId(movie.id);
        setVocabulary(cached);
        const levels = Object.entries(cached.level_distribution);
        if (levels.length > 0) {
          const maxLevel = levels.reduce((a, b) => (a[1] > b[1] ? a : b));
          setActiveLevel(maxLevel[0]);
        }
      } else {
        setError(err.message || 'Failed to load vocabulary');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSaveWord = async (word: string) => {
    if (!isAuthenticated) return;
    try {
      const result = await wordwiseApi.saveWord(word, movieId);
      setSavedWords(prev => {
        const next = new Set(prev);
        if (result.saved) {
          next.add(word);
        } else {
          next.delete(word);
        }
        return next;
      });
      // Log the interaction
      wordwiseApi.logInteraction(word, result.saved ? 'WORD_SAVE' : 'WORD_UNSAVE', movieId);
    } catch {
      // Silently fail — don't interrupt UX
    }
  };

  // CEFR level groups for the Words view
  const wordLevels = useMemo(() => {
    if (!vocabulary) return [];

    const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    return levels.map((level) => ({
      level,
      label: cefrLabels[level] || level,
      count: vocabulary.level_distribution[level as keyof typeof vocabulary.level_distribution] || 0,
      words: vocabulary.top_words_by_level[level] || [],
    }));
  }, [vocabulary]);

  const idioms = vocabulary?.idioms || [];
  const hasIdioms = idioms.length > 0;

  // CEFR level groups for the Expressions view (idioms grouped by their cefr_level)
  const idiomLevels = useMemo(() => {
    const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const byLevel: Record<string, any[]> = {};
    idioms.forEach((idiom) => {
      const lvl = (idiom.cefr_level || 'C1').toUpperCase();
      if (!byLevel[lvl]) byLevel[lvl] = [];
      byLevel[lvl].push(idiom);
    });
    return levels.map((level) => ({
      level,
      label: cefrLabels[level] || level,
      count: (byLevel[level] || []).length,
      words: [], // unused for idiom view
      idiomItems: byLevel[level] || [],
    }));
  }, [idioms]);

  // If user is in idioms view but there are no idioms, fall back to levels
  useEffect(() => {
    if (viewMode === 'idioms' && !hasIdioms) {
      setViewMode('levels');
    }
  }, [viewMode, hasIdioms]);

  const isIdiomsTab = viewMode === 'idioms';
  // Same CEFR tab UI drives both views — pick the source based on viewMode
  const mergedLevels = isIdiomsTab ? idiomLevels : wordLevels;
  const activeData = mergedLevels.find((l) => l.level === activeLevel);
  const activeWords = activeData?.words || [];
  const activeIdioms = (activeData as any)?.idiomItems || [];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.detailHeader}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.detailHeaderTitle} numberOfLines={1}>
          {movie.title}
        </Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Movie Info - always visible */}
      <View style={styles.movieInfoBar}>
        <Image
          source={{ uri: `https://image.tmdb.org/t/p/w185${movie.poster_path}` }}
          style={styles.detailPoster}
        />
        <View style={styles.movieInfoText}>
          <Text style={styles.movieInfoTitle}>{movie.title}</Text>
          <View style={styles.movieMetaRow}>
            <Text style={styles.movieInfoYear}>{movie.release_date?.slice(0, 4)}</Text>
            {movie.vote_average != null && (
              <Text style={styles.movieRating}>⭐ {movie.vote_average.toFixed(1)}</Text>
            )}
            {movie.original_language && (
              <Text style={styles.movieLanguage}>{movie.original_language.toUpperCase()}</Text>
            )}
          </View>
          {movie.genre_ids && movie.genre_ids.length > 0 && (
            <View style={styles.genreRow}>
              {movie.genre_ids.slice(0, 3).map((id) => (
                <View key={id} style={styles.genreChip}>
                  <Text style={styles.genreChipText}>{tmdbGenres[id] || 'Other'}</Text>
                </View>
              ))}
            </View>
          )}
          {difficulty && (
            <View style={[styles.difficultyChip, { backgroundColor: cefrColors[difficulty.level] || colors.primary }]}>
              <Text style={styles.difficultyChipText}>
                {difficulty.level} · {difficulty.score}%
              </Text>
            </View>
          )}
          {vocabulary && (
            <Text style={styles.movieInfoStats}>
              {vocabulary.unique_words} unique words
            </Text>
          )}
        </View>
      </View>
      {/* Overview */}
      {movie.overview ? (
        <View style={styles.overviewSection}>
          <Text style={styles.overviewTitle}>Overview</Text>
          <Text style={styles.overviewText}>{movie.overview}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={[styles.container, styles.centered]}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Analyzing vocabulary...</Text>
          <Text style={styles.loadingSubtext}>Searching script</Text>
          <Text style={styles.loadingSubtext}>Classifying words by CEFR level</Text>
        </View>
      ) : error ? (
        <View style={styles.scriptErrorBox}>
          <Text style={styles.scriptErrorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadVocabulary}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : vocabulary ? (
        <>

          {/* Words / Expressions top-level toggle with sliding indicator */}
          {hasIdioms && (
            <View style={styles.viewModeToggleWrapper}>
              <Animated.View
                style={[
                  styles.viewModeToggleIndicator,
                  {
                    transform: [
                      {
                        translateX: toggleIndicator.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, 130],
                        }),
                      },
                    ],
                  },
                ]}
              />
              <TouchableOpacity
                activeOpacity={0.7}
                style={styles.viewModeToggleBtn}
                onPress={() => setViewMode('levels')}
              >
                <Text style={[styles.viewModeToggleText, viewMode === 'levels' && styles.viewModeToggleTextActive]}>
                  Words
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.7}
                style={styles.viewModeToggleBtn}
                onPress={() => setViewMode('idioms')}
              >
                <Text style={[styles.viewModeToggleText, viewMode === 'idioms' && styles.viewModeToggleTextActive]}>
                  Expressions ({idioms.length})
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* CEFR Level Tabs - same component drives both Words and Expressions views */}
          <View style={styles.cefrTabsWrapper}>
            <View style={styles.cefrTabsGradientBorder}>
              <View style={styles.cefrTabsInner}>
                <View style={styles.cefrTabsContent}>
                  {mergedLevels.map((levelData) => (
                    <CEFRTab
                      key={levelData.level}
                      level={levelData.level}
                      label={levelData.label}
                      count={levelData.count}
                      active={activeLevel === levelData.level}
                      color={cefrColors[levelData.level] || colors.primary}
                      onPress={() => setActiveLevel(levelData.level)}
                    />
                  ))}
                </View>
              </View>
            </View>
          </View>


          {/* Level Description */}
          <View style={styles.levelDescription}>
            <View style={[styles.levelDot, { backgroundColor: cefrColors[activeLevel] || colors.primary }]} />
            <Text style={styles.levelDescText}>
              {cefrLabels[activeLevel] || 'Advanced'}
            </Text>
            <Text style={styles.levelWordCount}>
              {isIdiomsTab ? activeIdioms.length : activeWords.length} {isIdiomsTab ? 'expressions' : 'words'}
            </Text>
          </View>

          {/* Animated Word/Idiom List */}
          <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
            {isIdiomsTab ? (
              /* Idioms List - filtered by active CEFR level */
              <FlatList
                data={activeIdioms}
                keyExtractor={(item, index) => `idiom-${item.phrase}-${index}`}
                renderItem={({ item, index }) => (
                  <IdiomRow
                    idiom={item}
                    index={index}
                    rowNumber={index + 1}
                    groupColor={cefrColors[activeLevel] || colors.primary}
                    movieId={movieId}
                    targetLang={targetLang}
                    isSaved={savedWords.has(item.phrase)}
                    onSave={handleSaveWord}
                    isAuthenticated={isAuthenticated}
                  />
                )}
                contentContainerStyle={styles.wordList}
                showsVerticalScrollIndicator={false}
              />
            ) : (
              /* Word List */
              <FlatList
                data={activeWords}
                keyExtractor={(item, index) => `${item.word}-${index}`}
                renderItem={({ item, index }) => (
                  <WordRow
                    word={item}
                    index={index}
                    rowNumber={index + 1}
                    groupColor={cefrColors[activeLevel] || colors.primary}
                    movieId={movieId}
                    movieTitle={movie.title}
                    targetLang={targetLang}
                    isSaved={savedWords.has(item.word)}
                    onSave={handleSaveWord}
                    isAuthenticated={isAuthenticated}
                  />
                )}
                contentContainerStyle={styles.wordList}
                showsVerticalScrollIndicator={false}
              />
            )}
          </Animated.View>
        </>
      ) : null}
    </SafeAreaView>
  );
};

export default function App() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);
  const logout = useAuthStore((s) => s.logout);
  const initialize = useAuthStore((s) => s.initialize);

  // Navigation state
  const [currentScreen, setCurrentScreen] = useState<Screen>('home');
  const [selectedMovie, setSelectedMovie] = useState<MovieData | null>(null);
  const [searchQueryNav, setSearchQueryNav] = useState('');
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

  const navigateToNotebook = () => {
    setCurrentScreen('notebook');
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
        <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
        <LoadingScreen />
      </SafeAreaProvider>
    );
  }

  const isAuthenticated = status === 'authenticated' || status === 'offline_authenticated';

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor={colors.paper} />
      {isAuthenticated ? (
        currentScreen === 'settings' ? (
          <SettingsScreen onBack={navigateToHome} user={user} onUserUpdated={handleUserUpdated} onNavigateToFamilyPlan={navigateToFamilyPlan} onNavigateToPrivacy={navigateToPrivacy} onNavigateToTerms={navigateToTerms} />
        ) : currentScreen === 'admin' ? (
          <AdminScreen onBack={navigateToHome} />
        ) : currentScreen === 'review' ? (
          <ReviewScreen onBack={navigateToHome} onPaywall={navigateToPaywall} />
        ) : currentScreen === 'paywall' ? (
          <PaywallScreen onBack={navigateToHome} previewsUsed={paywallProps.previewsUsed} previewsLimit={paywallProps.previewsLimit} />
        ) : currentScreen === 'stats' ? (
          <StatsScreen onBack={navigateToHome} onStartReview={navigateToReview} />
        ) : currentScreen === 'notebook' ? (
          <NotebookScreen onBack={navigateToHome} />
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
        ) : currentScreen === 'movieDetail' && selectedMovie ? (
          <MovieDetailScreen movie={selectedMovie} onBack={navigateToHome} targetLanguage={targetLanguage} />
        ) : currentScreen === 'searchResults' && searchQueryNav ? (
          <SearchResultsScreen query={searchQueryNav} onBack={navigateToHome} onMoviePress={navigateToMovie} />
        ) : (
          <HomeScreen onLogout={logout} onMoviePress={navigateToMovie} onSearch={navigateToSearch} user={user} targetLanguage={targetLanguage} setTargetLanguage={setTargetLanguage} onNavigateToSettings={navigateToSettings} onNavigateToAdmin={navigateToAdmin} onNavigateToReview={navigateToReview} onNavigateToStats={navigateToStats} onNavigateToNotebook={navigateToNotebook} onNavigateToAchievements={navigateToAchievements} onNavigateToLeaderboard={navigateToLeaderboard} />
        )
      ) : (
        <LoginScreen onLogin={handleLogin} />
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  viewAsBadge: {
    backgroundColor: '#F4A261',
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  viewAsBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  reviewCta: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#7C5CBF',
    borderRadius: 14,
    padding: 16,
    shadowColor: '#7C5CBF',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  reviewCtaLeft: { flex: 1 },
  reviewCtaTitle: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  reviewCtaSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  reviewCtaWrapper: { marginHorizontal: 16, marginTop: 20 },
  reviewCtaArrow: { fontSize: 22, color: '#FFFFFF', fontWeight: '700', marginLeft: 8 },
  homeNavToggleWrapper: {
    flexDirection: 'row',
    alignSelf: 'center',
    marginTop: 14,
    backgroundColor: colors.paper,
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  homeNavToggleBtn: {
    paddingHorizontal: 14,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  homeNavToggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#7C5CBF',
  },
  todayCard: {
    marginHorizontal: 16,
    marginTop: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E8E8EC',
  },
  todayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  todayLabel: { fontSize: 12, fontWeight: '700', color: '#7C5CBF', textTransform: 'uppercase', letterSpacing: 0.5 },
  todayMovie: { fontSize: 12, color: '#9AA0AE' },
  todayWord: { fontSize: 28, fontWeight: '800', color: '#2D3142', marginBottom: 8 },
  todayDef: { fontSize: 14, color: '#5C6378', lineHeight: 20, marginBottom: 8 },
  todaySentence: { fontSize: 13, color: '#9AA0AE', fontStyle: 'italic', lineHeight: 18, marginBottom: 12 },
  todaySaveBtn: {
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#7C5CBF',
    alignItems: 'center',
  },
  todaySaveBtnSaved: { borderColor: '#4CAF9A', backgroundColor: '#F0FAF6' },
  todaySaveBtnText: { fontSize: 14, fontWeight: '700', color: '#7C5CBF' },
  todaySaveBtnTextSaved: { color: '#4CAF9A' },
  todayNudge: { fontSize: 12, color: '#7C5CBF', fontWeight: '500', marginTop: 10 },
  adBanner: {
    height: 60,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 10,
    backgroundColor: '#F0EDE8',
    borderWidth: 1,
    borderColor: '#E0DDD8',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  adBannerText: { fontSize: 12, color: '#9AA0AE', fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loginContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  logo: {
    fontSize: 36,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: 8,
  },
  tagline: {
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: 48,
    textAlign: 'center',
  },
  formContainer: {
    width: '100%',
    gap: 12,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper,
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  googleIcon: {
    fontSize: 18,
    fontWeight: '700',
    color: '#4285F4',
  },
  googleButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    paddingHorizontal: 16,
    color: colors.textSecondary,
    fontSize: 14,
  },
  input: {
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    color: colors.text,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  switchButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  switchButtonText: {
    color: colors.primary,
    fontSize: 14,
  },
  loginError: {
    color: colors.error,
    fontSize: 14,
    textAlign: 'center',
  },
  secondaryButton: {
    backgroundColor: colors.paper,
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonText: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: '500',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.paper,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.primary,
  },
  logoutText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  languageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  adminButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adminButtonText: {
    fontSize: 18,
    color: colors.primary,
    fontWeight: '600',
  },
  languageButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  languageDropdownIcon: {
    fontSize: 10,
    color: colors.textSecondary,
  },
  avatarButton: {
    padding: 2,
  },
  avatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  dropdownMenu: {
    position: 'absolute',
    top: 60,
    right: 16,
    backgroundColor: colors.paper,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 1000,
    minWidth: 180,
    maxHeight: 300,
    borderWidth: 1,
    borderColor: colors.border,
  },
  userDropdownMenu: {
    right: 16,
  },
  dropdownScroll: {
    maxHeight: 280,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
  },
  dropdownItemActive: {
    backgroundColor: colors.background,
  },
  dropdownItemCode: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
    width: 28,
  },
  dropdownItemText: {
    fontSize: 14,
    color: colors.text,
  },
  dropdownItemIcon: {
    fontSize: 16,
  },
  dropdownUserInfo: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  dropdownUserName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  dropdownUserEmail: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  dropdownDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: colors.paper,
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.background,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: colors.primary,
  },
  tabText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  tabTextActive: {
    color: '#fff',
  },
  scrollView: {
    flex: 1,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    position: 'relative',
    zIndex: 200,
    overflow: 'visible',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchButton: {
    backgroundColor: colors.primary,
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchButtonText: {
    fontSize: 18,
  },
  searchInputWrapper: {
    flex: 1,
    position: 'relative',
    zIndex: 100,
  },
  autocompleteDropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: colors.paper,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    zIndex: 100,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  seeAllButton: {
    paddingVertical: 12,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  seeAllText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  searchClear: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  searchClearText: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  searchResultsList: {
    paddingHorizontal: 16,
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchResultPoster: {
    width: 46,
    height: 69,
    borderRadius: 4,
  },
  searchResultInfo: {
    flex: 1,
    marginLeft: 12,
  },
  searchResultTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  searchResultYear: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  searchResultOverview: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
    lineHeight: 16,
  },
  searchInput: {
    flex: 1,
    backgroundColor: colors.paper,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  section: {
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 14,
  },
  browseAllButton: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 28,
    paddingVertical: 12,
  },
  browseAllText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.primary,
  },
  homeTabToggleWrapper: {
    flexDirection: 'row',
    alignSelf: 'center',
    marginTop: 20,
    backgroundColor: colors.paper,
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  homeTabToggleBtn: {
    paddingHorizontal: 16,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  homeTabToggleBtnActive: {
    backgroundColor: '#9c27b015',
  },
  homeTabToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  homeTabToggleTextActive: {
    color: '#9c27b0',
  },
  levelSortRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
    paddingHorizontal: 16,
  },
  levelSortChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.border,
  },
  levelSortChipActive: {
    backgroundColor: '#9c27b015',
    borderColor: '#9c27b0',
  },
  levelSortText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  levelSortTextActive: {
    color: '#9c27b0',
  },
  skeletonContainer: {
    paddingTop: 4,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  skeletonPoster: {
    width: 60,
    height: 90,
    borderRadius: 6,
    backgroundColor: colors.border,
    marginRight: 14,
    marginLeft: 48,
  },
  skeletonInfo: {
    flex: 1,
  },
  skeletonLine: {
    height: 12,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  carousel: {
    paddingRight: 16,
  },
  movieCard: {
    width: 130,
    marginRight: 12,
  },
  moviePoster: {
    width: 130,
    height: 195,
    borderRadius: 8,
    backgroundColor: colors.border,
  },
  movieTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginTop: 8,
  },
  movieYear: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  featureGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  featureCard: {
    flex: 1,
    backgroundColor: colors.paper,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  featureIcon: {
    fontSize: 28,
    marginBottom: 8,
  },
  featureTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  featureDesc: {
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
  },
  loader: {
    paddingVertical: 40,
  },
  // Movie Detail Screen styles
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.paper,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  detailHeaderTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
    textAlign: 'center',
  },
  backButton: {
    paddingVertical: 8,
    paddingRight: 12,
  },
  backButtonText: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: '600',
  },
  loadingText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginTop: 20,
  },
  loadingSubtext: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
  },
  errorText: {
    fontSize: 16,
    color: colors.error,
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 20,
  },
  movieInfoBar: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: colors.paper,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  detailPoster: {
    width: 80,
    height: 120,
    borderRadius: 6,
    backgroundColor: colors.border,
  },
  movieInfoText: {
    flex: 1,
    marginLeft: 16,
    justifyContent: 'center',
  },
  movieInfoTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  movieMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  movieInfoYear: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  movieRating: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  movieLanguage: {
    fontSize: 12,
    color: colors.textSecondary,
    backgroundColor: colors.border,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  genreRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 6,
  },
  genreChip: {
    backgroundColor: colors.primaryLight + '20',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  genreChipText: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: '600',
  },
  difficultyChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 4,
  },
  difficultyChipText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '700',
  },
  overviewSection: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.paper,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  overviewTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  overviewText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  scriptErrorBox: {
    margin: 16,
    padding: 16,
    backgroundColor: colors.paper,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  scriptErrorText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 12,
  },
  retryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  movieInfoStats: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
  },
  // CEFR Tabs - Polished gradient border design
  cefrTabsWrapper: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: colors.paper,
  },
  cefrTabsGradientBorder: {
    borderRadius: 16,
    padding: 2,
    // Simulate gradient border with a colored background
    backgroundColor: colors.primaryLight,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cefrTabsInner: {
    backgroundColor: colors.paper,
    borderRadius: 14,
    overflow: 'hidden',
  },
  cefrTabsContent: {
    flexDirection: 'row',
    paddingHorizontal: 2,
    paddingVertical: 4,
  },
  cefrTab: {
    flex: 1,
    paddingHorizontal: 4,
    paddingVertical: 10,
    marginHorizontal: 1,
    borderRadius: 10,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cefrTabActive: {
    // Background color is set dynamically with level color
  },
  cefrTabLevel: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  cefrTabInactive: {
    opacity: 0.5,
  },
  cefrTabCount: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  cefrTabCountActive: {
    color: 'rgba(255,255,255,0.9)',
  },
  levelDescription: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  levelDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  levelDescText: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '600',
  },
  levelWordCount: {
    fontSize: 14,
    color: colors.textSecondary,
    marginLeft: 8,
  },
  // Word List - Polished design
  wordList: {
    paddingBottom: 40,
  },
  wordRowWrapper: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  wordRow: {
    backgroundColor: colors.paper,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  wordRowExpanded: {
    backgroundColor: `${colors.primary}08`, // Very subtle highlight
  },
  wordRowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 28,
  },
  rowNumber: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
    opacity: 0.6,
    minWidth: 32,
    textAlign: 'right',
    marginRight: 12,
  },
  wordText: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
    flex: 1,
  },
  inlineSpinner: {
    marginRight: 8,
  },
  expandIcon: {
    fontSize: 10,
    color: colors.textSecondary,
    opacity: 0.5,
    marginLeft: 8,
  },
  expandIconRotated: {
    transform: [{ rotate: '180deg' }],
  },
  bookmarkButton: {
    marginLeft: 4,
    padding: 4,
  },
  bookmarkIcon: {
    fontSize: 18,
    color: colors.textSecondary,
    opacity: 0.5,
  },
  bookmarkIconActive: {
    color: colors.primary,
    opacity: 1,
  },
  flagButton: {
    marginLeft: 4,
    padding: 4,
  },
  flagIcon: {
    fontSize: 16,
    color: colors.textSecondary,
    opacity: 0.5,
  },
  // Dropdown Panel
  dropdownPanel: {
    backgroundColor: `${colors.background}`,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderLeftWidth: 3,
    paddingVertical: 12,
    paddingHorizontal: 16,
    paddingLeft: 56, // Align with word text (past row number)
  },
  translationBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  translationDash: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '300',
  },
  translationText: {
    fontSize: 14,
    color: colors.text,
  },
  translationUntranslatable: {
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  noTranslation: {
    fontSize: 14,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  // Words/Expressions top-level toggle
  viewModeToggleWrapper: {
    flexDirection: 'row',
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 8,
    backgroundColor: colors.paper,
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    position: 'relative',
  },
  viewModeToggleIndicator: {
    position: 'absolute',
    top: 4,
    left: 4,
    width: 130,
    height: 30,
    backgroundColor: '#9c27b015',
    borderRadius: 8,
  },
  viewModeToggleBtn: {
    width: 130,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  viewModeToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  viewModeToggleTextActive: {
    color: '#9c27b0',
  },
  // Idiom Tab styles
  idiomTabContent: {
    alignItems: 'center',
  },
  idiomTabText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  // Idiom Row styles
  idiomTypeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 8,
  },
  phrasalVerbBadge: {
    backgroundColor: '#2196F3', // Blue for phrasal verbs
  },
  idiomBadge: {
    backgroundColor: colors.warning, // Orange for idioms
  },
  idiomTypeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#fff',
  },
  cefrBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 4,
  },
  cefrBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  idiomWordsText: {
    fontSize: 14,
    color: colors.textSecondary,
    flex: 1,
  },
  exampleCard: {
    backgroundColor: '#e3f2fd',
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 8,
  },
  exampleSentence: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
  highlightedWord: {
    fontWeight: '700',
    color: colors.primary,
  },
  exampleTranslation: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
    fontStyle: 'italic',
  },
  sentenceTranslationSkeleton: {
    height: 12,
    width: '60%',
    backgroundColor: colors.border,
    borderRadius: 4,
    marginTop: 6,
    opacity: 0.5,
  },
  noExamples: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 8,
    fontStyle: 'italic',
  },
  pronounceBtn: { marginLeft: 4, paddingHorizontal: 4 },
  pronounceIcon: { fontSize: 14 },
  pronounceIconActive: { opacity: 0.4 },
  crossMovieSection: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F0EDE8' },
  crossMovieLabel: { fontSize: 11, fontWeight: '700', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  crossMovieItem: { marginBottom: 8 },
  crossMovieMovie: { fontSize: 12, fontWeight: '600', color: colors.text, marginBottom: 2 },
  crossMovieSentence: { fontSize: 12, color: colors.textSecondary, fontStyle: 'italic', lineHeight: 16 },
});
