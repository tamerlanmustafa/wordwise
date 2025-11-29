import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  Container,
  Box,
  Typography,
  Paper,
  List,
  ListItem,
  Stack,
  Chip,
  CircularProgress,
  Alert,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  IconButton,
  TextField,
  ListSubheader,
  InputAdornment
} from '@mui/material';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import SearchIcon from '@mui/icons-material/Search';
import axios from 'axios';

interface SavedWord {
  id: number;
  word: string;
  movie_id: number | null;
  movie_title: string | null;
  is_learned: boolean;
  created_at: string;
  saved_in_count?: number;
  saved_in_movies?: Array<{ title: string; created_at: string }>;
}

export default function SavedWordsPage() {
  const { listName } = useParams<{ listName: string }>();
  const [words, setWords] = useState<SavedWord[]>([]);
  const [allWords, setAllWords] = useState<SavedWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState('date_desc');
  const [filterMovie, setFilterMovie] = useState<number | 'all'>('all');
  const [movieSearchQuery, setMovieSearchQuery] = useState('');

  const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

  useEffect(() => {
    fetchWords();
  }, [listName, sortBy, filterMovie]);

  const fetchWords = async () => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('wordwise_token');
      const params: any = { sort: sortBy };

      if (filterMovie !== 'all') {
        params.movie_id = filterMovie;
      }

      const response = await axios.get(
        `${API_BASE_URL}/user/words/list/${listName || 'saved'}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          params
        }
      );

      setWords(response.data.words);

      if (filterMovie === 'all') {
        setAllWords(response.data.words);
      }
    } catch (err) {
      setError('Failed to load saved words');
    } finally {
      setLoading(false);
    }
  };

  const allUniqueMovies = useMemo(() => {
    const movieMap = new Map<number, string>();
    allWords.forEach(w => {
      if (w.movie_id && w.movie_title) {
        movieMap.set(w.movie_id, w.movie_title);
      }
    });
    return Array.from(movieMap.entries())
      .map(([id, title]) => ({ id, title }))
      .sort((a, b) => {
        const aLastSaved = Math.max(...allWords.filter(w => w.movie_id === a.id).map(w => new Date(w.created_at).getTime()));
        const bLastSaved = Math.max(...allWords.filter(w => w.movie_id === b.id).map(w => new Date(w.created_at).getTime()));
        return bLastSaved - aLastSaved;
      });
  }, [allWords]);

  const filteredMovies = useMemo(() => {
    if (!movieSearchQuery.trim()) {
      return allUniqueMovies;
    }
    return allUniqueMovies.filter(m =>
      m.title.toLowerCase().includes(movieSearchQuery.toLowerCase())
    );
  }, [allUniqueMovies, movieSearchQuery]);

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h4" fontWeight="bold" gutterBottom>
        {listName === 'learned' ? 'Learned Words' : 'Saved Words'}
      </Typography>

      <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Sort By</InputLabel>
          <Select value={sortBy} onChange={(e) => setSortBy(e.target.value)} label="Sort By">
            <MenuItem value="date_desc">Newest First</MenuItem>
            <MenuItem value="date_asc">Oldest First</MenuItem>
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 300 }}>
          <InputLabel>Filter by Movie</InputLabel>
          <Select
            value={filterMovie}
            onChange={(e) => setFilterMovie(e.target.value as number | 'all')}
            label="Filter by Movie"
            MenuProps={{
              PaperProps: {
                sx: { maxHeight: 400 }
              }
            }}
          >
            <ListSubheader>
              <TextField
                size="small"
                autoFocus
                placeholder="Search movies..."
                fullWidth
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  )
                }}
                value={movieSearchQuery}
                onChange={(e) => setMovieSearchQuery(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                sx={{ mb: 1 }}
              />
            </ListSubheader>
            <MenuItem value="all">All Movies</MenuItem>
            {filteredMovies.length === 0 && movieSearchQuery && (
              <MenuItem disabled sx={{ whiteSpace: 'normal', wordWrap: 'break-word' }}>
                No movies found
              </MenuItem>
            )}
            {filteredMovies.map((movie) => (
              <MenuItem key={movie.id} value={movie.id}>
                {movie.title}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {!loading && !error && words.length === 0 && (
        <Alert severity="info">
          No words saved yet. Start saving words from movie vocabulary pages!
        </Alert>
      )}

      {!loading && words.length > 0 && (
        <Paper elevation={2}>
          <List>
            {words.map((word, index) => (
              <ListItem
                key={word.id}
                sx={{
                  borderBottom: index < words.length - 1 ? '1px solid' : 'none',
                  borderColor: 'divider',
                  py: 2
                }}
              >
                <Stack direction="row" spacing={2} alignItems="center" sx={{ width: '100%' }}>
                  <Box sx={{ flexGrow: 1 }}>
                    <Typography variant="h6" fontWeight={600}>
                      {word.word}
                    </Typography>
                    {word.saved_in_movies && word.saved_in_movies.length > 0 ? (
                      <Box>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                          You saved this word from:
                        </Typography>
                        {word.saved_in_movies.map((m, idx) => (
                          <Typography key={idx} variant="caption" color="text.secondary" display="block">
                            • {m.title} ({new Date(m.created_at).toLocaleDateString()})
                          </Typography>
                        ))}
                      </Box>
                    ) : word.movie_title ? (
                      <Typography variant="body2" color="text.secondary">
                        From: {word.movie_title}
                        <Typography variant="caption" color="text.secondary" display="block">
                          Added: {new Date(word.created_at).toLocaleDateString()}
                        </Typography>
                      </Typography>
                    ) : null}
                  </Box>

                  <Stack direction="row" spacing={1} alignItems="center">
                    {word.is_learned && (
                      <Chip
                        icon={<CheckCircleIcon />}
                        label="Learned"
                        color="success"
                        size="small"
                      />
                    )}
                    {word.saved_in_count && word.saved_in_count > 1 && (
                      <Chip
                        label={`${word.saved_in_count} movies`}
                        size="small"
                        variant="outlined"
                        sx={{ borderColor: 'primary.main', color: 'primary.main' }}
                      />
                    )}
                    <IconButton size="small" color="warning">
                      <BookmarkIcon />
                    </IconButton>
                  </Stack>
                </Stack>
              </ListItem>
            ))}
          </List>
        </Paper>
      )}
    </Container>
  );
}
