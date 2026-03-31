import { useState, useEffect, useCallback, useRef } from 'react';
import { config } from '../../../config/env';
import { tokenStorage } from '../../../services/auth/tokenStorage';

type EnrichmentState = 'checking' | 'not_started' | 'enriching' | 'ready' | 'error';

interface UseEnrichmentOptions {
  movieId: number;
  targetLang: string;
}

interface UseEnrichmentResult {
  status: EnrichmentState;
  isStarting: boolean;
  startEnrichment: () => Promise<void>;
}

const authFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
  const token = await tokenStorage.getAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return fetch(url, { ...options, headers });
};

export function useEnrichment({ movieId, targetLang }: UseEnrichmentOptions): UseEnrichmentResult {
  const [status, setStatus] = useState<EnrichmentState>('not_started');
  const [isStarting, setIsStarting] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!movieId || !targetLang) {
      setStatus('not_started');
      return;
    }

    const checkStatus = async () => {
      try {
        const response = await authFetch(
          `${config.API_URL}/api/enrichment/movies/${movieId}/status?lang=${targetLang}`
        );

        if (!response.ok) {
          setStatus('error');
          return;
        }

        const data = await response.json();
        setStatus(data.status);

        if (data.status === 'enriching' && !intervalRef.current) {
          intervalRef.current = setInterval(checkStatus, 10000);
        } else if (data.status !== 'enriching' && intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } catch {
        setStatus('error');
      }
    };

    checkStatus();

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [movieId, targetLang]);

  const startEnrichment = useCallback(async () => {
    if (!movieId || !targetLang) return;

    setIsStarting(true);
    try {
      const response = await authFetch(
        `${config.API_URL}/api/enrichment/movies/${movieId}/start?lang=${targetLang}`,
        { method: 'POST' }
      );

      if (!response.ok) {
        setStatus('error');
        return;
      }

      setStatus('enriching');
      // Start polling
      if (!intervalRef.current) {
        const checkStatus = async () => {
          try {
            const res = await authFetch(
              `${config.API_URL}/api/enrichment/movies/${movieId}/status?lang=${targetLang}`
            );
            if (res.ok) {
              const data = await res.json();
              setStatus(data.status);
              if (data.status !== 'enriching' && intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
              }
            }
          } catch {
            // Continue polling on error
          }
        };
        intervalRef.current = setInterval(checkStatus, 10000);
      }
    } catch {
      setStatus('error');
    } finally {
      setIsStarting(false);
    }
  }, [movieId, targetLang]);

  return { status, isStarting, startEnrichment };
}
