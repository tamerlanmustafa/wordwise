import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Container,
  Box,
  Typography,
  Grid,
  CircularProgress,
  Alert,
  Paper,
  InputBase,
  IconButton,
  Avatar,
  Chip
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import PersonIcon from '@mui/icons-material/Person';
import { searchBooks, type BookSearchResult } from '../services/bookService';

export default function BookSearchPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const query = searchParams.get('q') || '';

  const [books, setBooks] = useState<BookSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(query);

  useEffect(() => {
    const loadBooks = async () => {
      if (!query) {
        setBooks([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await searchBooks(query, 40);
        setBooks(response.books);
      } catch (err) {
        console.error('Book search failed:', err);
        setError('Failed to search books. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    loadBooks();
  }, [query]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      navigate(`/books/search?q=${encodeURIComponent(searchInput.trim())}`);
    }
  };

  const handleBookClick = (book: BookSearchResult) => {
    navigate(`/book/${book.gutenberg_id}`, {
      state: {
        title: book.title,
        author: book.author,
        gutenbergId: book.gutenberg_id
      }
    });
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* Search Bar */}
      <Paper
        component="form"
        onSubmit={handleSubmit}
        elevation={2}
        sx={{
          p: '4px 8px',
          display: 'flex',
          alignItems: 'center',
          mb: 4,
          borderRadius: 2
        }}
      >
        <MenuBookIcon sx={{ ml: 1, mr: 1, color: 'primary.main' }} />
        <InputBase
          sx={{ ml: 1, flex: 1 }}
          placeholder="Search public domain books..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          inputProps={{ 'aria-label': 'search books' }}
        />
        <IconButton type="submit" sx={{ p: 1 }} aria-label="search">
          <SearchIcon />
        </IconButton>
      </Paper>

      {/* Title */}
      {query && (
        <Typography variant="h5" fontWeight="bold" gutterBottom>
          Search results for "{query}"
        </Typography>
      )}

      {/* Loading */}
      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {/* Error */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* No results */}
      {!loading && !error && query && books.length === 0 && (
        <Alert severity="info">
          No books found for "{query}". Try a different search.
        </Alert>
      )}

      {/* No query */}
      {!loading && !query && (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <MenuBookIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary">
            Enter a search term to find public domain books
          </Typography>
        </Box>
      )}

      {/* Results Grid */}
      {!loading && books.length > 0 && (
        <Grid container spacing={3}>
          {books.map((book) => (
            <Grid item key={book.gutenberg_id} xs={12} sm={6} md={4} lg={3}>
              <Paper
                elevation={2}
                onClick={() => handleBookClick(book)}
                sx={{
                  p: 2,
                  height: '100%',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease-in-out',
                  '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: 6
                  }
                }}
              >
                <Box sx={{ display: 'flex', gap: 2 }}>
                  <Avatar
                    src={book.cover_medium || book.cover_small || undefined}
                    variant="rounded"
                    sx={{
                      width: 60,
                      height: 90,
                      bgcolor: 'primary.light',
                      flexShrink: 0
                    }}
                  >
                    {!book.cover_medium && !book.cover_small && <MenuBookIcon />}
                  </Avatar>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography
                      variant="subtitle1"
                      fontWeight={600}
                      sx={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical'
                      }}
                    >
                      {book.title}
                    </Typography>
                    {book.author && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                        <PersonIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          noWrap
                        >
                          {book.author}
                        </Typography>
                      </Box>
                    )}
                    <Box sx={{ mt: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {book.first_publish_year && (
                        <Chip
                          label={book.first_publish_year}
                          size="small"
                          sx={{ height: 20, fontSize: '0.7rem' }}
                        />
                      )}
                      {book.languages?.[0] && (
                        <Chip
                          label={book.languages[0].toUpperCase()}
                          size="small"
                          variant="outlined"
                          sx={{ height: 20, fontSize: '0.7rem' }}
                        />
                      )}
                    </Box>
                  </Box>
                </Box>
              </Paper>
            </Grid>
          ))}
        </Grid>
      )}
    </Container>
  );
}
