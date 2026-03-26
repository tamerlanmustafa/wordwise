import { Card, CardMedia, CardContent, Typography, Box } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useRef } from 'react';
import type { TMDBMovie } from '../services/tmdbService';
import { getImageUrl } from '../services/tmdbService';

interface MovieCardProps {
  movie: TMDBMovie;
}

export default function MovieCard({ movie }: MovieCardProps) {
  const navigate = useNavigate();
  const posterUrl = getImageUrl(movie.poster_path, 'w500');
  const year = movie.release_date ? new Date(movie.release_date).getFullYear() : '';

  // Track if this was a scroll gesture to prevent click
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const wasScrollingRef = useRef(false);

  const navigateToMovie = () => {
    navigate(`/movie/${movie.id}`, {
      state: {
        title: movie.title,
        year: year || null,
        tmdbId: movie.id,
        movieTitle: movie.title
      }
    });
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    wasScrollingRef.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const touch = e.touches[0];
    const deltaX = Math.abs(touch.clientX - touchStartRef.current.x);
    const deltaY = Math.abs(touch.clientY - touchStartRef.current.y);
    // If moved more than 10px, it's a scroll
    if (deltaX > 10 || deltaY > 10) {
      wasScrollingRef.current = true;
    }
  };

  const handleClick = () => {
    // Only navigate if we weren't scrolling
    if (!wasScrollingRef.current) {
      navigateToMovie();
    }
    // Reset for next interaction
    wasScrollingRef.current = false;
    touchStartRef.current = null;
  };

  return (
    <Card
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      sx={{
        minWidth: 200,
        maxWidth: 200,
        cursor: 'pointer',
        transition: 'transform 0.2s, box-shadow 0.2s',
        WebkitTapHighlightColor: 'transparent',
        userSelect: 'none',
        '&:hover': {
          transform: 'translateY(-8px)',
          boxShadow: 6
        },
        '&:active': {
          transform: 'scale(0.98)',
        }
      }}
    >
      {posterUrl ? (
        <CardMedia
          component="img"
          height="300"
          image={posterUrl}
          alt={movie.title}
          sx={{
            objectFit: 'cover'
          }}
        />
      ) : (
        <Box
          sx={{
            height: 300,
            bgcolor: 'grey.300',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <Typography variant="body2" color="text.secondary">
            No Image
          </Typography>
        </Box>
      )}
      <CardContent sx={{ p: 1.5 }}>
        <Typography
          variant="subtitle2"
          fontWeight="bold"
          sx={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            minHeight: '2.5em'
          }}
        >
          {movie.title}
        </Typography>
        {year && (
          <Typography variant="caption" color="text.secondary">
            {year}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
