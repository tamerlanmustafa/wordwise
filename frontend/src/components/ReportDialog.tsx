import { useState, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  RadioGroup,
  FormControlLabel,
  Radio,
  TextField,
  Typography,
  Box,
  IconButton,
  CircularProgress,
  alpha,
} from '@mui/material';
import { Close, Flag } from '@mui/icons-material';
import type { ReportReason } from '../types/report';
import { REPORT_REASON_LABELS } from '../types/report';

interface ReportDialogProps {
  open: boolean;
  onClose: () => void;
  word: string;
  movieId?: number;
  movieTitle?: string;
  translationSource?: string;
  onSubmit: (data: {
    word: string;
    movie_id?: number;
    movie_title?: string;
    reason: ReportReason;
    details?: string;
    translation_source?: string;
  }) => Promise<void>;
}

const REASON_OPTIONS: ReportReason[] = [
  'WRONG_TRANSLATION',
  'WRONG_CONTEXT',
  'WRONG_SPELLING',
  'INAPPROPRIATE_CONTENT',
  'OTHER',
];

export function ReportDialog({
  open,
  onClose,
  word,
  movieId,
  movieTitle,
  translationSource,
  onSubmit,
}: ReportDialogProps) {
  const [reason, setReason] = useState<ReportReason | ''>('');
  const [details, setDetails] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    if (!reason) {
      setError('Please select a reason');
      return;
    }

    if (reason === 'OTHER' && !details.trim()) {
      setError('Please provide details for "Other" issues');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await onSubmit({
        word,
        movie_id: movieId,
        movie_title: movieTitle,
        reason,
        details: details.trim() || undefined,
        translation_source: translationSource,
      });
      // Reset and close on success
      setReason('');
      setDetails('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit report');
    } finally {
      setIsSubmitting(false);
    }
  }, [reason, details, word, movieId, movieTitle, translationSource, onSubmit, onClose]);

  const handleClose = useCallback(() => {
    if (!isSubmitting) {
      setReason('');
      setDetails('');
      setError(null);
      onClose();
    }
  }, [isSubmitting, onClose]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderTop: (theme) => `3px solid ${theme.palette.warning.main}`,
        },
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
        <Flag color="warning" />
        <Typography variant="h6" component="span" sx={{ flex: 1 }}>
          Report Issue
        </Typography>
        <IconButton onClick={handleClose} size="small" disabled={isSubmitting}>
          <Close />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Reporting word:
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {word}
          </Typography>
          {movieTitle && (
            <Typography variant="caption" color="text.disabled">
              from "{movieTitle}"
            </Typography>
          )}
        </Box>

        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          What's the issue?
        </Typography>

        <RadioGroup
          value={reason}
          onChange={(e) => {
            setReason(e.target.value as ReportReason);
            setError(null);
          }}
        >
          {REASON_OPTIONS.map((option) => (
            <FormControlLabel
              key={option}
              value={option}
              control={<Radio size="small" />}
              label={REPORT_REASON_LABELS[option]}
              sx={{
                '& .MuiFormControlLabel-label': {
                  fontSize: '0.9rem',
                },
              }}
            />
          ))}
        </RadioGroup>

        <TextField
          fullWidth
          multiline
          rows={3}
          placeholder="Additional details (optional, required for 'Other')"
          value={details}
          onChange={(e) => {
            setDetails(e.target.value);
            setError(null);
          }}
          sx={{ mt: 2 }}
          disabled={isSubmitting}
        />

        {error && (
          <Typography
            variant="body2"
            color="error"
            sx={{ mt: 1, p: 1, bgcolor: (theme) => alpha(theme.palette.error.main, 0.1), borderRadius: 1 }}
          >
            {error}
          </Typography>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={handleClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="warning"
          onClick={handleSubmit}
          disabled={isSubmitting || !reason}
          startIcon={isSubmitting ? <CircularProgress size={16} color="inherit" /> : <Flag />}
        >
          {isSubmitting ? 'Submitting...' : 'Submit Report'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
