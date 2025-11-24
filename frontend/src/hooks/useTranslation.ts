import { useState, useCallback } from 'react';
import { translateText, type TranslationResponse } from '../services/scriptService';

interface UseTranslationResult {
  translated: string | null;
  translatedData: TranslationResponse | null;
  translate: (text: string, targetLang: string, sourceLang?: string) => Promise<void>;
  loading: boolean;
  error: string | null;
  cached: boolean;
  reset: () => void;
}

/**
 * Hook for translating text using DeepL API with caching
 *
 * @example
 * const { translated, translate, loading, error, cached } = useTranslation();
 *
 * // Translate a word
 * await translate('escape', 'DE');
 * console.log(translated); // "Flucht"
 * console.log(cached); // true/false
 */
export function useTranslation(): UseTranslationResult {
  const [translatedData, setTranslatedData] = useState<TranslationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const translate = useCallback(async (
    text: string,
    targetLang: string,
    sourceLang: string = 'auto'
  ) => {
    // Don't translate empty text
    if (!text || !text.trim()) {
      setError('Text cannot be empty');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await translateText(text, targetLang, sourceLang);
      setTranslatedData(response);
    } catch (err: any) {
      console.error('Translation error:', err);

      // Handle specific error cases
      if (err.response?.status === 429) {
        setError('Translation quota exceeded. Please try again later.');
      } else if (err.response?.status === 400) {
        setError('Invalid language code or text.');
      } else if (err.response?.status === 500) {
        setError('Translation service unavailable.');
      } else {
        setError('Failed to translate. Please try again.');
      }

      setTranslatedData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setTranslatedData(null);
    setError(null);
    setLoading(false);
  }, []);

  return {
    translated: translatedData?.translated || null,
    translatedData,
    translate,
    loading,
    error,
    cached: translatedData?.cached || false,
    reset
  };
}
