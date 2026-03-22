import { useState, useEffect, useRef } from 'react';
import axios from 'axios';

export interface BookSuggestion {
  gutenberg_id: number;
  title: string;
  author: string | null;
  year: number | null;
  cover: string | null;
  is_public_domain: boolean;
}

export function useBookAutocomplete(query: string, debounceMs: number = 400) {
  const [suggestions, setSuggestions] = useState<BookSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    if (!query || query.trim().length < 2) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    timeoutRef.current = setTimeout(async () => {
      abortControllerRef.current = new AbortController();

      try {
        const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
        const response = await axios.get(`${API_BASE_URL}/api/books/search`, {
          params: { q: query.trim(), limit: 8 },
          signal: abortControllerRef.current.signal,
        });

        const books = response.data.books || [];

        // Map to suggestion format
        const mappedSuggestions: BookSuggestion[] = books.map((book: any) => ({
          gutenberg_id: book.gutenberg_id || book.id,
          title: book.title,
          author: book.author || (book.authors && book.authors[0]) || null,
          year: book.first_publish_year || book.author_death_year || null,
          cover: book.cover_medium || book.cover_small || book.cover_url || null,
          is_public_domain: book.is_public_domain !== false,
        }));

        setSuggestions(mappedSuggestions);
        setLoading(false);
      } catch (error) {
        if (axios.isCancel(error)) {
          return;
        }
        console.error('[BookAutocomplete] Error:', error);
        setSuggestions([]);
        setLoading(false);
      }
    }, debounceMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [query, debounceMs]);

  return { suggestions, loading };
}
