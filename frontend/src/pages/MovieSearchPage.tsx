import { useState } from 'react';
import {
  Container,
  Box,
  Typography,
  Paper,
  CircularProgress,
  Alert,
  Fade,
  Button,
  Stack,
} from '@mui/material';
import MovieSearchBar from '../components/MovieSearchBar';
import MovieSelectionList from '../components/MovieSelectionList';
import VocabularyView from '../components/VocabularyView';
import type { ScriptAnalysisResult } from '../types/script';
import {
  searchMovies,
  fetchMovieScriptById,
  classifyMovieScript,
  type MovieSearchResult,
  type TMDBMetadata
} from '../services/scriptService';

type ErrorType = 'error' | 'not-found' | null;

interface ErrorState {
  type: ErrorType;
  message: string;
}

// Helper function to get level descriptions
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

export default function MovieSearchPage() {
  const [searchLoading, setSearchLoading] = useState(false);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [error, setError] = useState<ErrorState | null>(null);
  const [searchResults, setSearchResults] = useState<MovieSearchResult[]>([]);
  const [selectedMovie, setSelectedMovie] = useState<MovieSearchResult | null>(null);
  const [analysis, setAnalysis] = useState<ScriptAnalysisResult | null>(null);
  const [searchedQuery, setSearchedQuery] = useState<string>('');
  const [tmdbMetadata, setTmdbMetadata] = useState<TMDBMetadata | null>(null);
  const [scriptInfo, setScriptInfo] = useState<{
    source: string;
    fromCache: boolean;
    wordCount: number;
  } | null>(null);

  // Step 1: Search for movies
  const handleSearch = async (query: string) => {
    setSearchLoading(true);
    setError(null);
    setSearchResults([]);
    setSelectedMovie(null);
    setAnalysis(null);
    setScriptInfo(null);
    setTmdbMetadata(null);
    setSearchedQuery(query);

    try {
      // Search for ALL matching movies (includes TMDB metadata)
      const searchResponse = await searchMovies(query);

      if (searchResponse.total === 0) {
        setError({
          type: 'not-found',
          message: `No movies found for "${query}". Try a different search.`,
        });
      } else {
        // Show the list of results for user selection
        setSearchResults(searchResponse.results);
        // Store TMDB metadata for display
        setTmdbMetadata(searchResponse.tmdb_metadata);
      }
    } catch (err: any) {
      console.error('[SEARCH ERROR]', err);
      setError({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to search for movies. Please try again.',
      });
    } finally {
      setSearchLoading(false);
    }
  };

  // Step 2: Fetch and analyze selected movie
  const handleMovieSelect = async (movie: MovieSearchResult) => {
    setAnalyzeLoading(true);
    setError(null);
    setSelectedMovie(movie);
    setAnalysis(null);
    setScriptInfo(null);

    try {
      // Fetch the exact script using script ID
      console.log('[FETCH] Fetching script for:', movie.title, 'ID:', movie.id);
      const scriptResponse = await fetchMovieScriptById(movie.id, movie.title);

      // Check if we got a valid script
      if (!scriptResponse.cleaned_text || scriptResponse.word_count < 100) {
        setError({
          type: 'not-found',
          message: `Script not found or too short for "${movie.title}". Try another movie.`,
        });
        setAnalyzeLoading(false);
        return;
      }

      // Store script info for display
      setScriptInfo({
        source: scriptResponse.source_used,
        fromCache: scriptResponse.from_cache,
        wordCount: scriptResponse.word_count
      });

      // Classify the script using CEFR classifier
      // console.log('[CEFR CLASSIFICATION] Starting hybrid CEFR classification...');
      const cefrResult = await classifyMovieScript(scriptResponse.movie_id);
      // console.log('[CEFR RESULT]', cefrResult);

      // Convert CEFR response to ScriptAnalysisResult format
      // Combine C1 and C2 into a single "Advanced" category
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

      // Merge C1 and C2 into "Advanced" category
      const mergedCategories = rawCategories.reduce((acc, category) => {
        if (category.level === 'C1') {
          // Create or update Advanced category
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
          // Merge C2 words into Advanced (C1)
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
          // Keep A1, A2, B1, B2 as-is
          acc.push(category);
        }
        return acc;
      }, [] as typeof rawCategories);

      // Sort combined Advanced words by frequency_rank (easier to harder)
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

      const analysis: ScriptAnalysisResult = {
        title: movie.title,
        totalWords: cefrResult.total_words,
        uniqueWords: cefrResult.unique_words,
        categories: sortedCategories
      };

      setAnalysis(analysis);
    } catch (err: any) {
      console.error('[ANALYZE ERROR]', err);

      if (err.response?.status === 404) {
        setError({
          type: 'not-found',
          message: `Script not found for "${movie.title}". Try another movie.`,
        });
      } else {
        setError({
          type: 'error',
          message: err.response?.data?.detail || 'Failed to fetch or analyze the script. Please try again.',
        });
      }
    } finally {
      setAnalyzeLoading(false);
    }
  };

  const handleReset = () => {
    setAnalysis(null);
    setError(null);
    setSearchResults([]);
    setSelectedMovie(null);
    setSearchedQuery('');
    setTmdbMetadata(null);
  };

  const loading = searchLoading || analyzeLoading;

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* Search Bar */}
      <Paper elevation={3} sx={{ p: 3, mb: 4 }}>
        <MovieSearchBar onSearch={handleSearch} disabled={loading} />

        {(searchResults.length > 0 || analysis || error) && (
          <Box sx={{ mt: 2, textAlign: 'center' }}>
            <Button variant="outlined" onClick={handleReset} size="small">
              Search Another Movie
            </Button>
          </Box>
        )}
      </Paper>

      {/* Search Loading State */}
      {searchLoading && (
        <Fade in={searchLoading}>
          <Paper elevation={2} sx={{ p: 4, textAlign: 'center' }}>
            <CircularProgress size={60} sx={{ mb: 2 }} />
            <Typography variant="h6" color="text.secondary">
              Searching for "{searchedQuery}"...
            </Typography>
          </Paper>
        </Fade>
      )}

      {/* Movie Selection List */}
      {!searchLoading && searchResults.length > 0 && !selectedMovie && (
        <Fade in={searchResults.length > 0}>
          <Box>
            <MovieSelectionList
              movies={searchResults}
              onSelect={handleMovieSelect}
              loading={analyzeLoading}
            />
          </Box>
        </Fade>
      )}

      {/* Analyze Loading State */}
      {analyzeLoading && selectedMovie && (
        <Fade in={analyzeLoading}>
          <Paper elevation={2} sx={{ p: 4, textAlign: 'center' }}>
            <CircularProgress size={60} sx={{ mb: 2 }} />
            <Typography variant="h6" color="text.secondary">
              Analyzing "{selectedMovie.title}"...
            </Typography>
            <Stack spacing={1} sx={{ mt: 2 }}>
              <Typography variant="body2" color="text.secondary">
                • Downloading PDF script
              </Typography>
              <Typography variant="body2" color="text.secondary">
                • Extracting text from PDF
              </Typography>
              <Typography variant="body2" color="text.secondary">
                • Saving to database
              </Typography>
              <Typography variant="body2" color="text.secondary">
                • Classifying words with CEFR levels
              </Typography>
            </Stack>
          </Paper>
        </Fade>
      )}

      {/* Error State - Not Found (Fallback Message) */}
      {error && error.type === 'not-found' && !loading && (
        <Fade in={!!error}>
          <Alert severity="info" onClose={() => setError(null)} sx={{ mb: 3 }}>
            <Typography variant="body1" fontWeight="medium">
              {error.message}
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
              Searched for: "{searchedQuery}"
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
              Suggestions:
            </Typography>
            <Box component="ul" sx={{ mt: 0.5, mb: 0, pl: 2 }}>
              <li>Check spelling</li>
              <li>Try a different variation (e.g., "The Matrix" vs "Matrix")</li>
              <li>Use the full movie title</li>
              <li>Try a more popular movie</li>
            </Box>
          </Alert>
        </Fade>
      )}

      {/* Error State - Technical Error */}
      {error && error.type === 'error' && !loading && (
        <Fade in={!!error}>
          <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 3 }}>
            {error.message}
          </Alert>
        </Fade>
      )}

      {/* Analysis Results */}
      {analysis && !loading && (
        <Fade in={!!analysis}>
          <Box>
            {/* Script Info Banner */}
            {scriptInfo && (
              <Alert
                severity={scriptInfo.fromCache ? 'info' : 'success'}
                sx={{ mb: 3 }}
              >
                <Typography variant="body2">
                  <strong>Source:</strong> {scriptInfo.source.replace('_', ' ')} • {' '}
                  <strong>Total Words:</strong> {scriptInfo.wordCount.toLocaleString()} • {' '}
                  <strong>Status:</strong> {scriptInfo.fromCache ? 'Loaded from cache' : 'Freshly downloaded and saved'}
                </Typography>
              </Alert>
            )}

            <VocabularyView
              analysis={analysis}
              tmdbMetadata={tmdbMetadata}
            />
          </Box>
        </Fade>
      )}

      {/* Empty State */}
      {!loading && !error && !analysis && searchResults.length === 0 && (
        <Fade in={!loading && !error && !analysis && searchResults.length === 0}>
          <Paper
            elevation={1}
            sx={{
              p: 6,
              textAlign: 'center',
              backgroundColor: 'grey.50',
              border: '2px dashed',
              borderColor: 'grey.300',
            }}
          >
            <Typography variant="h6" color="text.secondary" gutterBottom>
              Start by searching for a movie
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              Try searching for "Titanic" or "Good Will Hunting"
            </Typography>
            <Box sx={{ mt: 2 }}>
              <Typography variant="caption" color="text.secondary" display="block">
                1. Type a movie name in the search box
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                2. Select the exact movie from the list
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                3. View the vocabulary analysis results
              </Typography>
            </Box>
          </Paper>
        </Fade>
      )}
    </Container>
  );
}
