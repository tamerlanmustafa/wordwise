import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Container,
  Box,
  Typography,
  CircularProgress,
  Alert,
  Stack,
  Fade
} from '@mui/material';
import VocabularyView from '../components/VocabularyView';
import type { ScriptAnalysisResult } from '../types/script';
import {
  searchMovies,
  fetchMovieScriptById,
  classifyMovieScript,
  getVocabularyPreview,
  getVocabularyFull,
  type TMDBMetadata
} from '../services/scriptService';
import { useAuth } from '../contexts/AuthContext';

const getLevelDescription = (level: string): string => {
  const descriptions: Record<string, string> = {
    'A1': 'Beginner - Most frequent words (easiest)',
    'A2': 'Elementary - Very common words',
    'B1': 'Intermediate - Common words',
    'B2': 'Upper Intermediate - Less common words',
    'C1': 'Advanced - Uncommon words',
    'C2': 'Proficient - Rarest words (hardest)'
  };
  return descriptions[level] || 'Unknown level';
};

export default function MovieDetailPage() {
  const location = useLocation();
  const movieState = location.state as { title?: string; year?: number | null; tmdbId?: number } | null;
  const { isAuthenticated, user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ScriptAnalysisResult | null>(null);
  const [tmdbMetadata, setTmdbMetadata] = useState<TMDBMetadata | null>(null);
  const [isPreview, setIsPreview] = useState(false);
  const [movieId, setMovieId] = useState<number | undefined>(undefined);
  const [difficulty, setDifficulty] = useState<{
    level: string | null;
    score: number | null;
  } | null>(null);
  const [scriptInfo, setScriptInfo] = useState<{
    source: string;
    fromCache: boolean;
    wordCount: number;
  } | null>(null);

  useEffect(() => {
    if (!movieState?.title) {
      setError('Movie title not provided');
      setLoading(false);
      return;
    }

    const analyzeMovie = async () => {
      setLoading(true);
      setError(null);

      try {
        const movieTitle = movieState.title!;

        // Step 1: Search for the movie using WordWise API
        const searchResponse = await searchMovies(movieTitle);

        if (!searchResponse.results || searchResponse.results.length === 0) {
          setError(`No script found for "${movieTitle}". This movie may not be available in our database yet.`);
          setLoading(false);
          return;
        }

        // Store TMDB metadata from search response
        if (searchResponse.tmdb_metadata) {
          setTmdbMetadata(searchResponse.tmdb_metadata);
        }

        // Step 2: Use the first result (best match)
        const scriptId = searchResponse.results[0].id;

        // Step 3: Fetch the script
        const scriptResponse = await fetchMovieScriptById(scriptId, movieTitle);

        if (!scriptResponse.cleaned_text || scriptResponse.word_count < 100) {
          setError(`Script not found or too short for "${movieTitle}". Try another movie.`);
          setLoading(false);
          return;
        }

        // Store script info and movie ID
        setScriptInfo({
          source: scriptResponse.source_used,
          fromCache: scriptResponse.from_cache,
          wordCount: scriptResponse.word_count
        });
        setMovieId(scriptResponse.movie_id);

        // Step 4: Classify vocabulary using CEFR
        await classifyMovieScript(scriptResponse.movie_id);

        // Step 5: Fetch vocabulary based on auth status
        let cefrResult;
        if (isAuthenticated && user) {
          const token = localStorage.getItem('wordwise_token');
          if (token) {
            cefrResult = await getVocabularyFull(scriptResponse.movie_id, token);
            setIsPreview(false);
          } else {
            cefrResult = await getVocabularyPreview(scriptResponse.movie_id);
            setIsPreview(true);
          }
        } else {
          cefrResult = await getVocabularyPreview(scriptResponse.movie_id);
          setIsPreview(true);
        }

        // Step 6: Convert to analysis format
        const rawCategories = Object.entries(cefrResult.level_distribution).map(([level]) => ({
          level: level as 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2',
          description: getLevelDescription(level),
          words: cefrResult.top_words_by_level[level]?.map(w => ({
            word: w.word,
            lemma: w.lemma,
            count: Math.round(w.confidence * 100),
            frequency: w.confidence,
            confidence: w.confidence,
            frequency_rank: w.frequency_rank
          })) || []
        }));

        // Merge C1 and C2 into "Advanced"
        const mergedCategories = rawCategories.reduce((acc, category) => {
          if (category.level === 'C1') {
            const advancedIndex = acc.findIndex(c => c.level === 'C1');
            if (advancedIndex === -1) {
              acc.push({
                level: 'C1' as const,
                description: 'Advanced vocabulary',
                words: category.words
              });
            } else {
              acc[advancedIndex].words.push(...category.words);
            }
          } else if (category.level === 'C2') {
            const advancedIndex = acc.findIndex(c => c.level === 'C1');
            if (advancedIndex === -1) {
              acc.push({
                level: 'C1' as const,
                description: 'Advanced vocabulary',
                words: category.words
              });
            } else {
              acc[advancedIndex].words.push(...category.words);
            }
          } else {
            acc.push(category);
          }
          return acc;
        }, [] as typeof rawCategories);

        // Sort Advanced words by frequency_rank
        const sortedCategories = mergedCategories.map(category => {
          if (category.level === 'C1') {
            return {
              ...category,
              words: category.words.sort((a, b) => {
                const aRank = a.frequency_rank ?? 999999;
                const bRank = b.frequency_rank ?? 999999;
                return aRank - bRank;
              })
            };
          }
          return category;
        });

        const finalAnalysis: ScriptAnalysisResult = {
          title: movieTitle,
          totalWords: cefrResult.total_words,
          uniqueWords: cefrResult.unique_words,
          categories: sortedCategories
        };

        setAnalysis(finalAnalysis);

        try {
          const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
          const diffResponse = await axios.get(`${API_BASE_URL}/movies/${scriptResponse.movie_id}/difficulty`);
          setDifficulty({
            level: diffResponse.data.difficulty_level,
            score: diffResponse.data.difficulty_score
          });
        } catch (diffErr) {
          // Difficulty not yet computed, skip silently
        }

      } catch (err: any) {
        console.error('[ANALYZE ERROR]', err);

        if (err.response?.status === 404) {
          setError(`Script not found for "${movieState.title}". This movie may not be available in our database.`);
        } else {
          setError(err.response?.data?.detail || 'Failed to fetch or analyze the script. Please try again.');
        }
      } finally {
        setLoading(false);
      }
    };

    analyzeMovie();
  }, [movieState]);

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 8 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <CircularProgress size={60} />
          <Typography variant="h6" color="text.secondary">
            Analyzing "{movieState?.title}"...
          </Typography>
          <Stack spacing={1} sx={{ textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              • Searching for script
            </Typography>
            <Typography variant="body2" color="text.secondary">
              • Extracting vocabulary
            </Typography>
            <Typography variant="body2" color="text.secondary">
              • Classifying difficulty levels
            </Typography>
          </Stack>
        </Box>
      </Container>
    );
  }

  if (error) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error">{error}</Alert>
      </Container>
    );
  }

  if (!analysis) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="info">No analysis available</Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {scriptInfo && (
        <Alert
          severity={scriptInfo.fromCache ? 'info' : 'success'}
          sx={{ mb: 3 }}
        >
          <Typography variant="body2">
            <strong>Source:</strong> {scriptInfo.source.replace('_', ' ')} • {' '}
            <strong>Total Words:</strong> {scriptInfo.wordCount.toLocaleString()} • {' '}
            <strong>Status:</strong> {scriptInfo.fromCache ? 'Loaded from cache' : 'Freshly downloaded and saved'}
            {difficulty?.level && (
              <>
                {' • '}
                <strong>Difficulty:</strong> {difficulty.level} ({difficulty.score}/100)
              </>
            )}
          </Typography>
        </Alert>
      )}

      <Fade in={!!analysis}>
        <Box>
          <VocabularyView
            analysis={analysis}
            tmdbMetadata={tmdbMetadata}
            userId={user?.id}
            isPreview={isPreview}
            movieId={movieId}
          />
        </Box>
      </Fade>
    </Container>
  );
}
