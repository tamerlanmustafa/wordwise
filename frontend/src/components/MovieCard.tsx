import { Card, CardMedia, CardContent, Typography, Box } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import type { TMDBMovie } from '../services/tmdbService';
import { getImageUrl } from '../services/tmdbService';

interface MovieCardProps {
  movie: TMDBMovie;
}

export default function MovieCard({ movie }: MovieCardProps) {
  const navigate = useNavigate();
  const posterUrl = getImageUrl(movie.poster_path, 'w500');
  const year = movie.release_date ? new Date(movie.release_date).getFullYear() : '';

  const handleClick = () => {
    // Navigate to analysis page with movie title
    // The MovieDetailPage will use WordWise backend API to fetch script and analyze vocabulary
    navigate(`/movie/${movie.id}`, {
      state: {
        title: movie.title,
        year: year || null,
        tmdbId: movie.id
      }
    });
  };

  return (
    <Card
      onClick={handleClick}
      sx={{
        minWidth: 200,
        maxWidth: 200,
        cursor: 'pointer',
        transition: 'transform 0.2s, box-shadow 0.2s',
        '&:hover': {
          transform: 'translateY(-8px)',
          boxShadow: 6
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
