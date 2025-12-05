import { memo } from 'react';
import {
  Box,
  Card,
  CardMedia,
  CardContent,
  Typography,
  Stack,
  Chip,
  Skeleton
} from '@mui/material';
import MovieIcon from '@mui/icons-material/Movie';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import CategoryIcon from '@mui/icons-material/Category';
import type { TMDBMetadata } from '../services/scriptService';

interface MovieSidebarProps {
  tmdbMetadata: TMDBMetadata | null;
}

// Memoized MovieSidebar - should NOT re-render when activeTab changes
export const MovieSidebar = memo<MovieSidebarProps>(({
  tmdbMetadata
}) => {
  if (!tmdbMetadata) {
    return (
      <Card elevation={2}>
        <Skeleton variant="rectangular" height={300} />
        <CardContent>
          <Skeleton variant="text" height={32} width="80%" />
          <Skeleton variant="text" height={20} width="40%" sx={{ mb: 2 }} />
          <Skeleton variant="text" height={20} />
          <Skeleton variant="text" height={20} />
          <Skeleton variant="text" height={20} width="60%" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Box sx={{
      flexGrow: 1,
      position: 'relative',
      // Prevent layout thrashing
      contain: 'layout style'
    }}>
      <Card elevation={2} sx={{
        position: 'sticky',
        top: 16,
        // Prevent layout shift
        willChange: 'transform'
      }}>
        {/* Poster */}
        {tmdbMetadata.poster ? (
          <CardMedia
            component="img"
            image={tmdbMetadata.poster}
            alt={tmdbMetadata.title}
            sx={{
              width: '100%',
              height: 'auto',
              aspectRatio: '2/3'
            }}
          />
        ) : (
          <Box
            sx={{
              width: '100%',
              aspectRatio: '2/3',
              bgcolor: 'grey.200',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <MovieIcon sx={{ fontSize: 64, color: 'grey.400' }} />
          </Box>
        )}

        <CardContent>
          {/* Title */}
          <Typography variant="h6" fontWeight="bold" gutterBottom>
            {tmdbMetadata.title}
          </Typography>

          {/* Year */}
          {tmdbMetadata.year && (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
              <CalendarTodayIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              <Typography variant="body2" color="text.secondary">
                {tmdbMetadata.year}
              </Typography>
            </Stack>
          )}

          {/* Genres */}
          {tmdbMetadata.genres.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 1 }}>
                <CategoryIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                <Typography variant="body2" color="text.secondary" fontWeight="medium">
                  Genres
                </Typography>
              </Stack>
              <Stack direction="row" flexWrap="wrap" gap={0.5}>
                {tmdbMetadata.genres.map((genre) => (
                  <Chip
                    key={genre}
                    label={genre}
                    size="small"
                    sx={{
                      fontSize: '0.75rem',
                      height: 24
                    }}
                  />
                ))}
              </Stack>
            </Box>
          )}

          {/* Overview */}
          {tmdbMetadata.overview && (
            <Box>
              <Typography variant="body2" fontWeight="medium" gutterBottom>
                Overview
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                  lineHeight: 1.6,
                  fontSize: '0.875rem'
                }}
              >
                {tmdbMetadata.overview}
              </Typography>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}, (prevProps, nextProps) => {
  // Only re-render if tmdbMetadata actually changes
  // Since tmdbMetadata is static for a given movie, this should almost never re-render
  return prevProps.tmdbMetadata === nextProps.tmdbMetadata;
});

MovieSidebar.displayName = 'MovieSidebar';
