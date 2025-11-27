import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Container,
  Box,
  Typography,
  Grid,
  CircularProgress,
  Alert
} from '@mui/material';
import MovieCard from '../components/MovieCard';
import {
  searchTMDBMovies,
  fetchMoviesByGenre,
  type TMDBMovie
} from '../services/tmdbService';

export default function SearchPage() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q');
  const genreId = searchParams.get('genre');
  const genreName = searchParams.get('name');

  const [movies, setMovies] = useState<TMDBMovie[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadMovies = async () => {
      setLoading(true);
      setError(null);

      try {
        let response;
        if (genreId) {
          response = await fetchMoviesByGenre(parseInt(genreId), 1);
        } else if (query) {
          response = await searchTMDBMovies(query, 1);
        } else {
          setError('No search query or genre specified');
          setLoading(false);
          return;
        }

        setMovies(response.results);
      } catch (err) {
        console.error('Search failed:', err);
        setError('Failed to load movies. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    loadMovies();
  }, [query, genreId]);

  const getTitle = () => {
    if (genreName) return `${genreName} Movies`;
    if (query) return `Search results for "${query}"`;
    return 'Search Results';
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h4" fontWeight="bold" gutterBottom>
        {getTitle()}
      </Typography>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {!loading && !error && movies.length === 0 && (
        <Alert severity="info">
          No movies found. Try a different search.
        </Alert>
      )}

      {!loading && movies.length > 0 && (
        <Grid container spacing={3}>
          {movies.map((movie) => (
            <Grid item key={movie.id} xs={12} sm={6} md={4} lg={3}>
              <MovieCard movie={movie} />
            </Grid>
          ))}
        </Grid>
      )}
    </Container>
  );
}
