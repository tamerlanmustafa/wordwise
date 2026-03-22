import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  IconButton,
  Drawer,
  useMediaQuery,
  useTheme
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import MenuBookIcon from '@mui/icons-material/MenuBook';
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
}

export default function BookReaderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bookInfo, setBookInfo] = useState<BookInfo | null>(null);
  const [bookId, setBookId] = useState<number | null>(null);

  // Reader state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [fontSize, setFontSize] = useState(100);
  const [vocabDrawerOpen, setVocabDrawerOpen] = useState(!isMobile);

  const gutenbergId = id ? parseInt(id, 10) : null;

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
        // Check if book is analyzed
        try {
          const analyzedResponse = await axios.get(
            `${API_BASE_URL}/api/books/by-gutenberg/${gutenbergId}`
          );
          setBookId(analyzedResponse.data.id);
        } catch {
          console.log('Book not analyzed yet');
        }

        // Get book details
        const response = await axios.get(
          `${API_BASE_URL}/api/books/gutenberg/${gutenbergId}`
        );

        const data = response.data;

        if (!data.epub_url) {
          setError('This book does not have an EPUB version available');
          setLoading(false);
          return;
        }

        const proxyEpubUrl = `${API_BASE_URL}/api/books/gutenberg/${gutenbergId}/epub`;

        setBookInfo({
          id: data.id,
          gutenberg_id: data.gutenberg_id,
          title: data.title || 'Unknown Book',
          author: data.author || null,
          epub_url: proxyEpubUrl
        });

        setLoading(false);
      } catch (err) {
        console.error('Failed to load book info:', err);
        setError('Failed to load book information');
        setLoading(false);
      }
    };

    loadBookInfo();
  }, [gutenbergId]);

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
        <CircularProgress size={40} />
        <Typography color="text.secondary">Loading book...</Typography>
      </Box>
    );
  }

  if (error || !bookInfo?.epub_url) {
    return (
      <Box sx={{ p: 4, maxWidth: 600, mx: 'auto' }}>
        <Alert severity="error" sx={{ mb: 3 }}>
          {error || 'This book is not available for reading.'}
        </Alert>
        <IconButton onClick={handleBack} sx={{ mr: 1 }}>
          <ArrowBackIcon />
        </IconButton>
        <Typography component="span" color="text.secondary">
          Back to book details
        </Typography>
      </Box>
    );
  }

  const vocabWidth = 300;

  return (
    <Box sx={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      bgcolor: 'grey.50'
    }}>
      {/* Minimal Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 2,
          py: 1,
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider'
        }}
      >
        <IconButton onClick={handleBack} size="small">
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        <MenuBookIcon sx={{ color: 'primary.main', fontSize: 20 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={600} noWrap>
            {bookInfo.title}
          </Typography>
          {bookInfo.author && (
            <Typography variant="caption" color="text.secondary" noWrap component="div">
              {bookInfo.author}
            </Typography>
          )}
        </Box>
        {isMobile && (
          <IconButton
            onClick={() => setVocabDrawerOpen(!vocabDrawerOpen)}
            size="small"
            color={vocabDrawerOpen ? 'primary' : 'default'}
          >
            <MenuBookIcon fontSize="small" />
          </IconButton>
        )}
      </Box>

      {/* Main Content */}
      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Reader Area */}
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            transition: 'margin 0.2s ease',
            mr: !isMobile && vocabDrawerOpen ? `${vocabWidth}px` : 0
          }}
        >
          {/* Controls */}
          <Box sx={{ px: 2, py: 1 }}>
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
          <Box
            sx={{
              flex: 1,
              overflow: 'hidden',
              mx: 2,
              mb: 2,
              bgcolor: 'background.paper',
              borderRadius: 2,
              boxShadow: 1
            }}
          >
            <EPUBReader
              url={bookInfo.epub_url}
              currentPage={currentPage}
              onPageChange={handlePageChange}
              onReady={handleReaderReady}
              fontSize={fontSize}
            />
          </Box>
        </Box>

        {/* Vocabulary Panel */}
        {isMobile ? (
          <Drawer
            anchor="right"
            open={vocabDrawerOpen}
            onClose={() => setVocabDrawerOpen(false)}
            PaperProps={{ sx: { width: vocabWidth } }}
          >
            <PageVocabulary
              bookId={bookId}
              currentPage={currentPage}
              totalPages={totalPages}
            />
          </Drawer>
        ) : (
          vocabDrawerOpen && (
            <Box
              sx={{
                position: 'fixed',
                right: 0,
                top: 0,
                bottom: 0,
                width: vocabWidth,
                bgcolor: 'background.paper',
                borderLeft: 1,
                borderColor: 'divider',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              <PageVocabulary
                bookId={bookId}
                currentPage={currentPage}
                totalPages={totalPages}
              />
            </Box>
          )
        )}
      </Box>
    </Box>
  );
}
