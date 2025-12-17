import { useState, useEffect } from 'react';
import { Alert, CircularProgress, Chip, Fade, Box } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

interface EnrichmentStatusProps {
  movieId?: number;
  targetLang?: string;
}

type EnrichmentState = 'checking' | 'not_started' | 'enriching' | 'ready' | 'error';

/**
 * EnrichmentStatus Component
 *
 * Shows the current status of sentence example enrichment for a movie.
 * Polls the backend to determine if enrichment is:
 * - not_started: No classification yet
 * - enriching: Background job in progress
 * - ready: Examples available
 * - error: Failed to check status
 */
export function EnrichmentStatus({ movieId, targetLang }: EnrichmentStatusProps) {
  const [status, setStatus] = useState<EnrichmentState>('checking');
  const [pollInterval, setPollInterval] = useState<number | null>(null);

  useEffect(() => {
    if (!movieId || !targetLang) {
      setStatus('not_started');
      return;
    }

    const checkStatus = async () => {
      try {
        const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
        const response = await fetch(
          `${API_BASE_URL}/api/enrichment/movies/${movieId}/status?lang=${targetLang}`
        );

        if (!response.ok) {
          console.error('Failed to fetch enrichment status:', response.statusText);
          setStatus('error');
          return;
        }

        const data = await response.json();
        setStatus(data.status);

        // If enriching, set up polling
        if (data.status === 'enriching') {
          // Poll every 5 seconds while enriching
          if (!pollInterval) {
            const interval = window.setInterval(() => {
              checkStatus();
            }, 5000);
            setPollInterval(interval);
          }
        } else {
          // Stop polling once enrichment is ready or failed
          if (pollInterval) {
            window.clearInterval(pollInterval);
            setPollInterval(null);
          }
        }
      } catch (error) {
        console.error('Enrichment status check failed:', error);
        setStatus('error');
      }
    };

    checkStatus();

    // Cleanup on unmount
    return () => {
      if (pollInterval) {
        window.clearInterval(pollInterval);
      }
    };
  }, [movieId, targetLang]);

  // Don't show anything if checking or not started
  if (status === 'checking' || status === 'not_started') {
    return null;
  }

  // Don't show anything if there's an error (fail silently)
  if (status === 'error') {
    return null;
  }

  // Show "ready" chip
  if (status === 'ready') {
    return (
      <Fade in timeout={500}>
        <Box sx={{ mb: 2, px: 1 }}>
          <Chip
            icon={<CheckCircleIcon />}
            label="Sentence examples ready"
            color="success"
            size="small"
            variant="outlined"
            sx={{ fontSize: '0.75rem' }}
          />
        </Box>
      </Fade>
    );
  }

  // Show "enriching" alert
  if (status === 'enriching') {
    return (
      <Fade in timeout={500}>
        <Box sx={{ mb: 2 }}>
          <Alert
            severity="info"
            icon={<CircularProgress size={20} />}
            sx={{
              fontSize: '0.875rem',
              alignItems: 'center'
            }}
          >
            Generating sentence examples from movie script... This takes about 1 minute.
          </Alert>
        </Box>
      </Fade>
    );
  }

  return null;
}
