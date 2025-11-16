import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useDispatch, useSelector } from 'react-redux';
import Link from 'next/link';
import {
  Box,
  Container,
  Typography,
  Button,
  Grid,
  AppBar,
  Toolbar,
  CircularProgress,
  Alert,
  Chip,
  Stack,
} from '@mui/material';
import Card from '@/components/common/Card';
import { apiService } from '@/services/api';
import { setMovies, setLoading, setError } from '@/store/slices/moviesSlice';
import { clearUser } from '@/store/slices/authSlice';
import { RootState } from '@/store';
import { Movie } from '@/types';

export default function Movies() {
  const router = useRouter();
  const dispatch = useDispatch();
  const { movies, isLoading, error } = useSelector((state: RootState) => state.movies);
  const [filter, setFilter] = useState<string>('');

  useEffect(() => {
    loadMovies();
  }, [filter]);

  const loadMovies = async () => {
    try {
      dispatch(setLoading(true));
      const params = filter ? { difficulty: filter } : {};
      const response = await apiService.getMovies(params);
      dispatch(setMovies(response.movies));
    } catch (err: any) {
      dispatch(setError(err.message || 'Failed to load movies'));
    } finally {
      dispatch(setLoading(false));
    }
  };

  const handleLogout = () => {
    apiService.logout();
    dispatch(clearUser());
    router.push('/');
  };

  const difficultyColors: Record<string, 'success' | 'info' | 'warning' | 'error' | 'default'> = {
    A1: 'success',
    A2: 'info',
    B1: 'warning',
    B2: 'warning',
    C1: 'error',
    C2: 'default',
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Navigation */}
      <AppBar position="static" color="transparent" elevation={0} sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
        <Container maxWidth="lg">
          <Toolbar sx={{ justifyContent: 'space-between', px: { xs: 0 } }}>
            <Link href="/" passHref legacyBehavior>
              <Typography
                variant="h5"
                component="a"
                fontWeight="bold"
                color="primary"
                sx={{ textDecoration: 'none', cursor: 'pointer' }}
              >
                WordWise
              </Typography>
            </Link>
            <Button variant="outlined" onClick={handleLogout}>
              Logout
            </Button>
          </Toolbar>
        </Container>
      </AppBar>

      {/* Main Content */}
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Box sx={{ mb: 4 }}>
          <Typography variant="h3" component="h1" gutterBottom fontWeight="bold" color="text.primary">
            Movies
          </Typography>

          {/* Filter */}
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            <Button
              variant={filter === '' ? 'contained' : 'outlined'}
              onClick={() => setFilter('')}
              size="small"
            >
              All
            </Button>
            {['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((level) => (
              <Button
                key={level}
                variant={filter === level ? 'contained' : 'outlined'}
                onClick={() => setFilter(level)}
                size="small"
              >
                {level}
              </Button>
            ))}
          </Stack>
        </Box>

        {/* Loading State */}
        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={48} />
          </Box>
        )}

        {/* Error State */}
        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        {/* Movies Grid */}
        {!isLoading && !error && (
          <>
            {movies.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 6 }}>
                <Typography variant="h6" color="text.secondary">
                  No movies found.
                </Typography>
              </Box>
            ) : (
              <Grid container spacing={3}>
                {movies.map((movie: Movie) => (
                  <Grid item xs={12} md={6} lg={4} key={movie.id}>
                    <Card
                      hover
                      sx={{
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                      }}
                    >
                      <Box sx={{ flexGrow: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1.5 }}>
                          <Typography variant="h6" component="h3" fontWeight="600" color="text.primary">
                            {movie.title}
                          </Typography>
                          <Chip
                            label={movie.difficulty_level}
                            color={difficultyColors[movie.difficulty_level]}
                            size="small"
                          />
                        </Box>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                          Year: {movie.year}
                        </Typography>
                        {movie.genre && (
                          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                            Genre: {movie.genre}
                          </Typography>
                        )}
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                          {movie.word_count} words
                        </Typography>
                        {movie.description && (
                          <Typography
                            variant="body2"
                            color="text.primary"
                            sx={{
                              display: '-webkit-box',
                              WebkitLineClamp: 3,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {movie.description}
                          </Typography>
                        )}
                      </Box>
                      <Box sx={{ mt: 2 }}>
                        <Link href={`/movies/${movie.id}`} passHref legacyBehavior>
                          <Button variant="contained" fullWidth component="a">
                            View Details
                          </Button>
                        </Link>
                      </Box>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            )}
          </>
        )}
      </Container>
    </Box>
  );
}
