import { useState, useEffect } from 'react';
import { Container, Box, Typography, Grid, Paper, Skeleton, Tabs, Tab } from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import MovieIcon from '@mui/icons-material/Movie';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import HeroSearchBar from '../components/HeroSearchBar';
import BookSearchBar from '../components/BookSearchBar';
import MovieCarousel from '../components/MovieCarousel';
import BookCarousel from '../components/BookCarousel';
import { POPULAR_BOOKS, CLASSIC_AUTHORS } from '../data/popularBooks';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchTopRatedMovies,
  fetchTrendingMovies,
  fetchGenres,
  type TMDBMovie,
  type TMDBGenre
} from '../services/tmdbService';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <div role="tabpanel" hidden={value !== index}>
      {value === index && <Box>{children}</Box>}
    </div>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  // Set initial tab based on user preference
  const getInitialTab = () => {
    // Check if navigated with explicit tab preference (from logo click)
    const stateTab = (location.state as { defaultTab?: number })?.defaultTab;
    if (stateTab !== undefined) return stateTab;
    // Otherwise use user's saved preference
    if (user?.default_tab === 'books') return 1;
    return 0;
  };

  const [activeTab, setActiveTab] = useState(getInitialTab);
  const [topRated, setTopRated] = useState<TMDBMovie[]>([]);
  const [trending, setTrending] = useState<TMDBMovie[]>([]);
  const [genres, setGenres] = useState<TMDBGenre[]>([]);
  const [loading, setLoading] = useState(true);

  // Update tab when navigating to home with state (e.g., clicking logo)
  useEffect(() => {
    const stateTab = (location.state as { defaultTab?: number })?.defaultTab;
    if (stateTab !== undefined) {
      setActiveTab(stateTab);
    }
  }, [location.state]);

  // Update tab when user preference changes
  useEffect(() => {
    if (user?.default_tab) {
      setActiveTab(user.default_tab === 'books' ? 1 : 0);
    }
  }, [user?.default_tab]);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [topRatedRes, trendingRes, genresRes] = await Promise.all([
          fetchTopRatedMovies(1),
          fetchTrendingMovies('day'),
          fetchGenres()
        ]);

        setTopRated(topRatedRes.results.slice(0, 20));
        setTrending(trendingRes.results.slice(0, 20));
        setGenres(genresRes.genres);
      } catch (error) {
        console.error('Failed to load homepage data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const handleSearch = (query: string) => {
    navigate(`/search?q=${encodeURIComponent(query)}`);
  };

  const handleGenreClick = (genreId: number, genreName: string) => {
    navigate(`/search?genre=${genreId}&name=${encodeURIComponent(genreName)}`);
  };

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  return (
    <Box>
      {/* Tabs */}
      <Container maxWidth="lg">
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          <Tabs
            value={activeTab}
            onChange={handleTabChange}
            sx={{
              '& .MuiTab-root': {
                minWidth: 120,
                fontWeight: 600,
                fontSize: '1rem',
              }
            }}
          >
            <Tab
              icon={<MovieIcon />}
              iconPosition="start"
              label="Movies"
            />
            <Tab
              icon={<MenuBookIcon />}
              iconPosition="start"
              label="Books"
            />
          </Tabs>
        </Box>
      </Container>

      {/* Movies Tab */}
      <TabPanel value={activeTab} index={0}>
        {/* Search Bar */}
        <Container maxWidth="lg">
          <HeroSearchBar onSearch={handleSearch} />
        </Container>

        {/* Content Sections */}
        <Container maxWidth="lg" sx={{ py: 4 }}>
          {/* Top Rated Movies - scrolls RIGHT */}
          <MovieCarousel
            title="Top Movies of All Time"
            movies={topRated}
            loading={loading}
            index={0}
          />

          {/* Trending Movies - scrolls LEFT */}
          <MovieCarousel
            title="Popular Now"
            movies={trending}
            loading={loading}
            index={1}
          />

          {/* Genres Section - Responsive Grid */}
          <Box sx={{ mb: 6 }}>
            <Typography variant="h5" fontWeight="bold" sx={{ mb: 3 }}>
              Browse by Genre
            </Typography>
            {loading ? (
              <Grid container spacing={2}>
                {[...Array(12)].map((_, i) => (
                  <Grid item xs={6} sm={4} md={3} lg={2.4} key={i}>
                    <Skeleton variant="rectangular" height={80} sx={{ borderRadius: 2 }} />
                  </Grid>
                ))}
              </Grid>
            ) : (
              <Grid container spacing={2}>
                {genres.map((genre) => (
                  <Grid item xs={6} sm={4} md={3} lg={2.4} key={genre.id}>
                    <Paper
                      onClick={() => handleGenreClick(genre.id, genre.name)}
                      sx={{
                        p: 2,
                        textAlign: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 1,
                        '&:hover': {
                          bgcolor: 'primary.main',
                          color: 'primary.contrastText',
                          transform: 'translateY(-4px)',
                          boxShadow: 4
                        }
                      }}
                    >
                      <MovieIcon sx={{ fontSize: 32 }} />
                      <Typography variant="body1" fontWeight="medium">
                        {genre.name}
                      </Typography>
                    </Paper>
                  </Grid>
                ))}
              </Grid>
            )}
          </Box>
        </Container>
      </TabPanel>

      {/* Books Tab */}
      <TabPanel value={activeTab} index={1}>
        {/* Search Bar */}
        <Container maxWidth="lg">
          <BookSearchBar />
        </Container>

        <Container maxWidth="lg" sx={{ py: 4 }}>
          {/* Popular Books Carousel - scrolls RIGHT */}
          <BookCarousel
            title="Most Popular Books"
            books={POPULAR_BOOKS}
            index={0}
          />

          {/* Classic Authors Carousel - scrolls LEFT */}
          <BookCarousel
            title="Classic Literature"
            books={CLASSIC_AUTHORS}
            index={1}
          />

          {/* Features Grid */}
          <Box sx={{ mb: 4 }}>
            <Typography variant="h5" fontWeight="bold" sx={{ mb: 3 }}>
              Why Read with WordWise?
            </Typography>
            <Grid container spacing={3}>
              {[
                { title: 'Public Domain', desc: 'Free classic literature from Project Gutenberg', icon: '📚' },
                { title: 'CEFR Analysis', desc: 'Words organized by difficulty level', icon: '📊' },
                { title: 'Page-by-Page', desc: 'Learn vocabulary before you read', icon: '📖' },
                { title: 'Upload Your Own', desc: 'EPUB, PDF, TXT supported', icon: '📤' }
              ].map((feature) => (
                <Grid item xs={6} sm={3} key={feature.title}>
                  <Paper
                    sx={{
                      p: 2.5,
                      textAlign: 'center',
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 1
                    }}
                  >
                    <Typography variant="h4">{feature.icon}</Typography>
                    <Typography variant="subtitle2" fontWeight="bold">
                      {feature.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {feature.desc}
                    </Typography>
                  </Paper>
                </Grid>
              ))}
            </Grid>
          </Box>

          {/* Footer */}
          <Box
            sx={{
              textAlign: 'center',
              py: 3,
              borderTop: '1px solid',
              borderColor: 'divider'
            }}
          >
            <Typography variant="body2" color="text.secondary">
              Powered by Project Gutenberg & Open Library
            </Typography>
          </Box>
        </Container>
      </TabPanel>

      {/* Footer CTA - Only show on Movies tab */}
      {activeTab === 0 && (
        <Container maxWidth="lg">
          <Box
            sx={{
              textAlign: 'center',
              py: 6,
              borderTop: '1px solid',
              borderColor: 'divider'
            }}
          >
            <Typography variant="h6" color="text.secondary" gutterBottom>
              Ready to start learning?
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Search for a movie above or browse our collections
            </Typography>
          </Box>
        </Container>
      )}
    </Box>
  );
}
