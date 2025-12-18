import { useState, useEffect } from 'react';
import { Alert, CircularProgress, Chip, Fade, Box, Button } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';

interface EnrichmentStatusProps {
  movieId?: number;
  targetLang?: string;
}

type EnrichmentState = 'checking' | 'not_started' | 'enriching' | 'ready' | 'error';

/**
 * EnrichmentStatus Component
 *
 * Shows the current status of sentence example enrichment for a movie.
 * User must click a button to start enrichment (not automatic).
 * Polls the backend to determine if enrichment is:
 * - not_started: No classification yet - shows "Start Enrichment" button
 * - enriching: Background job in progress
 * - ready: Examples available
 * - error: Failed to check status
 */
export function EnrichmentStatus({ movieId, targetLang }: EnrichmentStatusProps) {
  const [status, setStatus] = useState<EnrichmentState>('checking');
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    if (!movieId || !targetLang) {
      setStatus('not_started');
      return;
    }

    let intervalId: number | null = null;

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

        // If enriching, set up polling (only once)
        if (data.status === 'enriching' && !intervalId) {
          intervalId = window.setInterval(checkStatus, 10000); // Poll every 10 seconds
        } else if (data.status !== 'enriching' && intervalId) {
          // Stop polling once enrichment is complete
          window.clearInterval(intervalId);
          intervalId = null;
        }
      } catch (error) {
        console.error('Enrichment status check failed:', error);
        setStatus('error');
      }
    };

    // Initial check
    checkStatus();

    // Cleanup on unmount
    return () => {
      if (intervalId) {
        window.clearInterval(intervalId);
      }
    };
  }, [movieId, targetLang]);

  const handleStartEnrichment = async () => {
    if (!movieId || !targetLang) return;

    setIsStarting(true);
    try {
      const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
      const response = await fetch(
        `${API_BASE_URL}/api/enrichment/movies/${movieId}/start?lang=${targetLang}`,
        { method: 'POST' }
      );

      if (!response.ok) {
        console.error('Failed to start enrichment:', response.statusText);
        setStatus('error');
        return;
      }

      // After starting, check status immediately
      setStatus('enriching');
    } catch (error) {
      console.error('Start enrichment failed:', error);
      setStatus('error');
    } finally {
      setIsStarting(false);
    }
  };

  // Don't show anything if checking
  if (status === 'checking') {
    return null;
  }

  // Don't show anything if there's an error (fail silently)
  if (status === 'error') {
    return null;
  }

  // Show "Start Enrichment" button
  if (status === 'not_started') {
    return (
      <Fade in timeout={500}>
        <Box sx={{ mb: 2, px: 1 }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<AutoAwesomeIcon />}
            onClick={handleStartEnrichment}
            disabled={isStarting}
            sx={{
              fontSize: '0.75rem',
              textTransform: 'none',
              borderRadius: 2,
            }}
          >
            {isStarting ? 'Starting...' : 'Enrich with sentence examples'}
          </Button>
        </Box>
      </Fade>
    );
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
            Generating sentence examples from movie script... This takes 1-2 minutes.
          </Alert>
        </Box>
      </Fade>
    );
  }

  return null;
}
