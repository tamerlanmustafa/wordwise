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
import { searchScripts, fetchScriptContent } from '../services/scriptService';
import { analyzeScriptDifficulty } from '../utils/wordFrequencyAnalyzer';

type ErrorType = 'error' | 'not-found' | null;

interface ErrorState {
  type: ErrorType;
  message: string;
}

export default function MovieSearchPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ErrorState | null>(null);
  const [analysis, setAnalysis] = useState<ScriptAnalysisResult | null>(null);
  const [searchedQuery, setSearchedQuery] = useState<string>('');

  const handleSearch = async (query: string) => {
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setSearchedQuery(query);

    try {
      // Search for the movie
      const searchResults = await searchScripts(query);

      if (searchResults.length === 0) {
        // No results found - show fallback message (not an error)
        setError({
          type: 'not-found',
          message: `No results. Try another movie title.`,
        });
        setLoading(false);
        return;
      }

      // Use the first result
      const movie = searchResults[0];

      // Fetch the script content
      const scriptText = await fetchScriptContent(movie.link);

      // Analyze the script difficulty
      console.log('[ANALYSIS] Starting word frequency analysis...');
      const result = analyzeScriptDifficulty(scriptText, movie.title);
      console.log('[ANALYSIS RESULT]', result);

      setAnalysis(result);
    } catch (err) {
      console.error('[ERROR]', err);
      setError({
        type: 'error',
        message: 'Failed to fetch or analyze the script. Please try again later.',
      });
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
          (beginner) to C2 (proficient) based on word frequency.
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
                • Searching for movie
              </Typography>
              <Typography variant="body2" color="text.secondary">
                • Fetching script content
              </Typography>
              <Typography variant="body2" color="text.secondary">
                • Analyzing word frequencies
              </Typography>
              <Typography variant="body2" color="text.secondary">
                • Categorizing by difficulty level
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
