import { useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Stack,
  Divider,
  Chip,
  IconButton,
  Skeleton,
  Alert,
  Paper
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import TranslateIcon from '@mui/icons-material/Translate';
import CachedIcon from '@mui/icons-material/Cached';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTranslation } from '../hooks/useTranslation';
import type { WordFrequency } from '../types/script';

interface TranslationModalProps {
  open: boolean;
  onClose: () => void;
  word: WordFrequency | null;
  levelColor: string;
  targetLang?: string;
  exampleSentence?: string;
}

export default function TranslationModal({
  open,
  onClose,
  word,
  levelColor,
  targetLang = 'ES',
  exampleSentence
}: TranslationModalProps) {
  const { translated, translatedData, translate, loading, error, cached, reset } = useTranslation();

  // Auto-translate when modal opens
  useEffect(() => {
    if (open && word) {
      translate(word.word, targetLang);
    }

    // Reset on close
    if (!open) {
      reset();
    }
  }, [open, word, targetLang, translate, reset]);

  const handleRetry = () => {
    if (word) {
      translate(word.word, targetLang);
    }
  };

  if (!word) return null;

  const targetLangName = getLanguageName(targetLang);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderTop: `4px solid ${levelColor}`
        }
      }}
    >
      <DialogTitle>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Stack direction="row" alignItems="center" spacing={1}>
            <TranslateIcon sx={{ color: levelColor }} />
            <Typography variant="h6" fontWeight="bold">
              Translation
            </Typography>
          </Stack>
          <IconButton
            onClick={onClose}
            size="small"
            sx={{ color: 'text.secondary' }}
          >
            <CloseIcon />
          </IconButton>
        </Stack>
      </DialogTitle>

      <Divider />

      <DialogContent sx={{ py: 3 }}>
        <Stack spacing={3}>
          {/* Original Word */}
          <Paper
            elevation={0}
            sx={{
              p: 2,
              backgroundColor: 'grey.50',
              borderLeft: `3px solid ${levelColor}`
            }}
          >
            <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
              English
            </Typography>
            <Typography variant="h4" fontWeight="bold" sx={{ color: levelColor }}>
              {word.word}
            </Typography>
            {word.lemma !== word.word && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                Base form: {word.lemma}
              </Typography>
            )}
          </Paper>

          {/* Translation */}
          <Box>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
              <Typography variant="caption" color="text.secondary" fontWeight="medium">
                {targetLangName}
              </Typography>
              {cached && (
                <Chip
                  icon={<CachedIcon />}
                  label="From cache"
                  size="small"
                  sx={{
                    backgroundColor: `${levelColor}15`,
                    color: levelColor,
                    fontSize: '0.7rem'
                  }}
                />
              )}
            </Stack>

            {loading && (
              <Stack spacing={1}>
                <Skeleton variant="text" width="70%" height={50} />
                <Skeleton variant="text" width="50%" height={30} />
              </Stack>
            )}

            {error && (
              <Alert
                severity="error"
                action={
                  <Button
                    color="inherit"
                    size="small"
                    startIcon={<RefreshIcon />}
                    onClick={handleRetry}
                  >
                    Retry
                  </Button>
                }
              >
                {error}
              </Alert>
            )}

            {translated && !loading && !error && (
              <Paper
                elevation={0}
                sx={{
                  p: 2,
                  backgroundColor: `${levelColor}08`,
                  border: `1px solid ${levelColor}30`
                }}
              >
                <Typography variant="h3" fontWeight="bold" sx={{ color: levelColor }}>
                  {translated}
                </Typography>
                {translatedData?.source_lang && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    Detected source: {getLanguageName(translatedData.source_lang)}
                  </Typography>
                )}
              </Paper>
            )}
          </Box>

          {/* Example Sentence */}
          {exampleSentence && (
            <>
              <Divider />
              <Box>
                <Typography variant="caption" color="text.secondary" fontWeight="medium" gutterBottom display="block">
                  Example Usage
                </Typography>
                <Typography variant="body2" sx={{ fontStyle: 'italic', color: 'text.secondary' }}>
                  "{exampleSentence}"
                </Typography>
              </Box>
            </>
          )}

          {/* Word Metadata */}
          {(word.frequency_rank || word.confidence) && (
            <>
              <Divider />
              <Stack direction="row" spacing={3}>
                {word.frequency_rank && (
                  <Box>
                    <Typography variant="caption" color="text.secondary" display="block">
                      Frequency Rank
                    </Typography>
                    <Typography variant="body2" fontWeight="medium">
                      #{word.frequency_rank.toLocaleString()}
                    </Typography>
                  </Box>
                )}
                {word.confidence && (
                  <Box>
                    <Typography variant="caption" color="text.secondary" display="block">
                      Confidence
                    </Typography>
                    <Typography variant="body2" fontWeight="medium">
                      {(word.confidence * 100).toFixed(0)}%
                    </Typography>
                  </Box>
                )}
              </Stack>
            </>
          )}
        </Stack>
      </DialogContent>

      <Divider />

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} variant="outlined">
          Close
        </Button>
        <Button
          onClick={handleRetry}
          variant="contained"
          disabled={loading}
          sx={{
            backgroundColor: levelColor,
            '&:hover': {
              backgroundColor: levelColor,
              filter: 'brightness(0.9)'
            }
          }}
        >
          {loading ? 'Translating...' : 'Retranslate'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// Helper function to get language names
function getLanguageName(code: string): string {
  const languages: Record<string, string> = {
    'EN': 'English',
    'DE': 'German',
    'FR': 'French',
    'ES': 'Spanish',
    'IT': 'Italian',
    'NL': 'Dutch',
    'PL': 'Polish',
    'PT': 'Portuguese',
    'RU': 'Russian',
    'JA': 'Japanese',
    'ZH': 'Chinese',
    'NB': 'Norwegian',
    'auto': 'Auto-detect'
  };

  return languages[code.toUpperCase()] || code;
}
