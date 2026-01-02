import { useState, useEffect } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import {
  Container,
  Box,
  Typography,
  CircularProgress,
  Alert,
  Stack,
  Fade,
  Button,
  Paper,
  TextField,
  Slider,
  Collapse
} from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import VocabularyView from '../components/VocabularyView';
import type { ScriptAnalysisResult } from '../types/script';
import type { TMDBMetadata } from '../services/scriptService';
import {
  analyzeBook,
  getGutenbergBook,
  type BookSearchResult
} from '../services/bookService';
import { useAuth } from '../contexts/AuthContext';
import type { MovieDifficultyResult } from '../utils/computeMovieDifficulty';
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

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

export default function BookDetailPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { id: urlBookId } = useParams<{ id: string }>();
  const bookState = location.state as {
    title?: string;
    author?: string;
    gutenbergId?: number;
  } | null;
  const { isAuthenticated, user, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ScriptAnalysisResult | null>(null);
  const [bookMetadata, setBookMetadata] = useState<TMDBMetadata | null>(null);
  const [isPreview, setIsPreview] = useState(!isAuthenticated);
  const [bookId, setBookId] = useState<number | undefined>(undefined);
  const [difficulty, setDifficulty] = useState<MovieDifficultyResult | null>(null);
  const [bookInfo, setBookInfo] = useState<BookSearchResult | null>(null);
  const [needsAnalysis, setNeedsAnalysis] = useState(false);

  // Page filtering state
  const [pageInfo, setPageInfo] = useState<{
    totalPages: number | null;
    extractionMethod: string | null;
    hasPageData: boolean;
  } | null>(null);
  const [showPageFilter, setShowPageFilter] = useState(false);
  const [pageRange, setPageRange] = useState<[number, number]>([1, 10]);
  const [loadingPageVocab, setLoadingPageVocab] = useState(false);

  // Update preview mode when auth state changes
  useEffect(() => {
    setIsPreview(!isAuthenticated);
  }, [isAuthenticated]);

  // Load book info and check if already analyzed
  useEffect(() => {
    if (authLoading) return;

    const gutenbergId = bookState?.gutenbergId || (urlBookId ? parseInt(urlBookId, 10) : null);

    if (!gutenbergId || isNaN(gutenbergId)) {
      setError('Book ID not provided');
      setLoading(false);
      return;
    }

    const loadBook = async () => {
      setLoading(true);
      setError(null);

      try {
        // First, check if this book has already been analyzed using book-specific endpoint
        try {
          const existingResponse = await axios.get(
            `${API_BASE_URL}/api/books/by-gutenberg/${gutenbergId}`
          );

          // Book already analyzed, load vocabulary
          const existingBook = existingResponse.data;
          setBookId(existingBook.id);
          await loadVocabulary(existingBook.id, existingBook);
          return;
        } catch (err: any) {
          // 404 means book not analyzed yet, continue
          if (err.response?.status !== 404) {
            console.error('[BookDetail] Error checking existing book:', err);
          }
        }

        // Fetch book info from Gutenberg
        const book = await getGutenbergBook(gutenbergId);
        setBookInfo(book);

        // Set metadata for display
        setBookMetadata({
          id: gutenbergId,
          title: book.title || bookState?.title || 'Unknown Book',
          year: book.first_publish_year || book.author_death_year || null,
          poster: book.cover_large || book.cover_medium || null,
          overview: book.subjects?.slice(0, 5).join(', ') || 'Public domain book',
          genres: book.subjects?.slice(0, 5) || [],
          popularity: book.download_count || 0,
        });

        // Book needs to be analyzed
        setNeedsAnalysis(true);
        setLoading(false);

      } catch (err: any) {
        console.error('[BookDetail] Error loading book:', err);
        setError(err.message || 'Failed to load book information');
        setLoading(false);
      }
    };

    loadBook();
  }, [urlBookId, bookState, authLoading]);

  const loadVocabulary = async (bookId: number, bookData: any) => {
    try {
      // Set metadata
      setBookMetadata({
        id: bookId,
        title: bookData.title || 'Unknown Book',
        year: bookData.year || null,
        poster: bookData.cover_url || bookData.poster_url || null,
        overview: bookData.description || 'Public domain book',
        genres: [],
        popularity: 0,
      });

      // Fetch vocabulary from book-specific endpoint
      let cefrResult;
      try {
        if (isAuthenticated && user) {
          const response = await axios.get(`${API_BASE_URL}/api/books/${bookId}/vocabulary`, {
            headers: {
              Authorization: `Bearer ${localStorage.getItem('wordwise_token')}`
            }
          });
          cefrResult = response.data;
          setIsPreview(false);
        } else {
          const response = await axios.get(`${API_BASE_URL}/api/books/${bookId}/vocabulary/preview`);
          cefrResult = response.data;
          setIsPreview(true);
        }
      } catch (err) {
        console.error('[BookDetail] Error fetching vocabulary:', err);
        throw new Error('Failed to load vocabulary');
      }

      // Convert to analysis format
      const rawCategories = Object.entries(cefrResult.level_distribution).map(([level]) => ({
        level: level as 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2',
        description: getLevelDescription(level),
        words: cefrResult.top_words_by_level[level]?.map((w: any) => ({
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
        if (category.level === 'C1' || category.level === 'C2') {
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
            words: category.words.sort((a: { frequency_rank?: number | null }, b: { frequency_rank?: number | null }) => {
              const aRank = a.frequency_rank ?? 999999;
              const bRank = b.frequency_rank ?? 999999;
              return aRank - bRank;
            })
          };
        }
        return category;
      });

      const finalAnalysis: ScriptAnalysisResult = {
        title: bookData.title || 'Unknown Book',
        totalWords: cefrResult.total_words,
        uniqueWords: cefrResult.unique_words,
        categories: sortedCategories,
        idioms: cefrResult.idioms || []
      };

      setAnalysis(finalAnalysis);
      setNeedsAnalysis(false);

      // Fetch difficulty from book-specific endpoint
      try {
        const diffResponse = await axios.get(`${API_BASE_URL}/api/books/${bookId}/difficulty`);
        if (diffResponse.data.difficulty_level && diffResponse.data.difficulty_score !== null) {
          setDifficulty({
            level: diffResponse.data.difficulty_level,
            score: diffResponse.data.difficulty_score,
            breakdown: diffResponse.data.breakdown || {}
          });
        }
      } catch (diffErr) {
        console.error('[BookDetail] Error fetching difficulty:', diffErr);
      }

      setLoading(false);

      // Also fetch page info
      try {
        const pageResponse = await axios.get(`${API_BASE_URL}/api/books/${bookId}/pages`);
        setPageInfo({
          totalPages: pageResponse.data.total_pages,
          extractionMethod: pageResponse.data.extraction_method,
          hasPageData: pageResponse.data.has_page_data
        });
        if (pageResponse.data.total_pages) {
          setPageRange([1, Math.min(10, pageResponse.data.total_pages)]);
        }
      } catch (pageErr) {
        console.log('[BookDetail] No page info available');
      }

    } catch (err: any) {
      console.error('[BookDetail] Error loading vocabulary:', err);
      setError(err.message || 'Failed to load vocabulary');
      setLoading(false);
    }
  };

  const loadPageVocabulary = async (startPage: number, endPage: number) => {
    if (!bookId || !isAuthenticated) return;

    setLoadingPageVocab(true);

    try {
      const response = await axios.get(
        `${API_BASE_URL}/api/books/${bookId}/vocabulary/pages?start_page=${startPage}&end_page=${endPage}`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('wordwise_token')}`
          }
        }
      );

      const cefrResult = response.data;

      // Convert to analysis format
      const rawCategories = Object.entries(cefrResult.level_distribution).map(([level]) => ({
        level: level as 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2',
        description: getLevelDescription(level),
        words: cefrResult.words_by_level[level]?.map((w: { word: string; lemma: string; confidence: number; frequency_rank: number | null; page_number: number }) => ({
          word: w.word,
          lemma: w.lemma,
          count: Math.round(w.confidence * 100),
          frequency: w.confidence,
          confidence: w.confidence,
          frequency_rank: w.frequency_rank,
          page_number: w.page_number
        })) || []
      }));

      // Merge C1 and C2 into "Advanced"
      const mergedCategories = rawCategories.reduce((acc, category) => {
        if (category.level === 'C1' || category.level === 'C2') {
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

      const pageAnalysis: ScriptAnalysisResult = {
        title: `${bookMetadata?.title || 'Book'} (Pages ${startPage}-${endPage})`,
        totalWords: cefrResult.words_in_range,
        uniqueWords: cefrResult.words_in_range,
        categories: mergedCategories,
        idioms: []
      };

      setAnalysis(pageAnalysis);
      setIsPreview(false);

    } catch (err: any) {
      console.error('[BookDetail] Error loading page vocabulary:', err);
      setError(err.response?.data?.detail || err.message || 'Failed to load page vocabulary');
    } finally {
      setLoadingPageVocab(false);
    }
  };

  const handleApplyPageFilter = () => {
    loadPageVocabulary(pageRange[0], pageRange[1]);
  };

  const handleClearPageFilter = async () => {
    if (bookId) {
      setShowPageFilter(false);
      // Reload full vocabulary
      const book = await axios.get(`${API_BASE_URL}/api/books/${bookId}`);
      await loadVocabulary(bookId, book.data);
    }
  };

  const handleAnalyze = async () => {
    if (!bookInfo) return;

    if (!isAuthenticated) {
      navigate('/login', { state: { from: location } });
      return;
    }

    setAnalyzing(true);
    setError(null);

    try {
      const result = await analyzeBook(bookInfo.gutenberg_id);

      setBookId(result.book_id);

      if (result.warning) {
        console.warn('[BookDetail] Analysis warning:', result.warning);
      }

      // Load vocabulary after analysis
      await loadVocabulary(result.book_id, {
        title: result.title,
        year: bookInfo.first_publish_year || bookInfo.author_death_year,
        cover_url: bookInfo.cover_large || bookInfo.cover_medium,
        description: bookInfo.subjects?.join(', '),
      });

    } catch (err: any) {
      console.error('[BookDetail] Analysis failed:', err);
      setError(err.response?.data?.detail || err.message || 'Failed to analyze book');
      setAnalyzing(false);
    }
  };

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 8 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <CircularProgress size={60} />
          <Typography variant="h6" color="text.secondary">
            Loading book information...
          </Typography>
        </Box>
      </Container>
    );
  }

  if (error) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        <Button variant="outlined" onClick={() => navigate(-1)}>
          Go Back
        </Button>
      </Container>
    );
  }

  // Show analyze prompt if book needs analysis
  if (needsAnalysis && bookInfo) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', md: 'row' },
            gap: 4,
            alignItems: 'flex-start'
          }}
        >
          {/* Book Cover */}
          <Box
            sx={{
              width: { xs: '100%', md: 250 },
              flexShrink: 0
            }}
          >
            {bookInfo.cover_large || bookInfo.cover_medium ? (
              <Box
                component="img"
                src={bookInfo.cover_large || bookInfo.cover_medium || undefined}
                alt={bookInfo.title}
                sx={{
                  width: '100%',
                  borderRadius: 2,
                  boxShadow: 3
                }}
              />
            ) : (
              <Box
                sx={{
                  width: '100%',
                  aspectRatio: '2/3',
                  bgcolor: 'primary.main',
                  borderRadius: 2,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 1
                }}
              >
                <MenuBookIcon sx={{ fontSize: 64, color: 'primary.contrastText' }} />
                <Typography variant="caption" sx={{ color: 'primary.contrastText' }}>
                  No Cover
                </Typography>
              </Box>
            )}
          </Box>

          {/* Book Info */}
          <Box sx={{ flex: 1 }}>
            <Typography variant="h4" fontWeight="bold" gutterBottom>
              {bookInfo.title}
            </Typography>

            {bookInfo.author && (
              <Typography variant="h6" color="text.secondary" gutterBottom>
                by {bookInfo.author}
              </Typography>
            )}

            {bookInfo.first_publish_year && (
              <Typography variant="body1" color="text.secondary" gutterBottom>
                First published: {bookInfo.first_publish_year}
              </Typography>
            )}

            {bookInfo.subjects && bookInfo.subjects.length > 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                {bookInfo.subjects.slice(0, 5).join(' • ')}
              </Typography>
            )}

            <Alert severity="info" sx={{ mb: 3 }}>
              This book hasn't been analyzed yet. Click the button below to download and analyze the vocabulary.
            </Alert>

            <Button
              variant="contained"
              size="large"
              onClick={handleAnalyze}
              disabled={analyzing}
              startIcon={analyzing ? <CircularProgress size={20} color="inherit" /> : <MenuBookIcon />}
            >
              {analyzing ? 'Analyzing...' : 'Analyze Vocabulary'}
            </Button>

            {analyzing && (
              <Box sx={{ mt: 3 }}>
                <Typography variant="body2" color="text.secondary">
                  Downloading and analyzing the book text. This may take a minute...
                </Typography>
                <Stack spacing={1} sx={{ mt: 2 }}>
                  <Typography variant="body2" color="text.secondary">• Downloading from Project Gutenberg</Typography>
                  <Typography variant="body2" color="text.secondary">• Extracting vocabulary</Typography>
                  <Typography variant="body2" color="text.secondary">• Classifying difficulty levels</Typography>
                </Stack>
              </Box>
            )}

            {!isAuthenticated && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                You need to be logged in to analyze books.
              </Alert>
            )}
          </Box>
        </Box>
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
      {/* Page Filter Section */}
      {pageInfo?.totalPages && isAuthenticated && (
        <Paper sx={{ p: 2, mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <FilterListIcon color="primary" />
              <Typography variant="subtitle1" fontWeight="medium">
                Filter by Pages
              </Typography>
              <Typography variant="body2" color="text.secondary">
                ({pageInfo.totalPages} pages • {pageInfo.extractionMethod?.includes('estimated') ? 'estimated' : 'detected'})
              </Typography>
            </Box>
            <Button
              size="small"
              onClick={() => setShowPageFilter(!showPageFilter)}
            >
              {showPageFilter ? 'Hide' : 'Show'} Filter
            </Button>
          </Box>

          <Collapse in={showPageFilter}>
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Select page range to study vocabulary before reading:
              </Typography>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 2 }}>
                <TextField
                  label="Start Page"
                  type="number"
                  size="small"
                  value={pageRange[0]}
                  onChange={(e) => setPageRange([Math.max(1, parseInt(e.target.value) || 1), pageRange[1]])}
                  inputProps={{ min: 1, max: pageInfo.totalPages }}
                  sx={{ width: 100 }}
                />
                <Typography>to</Typography>
                <TextField
                  label="End Page"
                  type="number"
                  size="small"
                  value={pageRange[1]}
                  onChange={(e) => setPageRange([pageRange[0], Math.min(pageInfo.totalPages!, parseInt(e.target.value) || pageRange[1])])}
                  inputProps={{ min: 1, max: pageInfo.totalPages }}
                  sx={{ width: 100 }}
                />
              </Box>

              <Box sx={{ px: 1, mt: 2 }}>
                <Slider
                  value={pageRange}
                  onChange={(_, newValue) => setPageRange(newValue as [number, number])}
                  valueLabelDisplay="auto"
                  min={1}
                  max={pageInfo.totalPages}
                  marks={[
                    { value: 1, label: '1' },
                    { value: Math.floor(pageInfo.totalPages / 2), label: String(Math.floor(pageInfo.totalPages / 2)) },
                    { value: pageInfo.totalPages, label: String(pageInfo.totalPages) }
                  ]}
                />
              </Box>

              <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
                <Button
                  variant="contained"
                  onClick={handleApplyPageFilter}
                  disabled={loadingPageVocab}
                  startIcon={loadingPageVocab ? <CircularProgress size={16} /> : undefined}
                >
                  {loadingPageVocab ? 'Loading...' : `Show Words for Pages ${pageRange[0]}-${pageRange[1]}`}
                </Button>
                <Button
                  variant="outlined"
                  onClick={handleClearPageFilter}
                >
                  Show All Words
                </Button>
              </Box>
            </Box>
          </Collapse>
        </Paper>
      )}

      <Fade in={!!analysis}>
        <Box>
          <VocabularyView
            analysis={analysis}
            tmdbMetadata={bookMetadata}
            userId={user?.id}
            isPreview={isPreview}
            movieId={bookId}
            difficulty={difficulty}
            difficultyIsMock={false}
            isUploadedContent={false}
            gutenbergId={bookInfo?.gutenberg_id}
          />
        </Box>
      </Fade>
    </Container>
  );
}
