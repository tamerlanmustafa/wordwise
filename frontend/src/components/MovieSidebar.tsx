import { memo, useState } from 'react';
import {
  Box,
  Card,
  CardMedia,
  CardContent,
  Typography,
  Stack,
  Chip,
  Skeleton,
  Button,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  CircularProgress
} from '@mui/material';
import MovieIcon from '@mui/icons-material/Movie';
import DescriptionIcon from '@mui/icons-material/Description';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import CategoryIcon from '@mui/icons-material/Category';
import DownloadIcon from '@mui/icons-material/Download';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import CodeIcon from '@mui/icons-material/Code';
import type { TMDBMetadata } from '../services/scriptService';
import type { MovieDifficultyResult } from '../utils/computeMovieDifficulty';
import { DifficultyBadge } from './DifficultyBadge';
import { useAuth } from '../contexts/AuthContext';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

interface MovieSidebarProps {
  tmdbMetadata: TMDBMetadata | null;
  difficulty?: MovieDifficultyResult | null;
  difficultyIsMock?: boolean;
  isUploadedContent?: boolean;
  gutenbergId?: number;
}

// Memoized MovieSidebar - should NOT re-render when activeTab changes
export const MovieSidebar = memo<MovieSidebarProps>(({
  tmdbMetadata,
  difficulty,
  difficultyIsMock = false,
  isUploadedContent = false,
  gutenbergId
}) => {
  const { isAdmin } = useAuth();
  const [downloadMenuAnchor, setDownloadMenuAnchor] = useState<null | HTMLElement>(null);
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async (format: 'txt' | 'epub' | 'html') => {
    if (!gutenbergId) return;

    setDownloadMenuAnchor(null);
    setDownloading(true);

    try {
      const token = localStorage.getItem('wordwise_token');
      const response = await fetch(
        `${API_BASE_URL}/api/books/gutenberg/${gutenbergId}/download?format=${format}`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Download failed' }));
        throw new Error(error.detail || 'Download failed');
      }

      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `book_${gutenbergId}.${format}`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="(.+)"/);
        if (match) {
          filename = match[1];
        }
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Download failed:', error);
      alert(error instanceof Error ? error.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

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

          {/* Download Button for Books */}
          {gutenbergId && (
            <Box sx={{ mt: 2 }}>
              <Button
                variant="outlined"
                size="small"
                fullWidth
                startIcon={downloading ? <CircularProgress size={16} /> : <DownloadIcon />}
                onClick={(e) => setDownloadMenuAnchor(e.currentTarget)}
                disabled={downloading}
              >
                {downloading ? 'Downloading...' : 'Download Book'}
              </Button>
              <Menu
                anchorEl={downloadMenuAnchor}
                open={Boolean(downloadMenuAnchor)}
                onClose={() => setDownloadMenuAnchor(null)}
              >
                <MenuItem onClick={() => handleDownload('txt')}>
                  <ListItemIcon>
                    <DescriptionIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary="Plain Text (.txt)" />
                </MenuItem>
                <MenuItem onClick={() => handleDownload('epub')}>
                  <ListItemIcon>
                    <MenuBookIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary="EPUB (.epub)" />
                </MenuItem>
                <MenuItem onClick={() => handleDownload('html')}>
                  <ListItemIcon>
                    <CodeIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary="HTML (.html)" />
                </MenuItem>
              </Menu>
            </Box>
          )}
        </CardContent>
    </Card>
  );
}, (prevProps, nextProps) => {
  // Only re-render if tmdbMetadata, difficulty, mock flag, upload flag, or gutenbergId changes
  // Since these are static for a given movie/book, this should almost never re-render
  return prevProps.tmdbMetadata === nextProps.tmdbMetadata &&
         prevProps.difficulty === nextProps.difficulty &&
         prevProps.difficultyIsMock === nextProps.difficultyIsMock &&
         prevProps.isUploadedContent === nextProps.isUploadedContent &&
         prevProps.gutenbergId === nextProps.gutenbergId;
});

MovieSidebar.displayName = 'MovieSidebar';
