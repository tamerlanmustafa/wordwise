import React, { useEffect, useState, useRef, useMemo } from 'react';
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
  ActivityIndicator,
  FlatList,
  Animated,
  Modal,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { useAuthStore } from '../stores/authStore';
import { wordwiseApi, type VocabularyResponse, type WordInfo, type IdiomInfo } from '../services/api';
import { GOOGLE_CLIENT_ID_IOS } from '../config/env';

// Configure Google Sign-In
console.log('[Google Sign-In] Configuring with iOS Client ID:', GOOGLE_CLIENT_ID_IOS);
GoogleSignin.configure({
  iosClientId: GOOGLE_CLIENT_ID_IOS,
  scopes: ['profile', 'email'],
});
console.log('[Google Sign-In] Configuration complete');

// Types for navigation
type Screen = 'home' | 'movieDetail';
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
const MovieCard = ({ movie, onPress }: { movie: any; onPress: () => void }) => (
  <TouchableOpacity style={styles.movieCard} onPress={onPress} activeOpacity={0.8}>
    <Image
      source={{ uri: `https://image.tmdb.org/t/p/w300${movie.poster_path}` }}
      style={styles.moviePoster}
    />
    <Text style={styles.movieTitle} numberOfLines={2}>{movie.title}</Text>
    <Text style={styles.movieYear}>{movie.release_date?.slice(0, 4)}</Text>
  </TouchableOpacity>
);

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

// Simple Manual Carousel Component
const Carousel = ({
  data,
  renderItem,
}: {
  data: any[];
  renderItem: (item: any) => React.ReactNode;
}) => {
  if (data.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
    >
      {data.map((item, index) => (
        <View key={`${item.id}-${index}`}>
          {renderItem(item)}
        </View>
      ))}
    </ScrollView>
  );
};

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
  user,
}: {
  onLogout: () => void;
  onMoviePress: (movie: MovieData) => void;
  user: any;
}) => {
  const [activeTab, setActiveTab] = useState<'movies' | 'books'>('movies');
  const [searchQuery, setSearchQuery] = useState('');
  const [trendingMovies, setTrendingMovies] = useState<any[]>([]);
  const [topRatedMovies, setTopRatedMovies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showLanguageMenu, setShowLanguageMenu] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState(user?.native_language?.toUpperCase() || 'ES');

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

  const fetchMovies = async () => {
    try {
      const [trendingRes, topRatedRes] = await Promise.all([
        fetch('https://api.themoviedb.org/3/trending/movie/day?api_key=9dece7a38786ac0c58794d6db4af3d51'),
        fetch('https://api.themoviedb.org/3/movie/top_rated?api_key=9dece7a38786ac0c58794d6db4af3d51'),
      ]);
      const [trendingData, topRatedData] = await Promise.all([
        trendingRes.json(),
        topRatedRes.json(),
      ]);
      setTrendingMovies(trendingData.results?.slice(0, 15) || []);
      setTopRatedMovies(topRatedData.results?.slice(0, 15) || []);
    } catch (error) {
      console.error('Failed to fetch movies:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMoviePress = (movie: any) => {
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

  const handleBookPress = (book: any) => {
    // TODO: Navigate to book detail
    console.log('Book pressed:', book.title);
  };

  const currentLang = AVAILABLE_LANGUAGES.find(l => l.code === targetLanguage) || AVAILABLE_LANGUAGES[0];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>WordWise</Text>

        <View style={styles.headerRight}>
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
              // TODO: Navigate to settings
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

      {/* Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'movies' && styles.tabActive]}
          onPress={() => setActiveTab('movies')}
        >
          <Text style={[styles.tabText, activeTab === 'movies' && styles.tabTextActive]}>
            🎬 Movies
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'books' && styles.tabActive]}
          onPress={() => setActiveTab('books')}
        >
          <Text style={[styles.tabText, activeTab === 'books' && styles.tabTextActive]}>
            📚 Books
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder={activeTab === 'movies' ? 'Search movies...' : 'Search books...'}
            placeholderTextColor={colors.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        {activeTab === 'movies' ? (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>⭐ Top Rated</Text>
              {loading ? (
                <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
              ) : (
                <Carousel
                  data={topRatedMovies}
                  renderItem={(movie) => (
                    <MovieCard movie={movie} onPress={() => handleMoviePress(movie)} />
                  )}
                />
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>🔥 Trending Now</Text>
              {loading ? (
                <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
              ) : (
                <Carousel
                  data={trendingMovies}
                  renderItem={(movie) => (
                    <MovieCard movie={movie} onPress={() => handleMoviePress(movie)} />
                  )}
                />
              )}
            </View>

            {/* Features */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>How it works</Text>
              <View style={styles.featureGrid}>
                <View style={styles.featureCard}>
                  <Text style={styles.featureIcon}>🎬</Text>
                  <Text style={styles.featureTitle}>Pick a Movie</Text>
                  <Text style={styles.featureDesc}>Search any film</Text>
                </View>
                <View style={styles.featureCard}>
                  <Text style={styles.featureIcon}>📝</Text>
                  <Text style={styles.featureTitle}>Get Words</Text>
                  <Text style={styles.featureDesc}>CEFR-graded vocab</Text>
                </View>
                <View style={styles.featureCard}>
                  <Text style={styles.featureIcon}>🎯</Text>
                  <Text style={styles.featureTitle}>Learn</Text>
                  <Text style={styles.featureDesc}>Before watching</Text>
                </View>
              </View>
            </View>
          </>
        ) : (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>📖 Popular Books</Text>
              <Carousel
                data={popularBooks}
                renderItem={(book) => (
                  <BookCard book={book} onPress={() => handleBookPress(book)} />
                )}
              />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>📚 Classic Literature</Text>
              <Carousel
                data={classicBooks}
                renderItem={(book) => (
                  <BookCard book={book} onPress={() => handleBookPress(book)} />
                )}
              />
            </View>

            {/* Book Features */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Why Read with WordWise?</Text>
              <View style={styles.featureGrid}>
                <View style={styles.featureCard}>
                  <Text style={styles.featureIcon}>📚</Text>
                  <Text style={styles.featureTitle}>Free Classics</Text>
                  <Text style={styles.featureDesc}>Public domain</Text>
                </View>
                <View style={styles.featureCard}>
                  <Text style={styles.featureIcon}>📊</Text>
                  <Text style={styles.featureTitle}>CEFR Levels</Text>
                  <Text style={styles.featureDesc}>A1 to C2</Text>
                </View>
                <View style={styles.featureCard}>
                  <Text style={styles.featureIcon}>📤</Text>
                  <Text style={styles.featureTitle}>Upload</Text>
                  <Text style={styles.featureDesc}>EPUB, PDF</Text>
                </View>
              </View>
            </View>
          </>
        )}

        {/* Bottom spacing */}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

// Loading Screen
const LoadingScreen = () => (
  <View style={[styles.container, styles.centered]}>
    <Text style={styles.logo}>WordWise</Text>
    <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 20 }} />
  </View>
);

// Word Row Component - Polished design matching web app
const WordRow = ({
  word,
  index,
  rowNumber,
  groupColor,
}: {
  word: WordInfo;
  index: number;
  rowNumber: number;
  groupColor: string;
}) => {
  const [expanded, setExpanded] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);

  const handlePress = async () => {
    // If already expanded, just collapse
    if (expanded) {
      setExpanded(false);
      return;
    }

    // If translation already fetched, just expand
    if (translation) {
      setExpanded(true);
      return;
    }

    // Fetch translation first, then expand
    setTranslating(true);
    try {
      const result = await wordwiseApi.translate(word.word, 'TR'); // Turkish as default
      setTranslation(result.translated);
      setExpanded(true);
    } catch (error) {
      setTranslation('Translation failed');
      setExpanded(true);
    } finally {
      setTranslating(false);
    }
  };

  const isUntranslatable = translation && translation.toLowerCase() === word.word.toLowerCase();

  return (
    <View style={styles.wordRowWrapper}>
      <TouchableOpacity
        style={[styles.wordRow, expanded && styles.wordRowExpanded]}
        onPress={handlePress}
        activeOpacity={0.7}
      >
        <View style={styles.wordRowMain}>
          {/* Row Number */}
          <Text style={styles.rowNumber}>{rowNumber}.</Text>

          {/* Word Text */}
          <Text style={styles.wordText}>{word.word}</Text>

          {/* Loading Spinner (inline) */}
          {translating && (
            <ActivityIndicator
              size="small"
              color={colors.primary}
              style={styles.inlineSpinner}
            />
          )}

          {/* Expand Icon */}
          <Text style={[styles.expandIcon, expanded && styles.expandIconRotated]}>
            ▼
          </Text>
        </View>
      </TouchableOpacity>

      {/* Dropdown Panel */}
      {expanded && (
        <View style={[styles.dropdownPanel, { borderLeftColor: groupColor }]}>
          {/* Translation with dash prefix */}
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

// Idiom Row Component - for the Idioms tab
const IdiomRow = ({
  idiom,
  index,
  rowNumber,
}: {
  idiom: IdiomInfo;
  index: number;
  rowNumber: number;
}) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={styles.wordRowWrapper}>
      <TouchableOpacity
        style={[styles.wordRow, expanded && styles.wordRowExpanded]}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
      >
        <View style={styles.wordRowMain}>
          <Text style={styles.rowNumber}>{rowNumber}.</Text>
          <Text style={styles.wordText}>{idiom.phrase}</Text>
          <View style={[styles.idiomTypeBadge, idiom.type === 'phrasal_verb' ? styles.phrasalVerbBadge : styles.idiomBadge]}>
            <Text style={styles.idiomTypeText}>
              {idiom.type === 'phrasal_verb' ? 'phrasal verb' : 'idiom'}
            </Text>
          </View>
          <View style={[styles.cefrBadge, { backgroundColor: cefrColors[idiom.cefr_level] || colors.primary }]}>
            <Text style={styles.cefrBadgeText}>{idiom.cefr_level}</Text>
          </View>
          <Text style={[styles.expandIcon, expanded && styles.expandIconRotated]}>▼</Text>
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={[styles.dropdownPanel, { borderLeftColor: colors.warning }]}>
          <View style={styles.translationBox}>
            <Text style={styles.translationDash}>—</Text>
            <Text style={styles.idiomWordsText}>
              Words: {idiom.words.join(', ')}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
};

// Movie Detail Screen
const MovieDetailScreen = ({
  movie,
  onBack,
}: {
  movie: MovieData;
  onBack: () => void;
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vocabulary, setVocabulary] = useState<VocabularyResponse | null>(null);
  const [activeLevel, setActiveLevel] = useState<string>('B1');
  const [movieId, setMovieId] = useState<number | null>(null);

  // Animation for tab switching
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const prevLevelRef = useRef<string>(activeLevel);

  // Animate when level changes
  useEffect(() => {
    if (prevLevelRef.current !== activeLevel) {
      // Fade out and in
      Animated.sequence([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
      prevLevelRef.current = activeLevel;
    }
  }, [activeLevel, fadeAnim]);

  useEffect(() => {
    loadVocabulary();
  }, []);

  const loadVocabulary = async () => {
    setLoading(true);
    setError(null);

    try {
      // Step 1: Search for the movie script
      const searchResult = await wordwiseApi.searchMovies(movie.title);

      if (!searchResult.results || searchResult.results.length === 0) {
        setError(`No script found for "${movie.title}"`);
        setLoading(false);
        return;
      }

      // Step 2: Fetch the script
      const scriptId = searchResult.results[0].id;
      const scriptResult = await wordwiseApi.fetchScript(scriptId, movie.title);

      if (!scriptResult.cleaned_text || scriptResult.word_count < 100) {
        setError('Script too short or not found');
        setLoading(false);
        return;
      }

      setMovieId(scriptResult.movie_id);

      // Step 3: Classify vocabulary
      await wordwiseApi.classifyVocabulary(scriptResult.movie_id, 'TR');

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

      // Set initial active level to the one with most words
      const levels = Object.entries(vocabResult.level_distribution);
      const maxLevel = levels.reduce((a, b) => (a[1] > b[1] ? a : b));
      setActiveLevel(maxLevel[0]);
    } catch (err: any) {
      console.error('Failed to load vocabulary:', err);
      setError(err.message || 'Failed to load vocabulary');
    } finally {
      setLoading(false);
    }
  };

  // Merge C1 and C2 into Advanced, and add Idioms tab
  const mergedLevels = useMemo(() => {
    if (!vocabulary) return [];

    const levels = ['A1', 'A2', 'B1', 'B2', 'C1'];
    const result = levels.map((level) => {
      if (level === 'C1') {
        // Merge C1 and C2
        const c1Count = vocabulary.level_distribution.C1 || 0;
        const c2Count = vocabulary.level_distribution.C2 || 0;
        const c1Words = vocabulary.top_words_by_level['C1'] || [];
        const c2Words = vocabulary.top_words_by_level['C2'] || [];
        return {
          level: 'C1',
          label: 'Advanced',
          count: c1Count + c2Count,
          words: [...c1Words, ...c2Words].sort(
            (a, b) => (a.frequency_rank || 999999) - (b.frequency_rank || 999999)
          ),
          isIdioms: false,
        };
      }
      return {
        level,
        label: cefrLabels[level] || level,
        count: vocabulary.level_distribution[level as keyof typeof vocabulary.level_distribution] || 0,
        words: vocabulary.top_words_by_level[level] || [],
        isIdioms: false,
      };
    });

    // Add idioms tab if idioms exist
    if (vocabulary.idioms && vocabulary.idioms.length > 0) {
      result.push({
        level: 'IDIOMS',
        label: 'Idioms',
        count: vocabulary.idioms.length,
        words: [], // We'll use idioms separately
        isIdioms: true,
      });
    }

    return result;
  }, [vocabulary]);

  const activeData = mergedLevels.find((l) => l.level === activeLevel);
  const activeWords = activeData?.words || [];
  const isIdiomsTab = activeData?.isIdioms || false;
  const idioms = vocabulary?.idioms || [];

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

      {loading ? (
        <View style={[styles.container, styles.centered]}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Analyzing vocabulary...</Text>
          <Text style={styles.loadingSubtext}>Searching script</Text>
          <Text style={styles.loadingSubtext}>Classifying words by CEFR level</Text>
        </View>
      ) : error ? (
        <View style={[styles.container, styles.centered]}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={onBack}>
            <Text style={styles.primaryButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      ) : vocabulary ? (
        <>
          {/* Movie Info */}
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
              <Text style={styles.movieInfoStats}>
                {vocabulary.unique_words} unique words
              </Text>
            </View>
          </View>
          {/* Overview */}
          {movie.overview ? (
            <View style={styles.overviewSection}>
              <Text style={styles.overviewTitle}>Overview</Text>
              <Text style={styles.overviewText}>{movie.overview}</Text>
            </View>
          ) : null}

          {/* CEFR Level Tabs - Gradient border container */}
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
            <View style={[styles.levelDot, { backgroundColor: isIdiomsTab ? colors.warning : (cefrColors[activeLevel] || colors.primary) }]} />
            <Text style={styles.levelDescText}>
              {isIdiomsTab ? 'Idioms & Phrases' : (cefrLabels[activeLevel] || 'Advanced')}
            </Text>
            <Text style={styles.levelWordCount}>
              {isIdiomsTab ? idioms.length : activeWords.length} {isIdiomsTab ? 'phrases' : 'words'}
            </Text>
          </View>

          {/* Animated Word/Idiom List */}
          <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
            {isIdiomsTab ? (
              /* Idioms List */
              <FlatList
                data={idioms}
                keyExtractor={(item, index) => `idiom-${item.phrase}-${index}`}
                renderItem={({ item, index }) => (
                  <IdiomRow
                    idiom={item}
                    index={index}
                    rowNumber={index + 1}
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

  useEffect(() => {
    initialize();
  }, [initialize]);

  const handleLogin = async (user: any, token: string) => {
    await login(user, token, token);
  };

  const navigateToMovie = (movie: MovieData) => {
    setSelectedMovie(movie);
    setCurrentScreen('movieDetail');
  };

  const navigateToHome = () => {
    setSelectedMovie(null);
    setCurrentScreen('home');
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
        currentScreen === 'movieDetail' && selectedMovie ? (
          <MovieDetailScreen movie={selectedMovie} onBack={navigateToHome} />
        ) : (
          <HomeScreen onLogout={logout} onMoviePress={navigateToMovie} user={user} />
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
  },
  searchInput: {
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
    marginBottom: 16,
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
});
