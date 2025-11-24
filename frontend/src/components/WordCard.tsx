import { useState } from 'react';
import {
  Card,
  CardContent,
  Typography,
  IconButton,
  Box,
  Collapse,
  Skeleton,
  Tooltip,
  Stack,
  Fade,
  Chip
} from '@mui/material';
import TranslateIcon from '@mui/icons-material/Translate';
import InfoIcon from '@mui/icons-material/Info';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import CachedIcon from '@mui/icons-material/Cached';
import { useTranslation } from '../hooks/useTranslation';
import type { WordFrequency } from '../types/script';

interface WordCardProps {
  word: WordFrequency;
  levelColor: string;
  targetLang?: string;
  onOpenDetails?: (word: WordFrequency) => void;
  onToggleSaved?: (word: WordFrequency) => void;
  isSaved?: boolean;
  variant?: 'compact' | 'full';
}

export default function WordCard({
  word,
  levelColor,
  targetLang = 'ES', // Default to Spanish, can be overridden
  onOpenDetails,
  onToggleSaved,
  isSaved = false,
  variant = 'compact'
}: WordCardProps) {
  const [showTranslation, setShowTranslation] = useState(false);
  const { translated, translate, loading, error, cached } = useTranslation();

  const handleTranslate = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!showTranslation) {
      // Show translation area and fetch if not already translated
      setShowTranslation(true);
      if (!translated) {
        await translate(word.word, targetLang);
      }
    } else {
      // Toggle off
      setShowTranslation(false);
    }
  };

  const handleOpenDetails = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenDetails?.(word);
  };

  const handleToggleSaved = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleSaved?.(word);
  };

  if (variant === 'compact') {
    return (
      <Card
        sx={{
          height: '100%',
          borderLeft: `3px solid ${levelColor}`,
          transition: 'all 0.2s',
          cursor: 'pointer',
          '&:hover': {
            boxShadow: 3,
            transform: 'translateY(-2px)'
          }
        }}
        onClick={() => setShowTranslation(!showTranslation)}
      >
        <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={0.5}>
            <Typography variant="body2" fontWeight="medium" noWrap sx={{ flex: 1 }}>
              {word.word}
            </Typography>

            <Stack direction="row" spacing={0.5}>
              <Tooltip title={cached ? 'Cached translation' : showTranslation ? 'Hide translation' : 'Translate'}>
                <IconButton
                  size="small"
                  onClick={handleTranslate}
                  sx={{
                    color: showTranslation ? levelColor : 'text.secondary',
                    '&:hover': { color: levelColor }
                  }}
                >
                  {loading ? (
                    <CachedIcon sx={{ fontSize: 16, animation: 'spin 1s linear infinite' }} />
                  ) : (
                    <TranslateIcon sx={{ fontSize: 16 }} />
                  )}
                </IconButton>
              </Tooltip>

              {onOpenDetails && (
                <Tooltip title="More info">
                  <IconButton
                    size="small"
                    onClick={handleOpenDetails}
                    sx={{
                      color: 'text.secondary',
                      '&:hover': { color: levelColor }
                    }}
                  >
                    <InfoIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              )}

              {onToggleSaved && (
                <Tooltip title={isSaved ? 'Remove from saved' : 'Save word'}>
                  <IconButton
                    size="small"
                    onClick={handleToggleSaved}
                    sx={{
                      color: isSaved ? levelColor : 'text.secondary',
                      '&:hover': { color: levelColor }
                    }}
                  >
                    {isSaved ? (
                      <BookmarkIcon sx={{ fontSize: 16 }} />
                    ) : (
                      <BookmarkBorderIcon sx={{ fontSize: 16 }} />
                    )}
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
          </Stack>

          <Collapse in={showTranslation}>
            <Box sx={{ mt: 1, pt: 1, borderTop: `1px solid ${levelColor}30` }}>
              {loading && (
                <Skeleton variant="text" width="80%" height={20} />
              )}

              {error && (
                <Fade in>
                  <Typography variant="caption" color="error">
                    {error}
                  </Typography>
                </Fade>
              )}

              {translated && !loading && !error && (
                <Fade in>
                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ fontStyle: 'italic' }}
                    >
                      → {translated}
                    </Typography>
                    {cached && (
                      <Chip
                        label="cached"
                        size="small"
                        sx={{
                          height: 16,
                          fontSize: '0.65rem',
                          backgroundColor: `${levelColor}20`,
                          color: levelColor
                        }}
                      />
                    )}
                  </Stack>
                </Fade>
              )}
            </Box>
          </Collapse>
        </CardContent>
      </Card>
    );
  }

  // Full variant for larger displays or modal views
  return (
    <Card
      sx={{
        borderLeft: `4px solid ${levelColor}`,
        transition: 'all 0.2s',
        '&:hover': {
          boxShadow: 4
        }
      }}
    >
      <CardContent>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" fontWeight="bold" gutterBottom>
              {word.word}
            </Typography>

            {word.lemma !== word.word && (
              <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                Lemma: {word.lemma}
              </Typography>
            )}

            {word.frequency_rank && (
              <Typography variant="caption" color="text.secondary" display="block">
                Frequency rank: #{word.frequency_rank.toLocaleString()}
              </Typography>
            )}
          </Box>

          <Stack direction="row" spacing={1}>
            <Tooltip title="Translate">
              <IconButton
                onClick={handleTranslate}
                sx={{
                  color: showTranslation ? levelColor : 'text.secondary',
                  '&:hover': { backgroundColor: `${levelColor}15` }
                }}
              >
                {loading ? <CachedIcon /> : <TranslateIcon />}
              </IconButton>
            </Tooltip>

            {onToggleSaved && (
              <Tooltip title={isSaved ? 'Saved' : 'Save word'}>
                <IconButton
                  onClick={handleToggleSaved}
                  sx={{
                    color: isSaved ? levelColor : 'text.secondary',
                    '&:hover': { backgroundColor: `${levelColor}15` }
                  }}
                >
                  {isSaved ? <BookmarkIcon /> : <BookmarkBorderIcon />}
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        </Stack>

        <Collapse in={showTranslation}>
          <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
            {loading && (
              <Stack spacing={1}>
                <Skeleton variant="text" width="60%" />
                <Skeleton variant="text" width="40%" />
              </Stack>
            )}

            {error && (
              <Typography variant="body2" color="error">
                {error}
              </Typography>
            )}

            {translated && !loading && !error && (
              <Fade in>
                <Box>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                    <Typography variant="body1" fontWeight="medium">
                      {translated}
                    </Typography>
                    {cached && (
                      <Chip
                        label="Cached"
                        size="small"
                        sx={{
                          backgroundColor: `${levelColor}20`,
                          color: levelColor
                        }}
                      />
                    )}
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    Translation to {targetLang}
                  </Typography>
                </Box>
              </Fade>
            )}
          </Box>
        </Collapse>
      </CardContent>

      <style>
        {`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}
      </style>
    </Card>
  );
}
