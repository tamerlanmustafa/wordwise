import { useState, useEffect } from 'react';
import { Container, Box, Typography, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import HeroSearchBar from '../components/HeroSearchBar';
import HeroSection from '../components/HeroSection';
import TrendingRow from '../components/TrendingRow';
import TopRatedList from '../components/TopRatedList';
import QuickStartRow from '../components/QuickStartRow';
import {
  fetchTopRatedMovies,
  fetchTrendingMovies,
  type TMDBMovie,
} from '../services/tmdbService';

export default function HomePage() {
  const navigate = useNavigate();

  const [topRated, setTopRated] = useState<TMDBMovie[]>([]);
  const [trending, setTrending] = useState<TMDBMovie[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [topRes, trendRes] = await Promise.all([
          fetchTopRatedMovies(1),
          fetchTrendingMovies('day'),
        ]);
        setTopRated(topRes.results.slice(0, 20));
        setTrending(trendRes.results.slice(0, 20));
      } catch (err) {
        console.error('Failed to load homepage data:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // Hero = highest-rated movie that has a backdrop
  const heroMovie =
    topRated.find((m) => m.backdrop_path) ?? topRated[0] ?? null;

  return (
    <Box>
      {/* Hero */}
      <HeroSection movie={heroMovie} loading={loading} />

      {/* Search bar below hero */}
      <Container maxWidth="lg">
        <HeroSearchBar />
      </Container>

      <Container maxWidth="lg" sx={{ py: 4 }}>
        {/* Quick Start */}
        <QuickStartRow />

        {/* Trending Now */}
        <TrendingRow movies={trending} loading={loading} />

        {/* Top Rated for Learning */}
        <TopRatedList movies={topRated} loading={loading} />

        {/* Explore all */}
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
            Looking for something specific?
          </Typography>
          <Button
            variant="outlined"
            size="large"
            onClick={() => navigate('/search')}
            sx={{
              borderRadius: 2,
              px: 4,
              fontWeight: 600,
              textTransform: 'none',
              fontSize: '1rem',
            }}
          >
            Browse All Movies →
          </Button>
        </Box>
      </Container>
    </Box>
  );
}
