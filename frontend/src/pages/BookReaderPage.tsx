import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Box,
  Container,
  Paper,
  Typography,
  CircularProgress,
  Alert,
  Button,
  IconButton,
  Drawer,
  useMediaQuery,
  useTheme
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import ListAltIcon from '@mui/icons-material/ListAlt';
import EPUBReader from '../components/reader/EPUBReader';
import ReaderControls from '../components/reader/ReaderControls';
import PageVocabulary from '../components/reader/PageVocabulary';
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

interface BookInfo {
  id?: number;
  gutenberg_id: number;
  title: string;
  author: string | null;
  epub_url: string | null;
  cover_url?: string | null;
}

export default function BookReaderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const bookState = location.state as {
    title?: string;
    author?: string;
    gutenbergId?: number;
  } | null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bookInfo, setBookInfo] = useState<BookInfo | null>(null);
  const [bookId, setBookId] = useState<number | null>(null);

  // Reader state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [fontSize, setFontSize] = useState(100);
  const [vocabDrawerOpen, setVocabDrawerOpen] = useState(!isMobile);

  // Parse gutenberg ID from URL
  const gutenbergId = id ? parseInt(id, 10) : null;

  // Load book info and get EPUB URL
  useEffect(() => {
    if (!gutenbergId || isNaN(gutenbergId)) {
      setError('Invalid book ID');
      setLoading(false);
      return;
    }

    const loadBookInfo = async () => {
      setLoading(true);
      setError(null);

      try {
        // First check if book is already analyzed (to get book ID for vocabulary)
        try {
          const analyzedResponse = await axios.get(
            `${API_BASE_URL}/api/books/by-gutenberg/${gutenbergId}`
          );
          setBookId(analyzedResponse.data.id);
        } catch (err) {
          // Book not analyzed yet, that's okay - we can still read it
          console.log('Book not analyzed yet, vocabulary will be limited');
        }

        // Get book details including EPUB URL
        const response = await axios.get(
          `${API_BASE_URL}/api/books/gutenberg/${gutenbergId}`
        );

        const data = response.data;

        if (!data.epub_url) {
          setError('This book does not have an EPUB version available');
          setLoading(false);
          return;
        }

        // Use our proxy endpoint to avoid CORS issues with Gutenberg
        const proxyEpubUrl = `${API_BASE_URL}/api/books/gutenberg/${gutenbergId}/epub`;

        setBookInfo({
          id: data.id,
          gutenberg_id: data.gutenberg_id,
          title: data.title || bookState?.title || 'Unknown Book',
          author: data.author || bookState?.author || null,
          epub_url: proxyEpubUrl,
          cover_url: data.cover_url
        });

        setLoading(false);
      } catch (err) {
        console.error('Failed to load book info:', err);
        setError('Failed to load book information');
        setLoading(false);
      }
    };

    loadBookInfo();
  }, [gutenbergId, bookState]);

  const handlePageChange = useCallback((page: number, total: number) => {
    setCurrentPage(page);
    setTotalPages(total);
  }, []);

  const handleReaderReady = useCallback((total: number) => {
    setTotalPages(total);
  }, []);

  const handleGoToPage = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  const handleFontSizeChange = useCallback((size: number) => {
    setFontSize(size);
  }, []);

  const handleBack = () => {
    navigate(`/book/${gutenbergId}`);
  };

  const toggleVocabDrawer = () => {
    setVocabDrawerOpen(!vocabDrawerOpen);
  };

  if (loading) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '80vh',
          gap: 2
        }}
      >
        <CircularProgress size={48} />
        <Typography color="text.secondary">Loading book...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
        <Button
          variant="outlined"
          startIcon={<ArrowBackIcon />}
          onClick={handleBack}
        >
          Back to Book Details
        </Button>
      </Container>
    );
  }

  if (!bookInfo || !bookInfo.epub_url) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Alert severity="warning">
          This book is not available for reading. Please try another book.
        </Alert>
        <Button
          variant="outlined"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/books/search')}
          sx={{ mt: 2 }}
        >
          Search Books
        </Button>
      </Container>
    );
  }

  const vocabPanelWidth = 320;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Header */}
      <Paper
        elevation={1}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          px: 2,
          py: 1,
          borderRadius: 0
        }}
      >
        <IconButton onClick={handleBack} size="small">
          <ArrowBackIcon />
        </IconButton>
        <MenuBookIcon color="primary" />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" fontWeight="bold" noWrap>
            {bookInfo.title}
          </Typography>
          {bookInfo.author && (
            <Typography variant="caption" color="text.secondary" noWrap>
              by {bookInfo.author}
            </Typography>
          )}
        </Box>
        {isMobile && (
          <IconButton onClick={toggleVocabDrawer} color="primary">
            <ListAltIcon />
          </IconButton>
        )}
      </Paper>

      {/* Main Content */}
      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Reader Area */}
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            mr: !isMobile && vocabDrawerOpen ? `${vocabPanelWidth}px` : 0,
            transition: 'margin 0.3s ease'
          }}
        >
          {/* Controls */}
          <Box sx={{ p: 1 }}>
            <ReaderControls
              currentPage={currentPage}
              totalPages={totalPages}
              fontSize={fontSize}
              onPageChange={handleGoToPage}
              onFontSizeChange={handleFontSizeChange}
              disabled={totalPages === 0}
            />
          </Box>

          {/* EPUB Reader */}
          <Box sx={{ flex: 1, overflow: 'hidden' }}>
            <EPUBReader
              url={bookInfo.epub_url}
              currentPage={currentPage}
              onPageChange={handlePageChange}
              onReady={handleReaderReady}
              fontSize={fontSize}
            />
          </Box>
        </Box>

        {/* Vocabulary Panel - Drawer on mobile, fixed on desktop */}
        {isMobile ? (
          <Drawer
            anchor="right"
            open={vocabDrawerOpen}
            onClose={() => setVocabDrawerOpen(false)}
            PaperProps={{
              sx: { width: vocabPanelWidth }
            }}
          >
            {bookId ? (
              <PageVocabulary
                bookId={bookId}
                currentPage={currentPage}
                totalPages={totalPages}
              />
            ) : (
              <Box sx={{ p: 2, textAlign: 'center' }}>
                <Alert severity="info">
                  Analyze this book first to see vocabulary for each page.
                </Alert>
                <Button
                  variant="contained"
                  onClick={handleBack}
                  sx={{ mt: 2 }}
                >
                  Go to Analysis
                </Button>
              </Box>
            )}
          </Drawer>
        ) : (
          vocabDrawerOpen && (
            <Paper
              elevation={2}
              sx={{
                position: 'fixed',
                right: 0,
                top: 64,
                bottom: 0,
                width: vocabPanelWidth,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                borderRadius: 0
              }}
            >
              {bookId ? (
                <PageVocabulary
                  bookId={bookId}
                  currentPage={currentPage}
                  totalPages={totalPages}
                />
              ) : (
                <Box sx={{ p: 2, textAlign: 'center' }}>
                  <Alert severity="info" sx={{ mb: 2 }}>
                    Analyze this book first to see vocabulary for each page.
                  </Alert>
                  <Button
                    variant="contained"
                    onClick={handleBack}
                  >
                    Go to Analysis
                  </Button>
                </Box>
              )}
            </Paper>
          )
        )}
      </Box>
    </Box>
  );
}
