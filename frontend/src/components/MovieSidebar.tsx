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
import DescriptionIcon from '@mui/icons-material/Description';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import CategoryIcon from '@mui/icons-material/Category';
import type { TMDBMetadata } from '../services/scriptService';
import type { MovieDifficultyResult } from '../utils/computeMovieDifficulty';
import { DifficultyBadge } from './DifficultyBadge';

interface MovieSidebarProps {
  tmdbMetadata: TMDBMetadata | null;
  difficulty?: MovieDifficultyResult | null;
  difficultyIsMock?: boolean;
  isUploadedContent?: boolean;
}

// Memoized MovieSidebar - should NOT re-render when activeTab changes
export const MovieSidebar = memo<MovieSidebarProps>(({
  tmdbMetadata,
  difficulty,
  difficultyIsMock = false,
  isUploadedContent = false
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
    <Card elevation={2} sx={{
      position: 'sticky',
      top: 80,
      alignSelf: 'flex-start'
    }}>
        {/* Difficulty Badge - First element, full width */}
        {difficulty && (
          <DifficultyBadge difficulty={difficulty} isMock={difficultyIsMock} size="medium" />
        )}

        {/* Poster or Placeholder */}
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
              bgcolor: isUploadedContent ? 'primary.main' : 'grey.200',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1
            }}
          >
            {isUploadedContent ? (
              <>
                <DescriptionIcon sx={{ fontSize: 64, color: 'primary.contrastText' }} />
                <Typography variant="caption" sx={{ color: 'primary.contrastText', opacity: 0.8 }}>
                  Uploaded Content
                </Typography>
              </>
            ) : (
              <MovieIcon sx={{ fontSize: 64, color: 'grey.400' }} />
            )}
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
  );
}, (prevProps, nextProps) => {
  // Only re-render if tmdbMetadata, difficulty, mock flag, or upload flag changes
  // Since these are static for a given movie, this should almost never re-render
  return prevProps.tmdbMetadata === nextProps.tmdbMetadata &&
         prevProps.difficulty === nextProps.difficulty &&
         prevProps.difficultyIsMock === nextProps.difficultyIsMock &&
         prevProps.isUploadedContent === nextProps.isUploadedContent;
});

MovieSidebar.displayName = 'MovieSidebar';
