import { useEffect, useRef, useState, useCallback } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import ePub, { Book, Rendition } from 'epubjs';

interface EPUBReaderProps {
  url: string;
  currentPage: number;
  onPageChange: (page: number, totalPages: number) => void;
  onReady: (totalPages: number) => void;
  fontSize: number;
  highlightWords?: Map<string, string>; // word -> color
}

export default function EPUBReader({
  url,
  currentPage,
  onPageChange,
  onReady,
  fontSize,
  highlightWords
}: EPUBReaderProps) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState('Initializing...');
  const [error, setError] = useState<string | null>(null);
  const isInitializedRef = useRef(false);
  const currentPageRef = useRef(currentPage);

  // Keep ref updated
  currentPageRef.current = currentPage;

  // Initialize EPUB
  useEffect(() => {
    if (!viewerRef.current || isInitializedRef.current) return;

    const initBook = async () => {
      try {
        setLoading(true);
        setError(null);
        setLoadingStatus('Fetching book...');

        console.log('[EPUBReader] Starting to load:', url);

        // Fetch the EPUB as binary data first
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch EPUB: ${response.status} ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        console.log('[EPUBReader] EPUB fetched, size:', arrayBuffer.byteLength);

        // Create book instance from ArrayBuffer
        const book = ePub(arrayBuffer);
        bookRef.current = book;

        // Wait for book to be ready
        setLoadingStatus('Parsing EPUB...');
        await book.ready;
        console.log('[EPUBReader] Book ready');

        // Get table of contents (optional, don't fail if missing)
        try {
          const navigation = await book.loaded.navigation;
          console.log('[EPUBReader] TOC loaded:', navigation.toc.length, 'items');
        } catch (navErr) {
          console.warn('[EPUBReader] No navigation/TOC:', navErr);
        }

        // Create rendition
        setLoadingStatus('Rendering...');
        const rendition = book.renderTo(viewerRef.current!, {
          width: '100%',
          height: '100%',
          spread: 'none',
          flow: 'paginated'
        });

        renditionRef.current = rendition;

        // Set initial font size
        rendition.themes.fontSize(`${fontSize}%`);

        // Apply default styles
        rendition.themes.default({
          body: {
            'font-family': '"Georgia", serif',
            'line-height': '1.6',
            'padding': '20px'
          },
          p: {
            'margin-bottom': '1em'
          }
        });

        // Display the book first
        setLoadingStatus('Displaying content...');
        await rendition.display();
        console.log('[EPUBReader] Content displayed');

        // Now that content is displayed, hide loading and generate locations in background
        isInitializedRef.current = true;
        setLoading(false);

        // Generate locations for pagination in background (this can be slow)
        console.log('[EPUBReader] Generating locations...');
        try {
          await book.locations.generate(1024); // Use larger chunks for faster generation
          const numPages = book.locations.length();
          console.log('[EPUBReader] Locations generated:', numPages, 'pages');
          onReady(numPages);

          // Handle page changes
          rendition.on('relocated', (location: { start: { percentage: number; location: number } }) => {
            const page = location.start.location || 1;
            onPageChange(page, numPages);
          });
        } catch (locErr) {
          console.warn('[EPUBReader] Failed to generate locations:', locErr);
          // Still usable, just without page numbers
          onReady(0);
        }

      } catch (err) {
        console.error('[EPUBReader] Failed to load EPUB:', err);
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

  // Handle font size changes
  useEffect(() => {
    if (renditionRef.current) {
      renditionRef.current.themes.fontSize(`${fontSize}%`);
    }
  }, [fontSize]);

  // Handle page navigation
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

  // Apply word highlighting (placeholder for future implementation)
  useEffect(() => {
    if (!renditionRef.current || !highlightWords || highlightWords.size === 0) return;
    // Word highlighting will be implemented in a future phase
    // This requires injecting CSS into the EPUB iframe
  }, [highlightWords]);

  // Navigation methods exposed via ref
  const goToNextPage = useCallback(() => {
    if (renditionRef.current) {
      renditionRef.current.next();
    }
  }, []);

  const goToPrevPage = useCallback(() => {
    if (renditionRef.current) {
      renditionRef.current.prev();
    }
  }, []);

  // Keyboard navigation
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
          gap: 2
        }}
      >
        <Typography color="error" variant="h6">
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
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'background.paper',
            zIndex: 10,
            gap: 2
          }}
        >
          <CircularProgress size={48} />
          <Typography color="text.secondary">{loadingStatus}</Typography>
        </Box>
      )}
      <Box
        ref={viewerRef}
        sx={{
          width: '100%',
          height: '100%',
          '& iframe': {
            border: 'none'
          }
        }}
      />
    </Box>
  );
}
