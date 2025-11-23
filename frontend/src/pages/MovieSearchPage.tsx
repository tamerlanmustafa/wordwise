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
import DifficultyCategories from '../components/DifficultyCategories';
import type { ScriptAnalysisResult } from '../types/script';
import { fetchMovieScript, classifyMovieScript } from '../services/scriptService';

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ErrorState | null>(null);
  const [analysis, setAnalysis] = useState<ScriptAnalysisResult | null>(null);
  const [searchedQuery, setSearchedQuery] = useState<string>('');
  const [scriptInfo, setScriptInfo] = useState<{
    source: string;
    fromCache: boolean;
    wordCount: number;
  } | null>(null);

  const handleSearch = async (query: string) => {
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setScriptInfo(null);
    setSearchedQuery(query);

    try {
      // Fetch script using the new ingestion system
      // This will automatically save to database
      const scriptResponse = await fetchMovieScript(query);

      // Check if we got a valid script
      if (!scriptResponse.cleaned_text || scriptResponse.word_count < 100) {
        setError({
          type: 'not-found',
          message: `Script not found or too short. Try another movie.`,
        });
        setLoading(false);
        return;
      }

      // Store script info for display
      setScriptInfo({
        source: scriptResponse.source_used,
        fromCache: scriptResponse.from_cache,
        wordCount: scriptResponse.word_count
      });

      // Classify the script using CEFR classifier
      console.log('[CEFR CLASSIFICATION] Starting hybrid CEFR classification...');
      const cefrResult = await classifyMovieScript(scriptResponse.movie_id);
      console.log('[CEFR RESULT]', cefrResult);

      // Convert CEFR response to ScriptAnalysisResult format
      const analysis: ScriptAnalysisResult = {
        title: scriptResponse.metadata.title,
        totalWords: cefrResult.total_words,
        uniqueWords: cefrResult.unique_words,
        categories: Object.entries(cefrResult.level_distribution).map(([level]) => ({
          level: level as 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2',
          description: getLevelDescription(level),
          words: cefrResult.top_words_by_level[level]?.map(w => ({
            word: w.word,
            count: Math.round(w.confidence * 100), // Show confidence as percentage
            frequency: w.confidence
          })) || []
        }))
      };

      setAnalysis(analysis);
    } catch (err: any) {
      console.error('[ERROR]', err);

      // Check for 404 error (movie not found)
      if (err.response?.status === 404) {
        setError({
          type: 'not-found',
          message: `Movie "${query}" not found in our database. Try another title.`,
        });
      } else {
        setError({
          type: 'error',
          message: err.response?.data?.detail || 'Failed to fetch or analyze the script. Please try again later.',
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setAnalysis(null);
    setError(null);
    setSearchedQuery('');
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* Header */}
      <Box sx={{ mb: 4, textAlign: 'center' }}>
        <Typography variant="h3" component="h1" fontWeight="bold" gutterBottom>
          Movie Script Analyzer
        </Typography>
        <Typography variant="h6" color="text.secondary" paragraph>
          Discover vocabulary difficulty levels in movie scripts
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Search for a movie, and we'll analyze the script to categorize vocabulary from A1
          (beginner) to C2 (proficient) using CEFR wordlists and frequency analysis.
        </Typography>
      </Box>

      {/* Search Bar */}
      <Paper elevation={3} sx={{ p: 3, mb: 4 }}>
        <MovieSearchBar onSearch={handleSearch} disabled={loading} />

        {(analysis || error) && (
          <Box sx={{ mt: 2, textAlign: 'center' }}>
            <Button variant="outlined" onClick={handleReset} size="small">
              Search Another Movie
            </Button>
          </Box>
        )}
      </Paper>

      {/* Loading State */}
      {loading && (
        <Fade in={loading}>
          <Paper elevation={2} sx={{ p: 4, textAlign: 'center' }}>
            <CircularProgress size={60} sx={{ mb: 2 }} />
            <Typography variant="h6" color="text.secondary">
              Analyzing script for "{searchedQuery}"...
            </Typography>
            <Stack spacing={1} sx={{ mt: 2 }}>
              <Typography variant="body2" color="text.secondary">
                • Searching STANDS4 database
              </Typography>
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

            <DifficultyCategories analysis={analysis} />
          </Box>
        </Fade>
      )}

      {/* Empty State */}
      {!loading && !error && !analysis && (
        <Fade in={!loading && !error && !analysis}>
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
              Try searching for "Interstellar" to see how it works
            </Typography>
            <Box sx={{ mt: 2 }}>
              <Typography variant="caption" color="text.secondary" display="block">
                1. Type a movie name in the search box
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                2. Click the Search button or press Enter
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
