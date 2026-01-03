import { useEffect, useRef, useState, useCallback } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import ePub, { Book, Rendition } from 'epubjs';

interface EPUBReaderProps {
  url: string;
  currentPage: number;
  onPageChange: (page: number, totalPages: number) => void;
  onReady: (totalPages: number) => void;
  fontSize: number;
}

export default function EPUBReader({
  url,
  currentPage,
  onPageChange,
  onReady,
  fontSize
}: EPUBReaderProps) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState('Loading...');
  const [error, setError] = useState<string | null>(null);
  const isInitializedRef = useRef(false);
  const currentPageRef = useRef(currentPage);

  currentPageRef.current = currentPage;

  // Initialize EPUB
  useEffect(() => {
    if (!viewerRef.current || isInitializedRef.current) return;

    const initBook = async () => {
      try {
        setLoading(true);
        setError(null);
        setLoadingStatus('Fetching book...');

        // Fetch EPUB as binary
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();

        // Create book from ArrayBuffer
        const book = ePub(arrayBuffer);
        bookRef.current = book;

        setLoadingStatus('Parsing...');
        await book.ready;

        // Load navigation (optional)
        try {
          await book.loaded.navigation;
        } catch {
          // No TOC is fine
        }

        // Render
        setLoadingStatus('Rendering...');
        const rendition = book.renderTo(viewerRef.current!, {
          width: '100%',
          height: '100%',
          spread: 'none',
          flow: 'paginated'
        });

        renditionRef.current = rendition;

        // Styles
        rendition.themes.fontSize(`${fontSize}%`);
        rendition.themes.default({
          body: {
            'font-family': 'Georgia, serif',
            'line-height': '1.7',
            'padding': '24px',
            'color': '#1a1a1a'
          },
          p: { 'margin-bottom': '1em' }
        });

        await rendition.display();
        isInitializedRef.current = true;
        setLoading(false);

        // Generate locations in background
        try {
          await book.locations.generate(1024);
          const numPages = book.locations.length();
          onReady(numPages);

          rendition.on('relocated', (location: { start: { location: number } }) => {
            const page = location.start.location || 1;
            onPageChange(page, numPages);
          });
        } catch {
          onReady(0);
        }

      } catch (err) {
        console.error('[EPUBReader] Error:', err);
        setError(err instanceof Error ? err.message : 'Failed to load book');
        setLoading(false);
      }
    };

    initBook();

    return () => {
      if (bookRef.current) {
        bookRef.current.destroy();
        bookRef.current = null;
        renditionRef.current = null;
        isInitializedRef.current = false;
      }
    };
  }, [url]);

  // Font size changes
  useEffect(() => {
    if (renditionRef.current) {
      renditionRef.current.themes.fontSize(`${fontSize}%`);
    }
  }, [fontSize]);

  // Page navigation
  useEffect(() => {
    if (!renditionRef.current || !bookRef.current || loading) return;

    const locations = bookRef.current.locations;
    if (locations && locations.length() > 0) {
      const cfi = locations.cfiFromLocation(currentPage);
      if (cfi) {
        renditionRef.current.display(cfi);
      }
    }
  }, [currentPage, loading]);

  // Keyboard navigation
  const goToNextPage = useCallback(() => {
    renditionRef.current?.next();
  }, []);

  const goToPrevPage = useCallback(() => {
    renditionRef.current?.prev();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        goToNextPage();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        goToPrevPage();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToNextPage, goToPrevPage]);

  if (error) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 1,
          p: 3
        }}
      >
        <Typography color="error" variant="body1" fontWeight={500}>
          Failed to load book
        </Typography>
        <Typography color="text.secondary" variant="body2">
          {error}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
      {loading && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'background.paper',
            zIndex: 10,
            gap: 1.5
          }}
        >
          <CircularProgress size={36} />
          <Typography variant="body2" color="text.secondary">
            {loadingStatus}
          </Typography>
        </Box>
      )}
      <Box
        ref={viewerRef}
        sx={{
          width: '100%',
          height: '100%',
          '& iframe': { border: 'none' }
        }}
      />
    </Box>
  );
}
