import { Box, Typography, Stack, Skeleton } from '@mui/material';
import type { TMDBMovie } from '../services/tmdbService';
import MovieCard from './MovieCard';
import { useAutoScroll } from '../hooks/useAutoScroll';

interface MovieCarouselProps {
  title: string;
  movies: TMDBMovie[];
  loading?: boolean;
  index: number;
}

export default function MovieCarousel({ title, movies, loading, index }: MovieCarouselProps) {
  const direction = index % 2 === 0 ? 'right' : 'left';
  const containerRef = useAutoScroll({
    speed: 0.8,
    direction,
    pauseOnHover: true
  });

  if (loading) {
    return (
      <Box sx={{ mb: 6 }}>
        <Typography variant="h5" fontWeight="bold" sx={{ mb: 2 }}>
          {title}
        </Typography>
        <Stack
          direction="row"
          spacing={2}
          sx={{
            overflowX: 'auto',
            pb: 2,
            '&::-webkit-scrollbar': {
              height: 8
            },
            '&::-webkit-scrollbar-track': {
              bgcolor: 'background.paper'
            },
            '&::-webkit-scrollbar-thumb': {
              bgcolor: 'grey.400',
              borderRadius: 2
            }
          }}
        >
          {[...Array(10)].map((_, i) => (
            <Skeleton
              key={i}
              variant="rectangular"
              width={200}
              height={350}
              sx={{ borderRadius: 1, flexShrink: 0 }}
            />
          ))}
        </Stack>
      </Box>
    );
  }

  // Duplicate movies for seamless infinite scroll
  const duplicatedMovies = [...movies, ...movies];

  return (
    <Box sx={{ mb: 6 }}>
      <Typography variant="h5" fontWeight="bold" sx={{ mb: 2 }}>
        {title}
      </Typography>
      <Stack
        ref={containerRef}
        direction="row"
        spacing={2}
        sx={{
          overflowX: 'auto',
          pb: 2,
          cursor: 'grab',
          '&:active': {
            cursor: 'grabbing'
          },
          '&::-webkit-scrollbar': {
            height: 8
          },
          '&::-webkit-scrollbar-track': {
            bgcolor: 'background.paper'
          },
          '&::-webkit-scrollbar-thumb': {
            bgcolor: 'grey.400',
            borderRadius: 2,
            '&:hover': {
              bgcolor: 'grey.500'
            }
          }
        }}
      >
        {duplicatedMovies.map((movie, idx) => (
          <Box key={`${movie.id}-${idx}`} sx={{ flexShrink: 0 }}>
            <MovieCard movie={movie} />
          </Box>
        ))}
      </Stack>
    </Box>
  );
}
