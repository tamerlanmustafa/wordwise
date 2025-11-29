import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';

interface UserWord {
  id: number;
  word: string;
  movie_id: number | null;
  is_learned: boolean;
  created_at: string;
}

export function useUserWords() {
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());
  const [learnedWords, setLearnedWords] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const { isAuthenticated } = useAuth();

  const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

  const fetchUserWords = async () => {
    if (!isAuthenticated) return;

    setLoading(true);
    try {
      const token = localStorage.getItem('wordwise_token');
      const response = await axios.get<UserWord[]>(`${API_BASE_URL}/user/words/`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      const saved = new Set<string>();
      const learned = new Set<string>();

      response.data.forEach((word) => {
        saved.add(word.word);
        if (word.is_learned) {
          learned.add(word.word);
        }
      });

      setSavedWords(saved);
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

  const saveWord = async (word: string, movieId?: number) => {
    if (!isAuthenticated) return;

    try {
      const token = localStorage.getItem('wordwise_token');
      const response = await axios.post(
        `${API_BASE_URL}/user/words/save`,
        { word, movie_id: movieId },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.data.saved) {
        setSavedWords((prev) => new Set(prev).add(word));
      } else {
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
    } catch (error) {
      console.error('Failed to save word:', error);
    }
  };

  const toggleLearned = async (word: string) => {
    if (!isAuthenticated) return;

    const newLearnedState = !learnedWords.has(word);

    try {
      const token = localStorage.getItem('wordwise_token');
      await axios.post(
        `${API_BASE_URL}/user/words/learn`,
        { word, is_learned: newLearnedState },
        { headers: { Authorization: `Bearer ${token}` } }
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
  };

  return {
    savedWords,
    learnedWords,
    loading,
    saveWord,
    toggleLearned,
    refetch: fetchUserWords
  };
}
