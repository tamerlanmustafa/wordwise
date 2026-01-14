import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  TextInput,
  ScrollView,
  Image,
  ActivityIndicator,
  Dimensions,
  FlatList,
  Animated,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../stores/authStore';
import { wordwiseApi, type VocabularyResponse, type WordInfo, type IdiomInfo } from '../services/api';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_WIDTH = 130;
const CARD_MARGIN = 12;

// Types for navigation
type Screen = 'home' | 'movieDetail';
interface MovieData {
  id: number;
  title: string;
  poster_path: string | null;
  release_date: string;
  overview?: string;
}

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
  const [error, setError] = useState('');

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
        ? { email, password }
        : { email, password, username, language_preference: 'en' };

      const response = await fetch(`${config.API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
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

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.loginContent}>
        <Text style={styles.logo}>WordWise</Text>
        <Text style={styles.tagline}>Learn vocabulary from movies & books</Text>

        <View style={styles.formContainer}>
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
            style={[styles.primaryButton, loading && styles.buttonDisabled]}
            onPress={handleAuth}
            disabled={loading}
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

// Auto-scrolling Carousel Component with manual scroll support
const AutoScrollCarousel = ({
  data,
  renderItem,
  direction = 'right'
}: {
  data: any[];
  renderItem: (item: any) => React.ReactNode;
  direction?: 'left' | 'right';
}) => {
  const scrollViewRef = useRef<ScrollView>(null);
  const [contentWidth, setContentWidth] = useState(0);
  const isPausedRef = useRef(false);
  const currentPositionRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Duplicate data for infinite scroll effect
  const duplicatedData = [...data, ...data, ...data];

  useEffect(() => {
    if (data.length === 0 || contentWidth === 0) return;

    const itemWidth = CARD_WIDTH + CARD_MARGIN;
    const singleSetWidth = data.length * itemWidth;
    const startPosition = direction === 'right' ? 0 : singleSetWidth;

    // Set initial position
    currentPositionRef.current = startPosition;
    scrollViewRef.current?.scrollTo({ x: startPosition, animated: false });

    const speed = 0.5; // pixels per frame

    const animate = () => {
      if (isPausedRef.current) return;

      if (direction === 'right') {
        currentPositionRef.current += speed;
        if (currentPositionRef.current >= singleSetWidth * 2) {
          currentPositionRef.current = singleSetWidth;
          scrollViewRef.current?.scrollTo({ x: currentPositionRef.current, animated: false });
        }
      } else {
        currentPositionRef.current -= speed;
        if (currentPositionRef.current <= 0) {
          currentPositionRef.current = singleSetWidth;
          scrollViewRef.current?.scrollTo({ x: currentPositionRef.current, animated: false });
        }
      }
      scrollViewRef.current?.scrollTo({ x: currentPositionRef.current, animated: false });
    };

    intervalRef.current = setInterval(animate, 16); // ~60fps

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [data.length, contentWidth, direction]);

  // Pause auto-scroll when user starts dragging
  const handleScrollBeginDrag = () => {
    isPausedRef.current = true;
  };

  // Resume auto-scroll after user stops scrolling
  const handleScrollEndDrag = () => {
    // Resume after a short delay to allow momentum to settle
    setTimeout(() => {
      isPausedRef.current = false;
    }, 2000);
  };

  // Update position reference when user scrolls manually
  const handleScroll = (event: any) => {
    if (isPausedRef.current) {
      currentPositionRef.current = event.nativeEvent.contentOffset.x;
    }
  };

  if (data.length === 0) return null;

  return (
    <ScrollView
      ref={scrollViewRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      scrollEnabled={true}
      onContentSizeChange={(w) => setContentWidth(w)}
      onScrollBeginDrag={handleScrollBeginDrag}
      onScrollEndDrag={handleScrollEndDrag}
      onScroll={handleScroll}
      scrollEventThrottle={16}
    >
      {duplicatedData.map((item, index) => (
        <View key={`${item.id}-${index}`}>
          {renderItem(item)}
        </View>
      ))}
    </ScrollView>
  );
};

// Home Screen
const HomeScreen = ({
  onLogout,
  onMoviePress,
}: {
  onLogout: () => void;
  onMoviePress: (movie: MovieData) => void;
}) => {
  const [activeTab, setActiveTab] = useState<'movies' | 'books'>('movies');
  const [searchQuery, setSearchQuery] = useState('');
  const [trendingMovies, setTrendingMovies] = useState<any[]>([]);
  const [topRatedMovies, setTopRatedMovies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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
    });
  };

  const handleBookPress = (book: any) => {
    // TODO: Navigate to book detail
    console.log('Book pressed:', book.title);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>WordWise</Text>
        <TouchableOpacity onPress={onLogout}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

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
            {/* Top Rated Movies Section - auto scroll right */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>⭐ Top Rated</Text>
              {loading ? (
                <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
              ) : (
                <AutoScrollCarousel
                  data={topRatedMovies}
                  direction="right"
                  renderItem={(movie) => (
                    <MovieCard movie={movie} onPress={() => handleMoviePress(movie)} />
                  )}
                />
              )}
            </View>

            {/* Trending Movies Section - auto scroll left */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>🔥 Trending Now</Text>
              {loading ? (
                <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
              ) : (
                <AutoScrollCarousel
                  data={trendingMovies}
                  direction="left"
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
            {/* Popular Books Section - auto scroll right */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>📖 Popular Books</Text>
              <AutoScrollCarousel
                data={popularBooks}
                direction="right"
                renderItem={(book) => (
                  <BookCard book={book} onPress={() => handleBookPress(book)} />
                )}
              />
            </View>

            {/* Classic Books Section - auto scroll left */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>📚 Classic Literature</Text>
              <AutoScrollCarousel
                data={classicBooks}
                direction="left"
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
        vocabResult = await wordwiseApi.getVocabularyFull(scriptResult.movie_id);
      } catch {
        // Fall back to preview if full vocabulary requires auth
        vocabResult = await wordwiseApi.getVocabularyPreview(scriptResult.movie_id);
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
              <Text style={styles.movieInfoYear}>{movie.release_date?.slice(0, 4)}</Text>
              <Text style={styles.movieInfoStats}>
                {vocabulary.unique_words} unique words
              </Text>
            </View>
          </View>

          {/* CEFR Level Tabs - Gradient border container */}
          <View style={styles.cefrTabsWrapper}>
            <View style={styles.cefrTabsGradientBorder}>
              <View style={styles.cefrTabsInner}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.cefrTabsContent}
                >
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
                </ScrollView>
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
          <HomeScreen onLogout={logout} onMoviePress={navigateToMovie} />
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
  movieInfoYear: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 8,
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
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  cefrTab: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginHorizontal: 2,
    borderRadius: 12,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 56,
  },
  cefrTabActive: {
    // Background color is set dynamically with level color
  },
  cefrTabLevel: {
    fontSize: 18,
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
    fontSize: 14,
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
