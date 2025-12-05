import { useState, useEffect, useCallback } from 'react';
import apiClient from '../services/api';
import { useAuth } from '../contexts/AuthContext';

interface UserWord {
  id: number;
  word: string;
  movie_id: number | null;
  is_learned: boolean;
  created_at: string;
  saved_in_count?: number;
  saved_in_movies?: Array<{ title: string; created_at: string; movie_id: number }>;
}

export function useUserWords() {
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());
  const [savedWordMoviePairs, setSavedWordMoviePairs] = useState<Set<string>>(new Set());
  const [learnedWords, setLearnedWords] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const { isAuthenticated } = useAuth();

  const fetchUserWords = async () => {
    if (!isAuthenticated) return;

    setLoading(true);
    try {
      const response = await apiClient.get<UserWord[]>(`/user/words/`);

      const saved = new Set<string>();
      const pairs = new Set<string>();
      const learned = new Set<string>();

      response.data.forEach((word) => {
        saved.add(word.word);

        if (word.saved_in_movies && word.saved_in_movies.length > 0) {
          word.saved_in_movies.forEach((movieData: any) => {
            if (movieData.movie_id) {
              pairs.add(`${word.word}:${movieData.movie_id}`);
            }
          });
        } else if (word.movie_id) {
          pairs.add(`${word.word}:${word.movie_id}`);
        }

        if (word.is_learned) {
          learned.add(word.word);
        }
      });

      setSavedWords(saved);
      setSavedWordMoviePairs(pairs);
      setLearnedWords(learned);
    } catch (error) {
      console.error('Failed to fetch user words:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUserWords();
  }, [isAuthenticated]);

  // Wrap in useCallback to provide stable reference to memoized components
  const saveWord = useCallback(async (word: string, movieId?: number) => {
    if (!isAuthenticated) return;

    try {
      const response = await apiClient.post(
        `/user/words/save`,
        { word, movie_id: movieId }
      );

      if (response.data.saved) {
        setSavedWords((prev) => new Set(prev).add(word));
        if (movieId) {
          setSavedWordMoviePairs((prev) => new Set(prev).add(`${word}:${movieId}`));
        }
      } else {
        const allUserWords = await apiClient.get<UserWord[]>(`/user/words/`);
        const stillHasWord = allUserWords.data.some(w => w.word === word);

        if (!stillHasWord) {
          setSavedWords((prev) => {
            const newSet = new Set(prev);
            newSet.delete(word);
            return newSet;
          });
          setLearnedWords((prev) => {
            const newSet = new Set(prev);
            newSet.delete(word);
            return newSet;
          });
        }

        if (movieId) {
          setSavedWordMoviePairs((prev) => {
            const newSet = new Set(prev);
            newSet.delete(`${word}:${movieId}`);
            return newSet;
          });
        }
      }
    } catch (error) {
      console.error('Failed to save word:', error);
    }
  }, [isAuthenticated]);

  // Wrap in useCallback to provide stable reference to memoized components
  const toggleLearned = useCallback(async (word: string) => {
    if (!isAuthenticated) return;

    const newLearnedState = !learnedWords.has(word);

    try {
      await apiClient.post(
        `/user/words/learn`,
        { word, is_learned: newLearnedState }
      );

      if (newLearnedState) {
        setLearnedWords((prev) => new Set(prev).add(word));
      } else {
        setLearnedWords((prev) => {
          const newSet = new Set(prev);
          newSet.delete(word);
          return newSet;
        });
      }
    } catch (error) {
      console.error('Failed to toggle learned:', error);
    }
  }, [isAuthenticated, learnedWords]);

  // Wrap in useCallback to provide stable reference to memoized components
  const isWordSavedInMovie = useCallback((word: string, movieId?: number) => {
    if (!movieId) return savedWords.has(word);
    return savedWordMoviePairs.has(`${word}:${movieId}`);
  }, [savedWords, savedWordMoviePairs]);

  return {
    savedWords,
    learnedWords,
    loading,
    saveWord,
    toggleLearned,
    refetch: fetchUserWords,
    isWordSavedInMovie
  };
}
