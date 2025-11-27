import { useState, useEffect } from 'react';
import { Container, Box, Typography, Grid, Paper, Skeleton } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import MovieIcon from '@mui/icons-material/Movie';
import HeroSearchBar from '../components/HeroSearchBar';
import MovieCarousel from '../components/MovieCarousel';
import {
  fetchTopRatedMovies,
  fetchTrendingMovies,
  fetchGenres,
  type TMDBMovie,
  type TMDBGenre
} from '../services/tmdbService';

export default function HomePage() {
  const navigate = useNavigate();
  const [topRated, setTopRated] = useState<TMDBMovie[]>([]);
  const [trending, setTrending] = useState<TMDBMovie[]>([]);
  const [genres, setGenres] = useState<TMDBGenre[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <Box>
      {/* Hero Section with Search */}
      <Box
        sx={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: 'white',
          textAlign: 'center',
          py: 4
        }}
      >
        <Container maxWidth="lg">
          <Typography variant="h3" fontWeight="bold" gutterBottom>
            Discover Movies. Learn Vocabulary.
          </Typography>
          <Typography variant="h6" sx={{ mb: 2, opacity: 0.9 }}>
            Analyze movie scripts and expand your language skills
          </Typography>
        </Container>
      </Box>

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

        {/* Footer CTA */}
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
    </Box>
  );
}
