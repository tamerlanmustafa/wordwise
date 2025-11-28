import { useState, useRef, useEffect } from 'react';
import { TextField, Button, Stack, IconButton, Paper, List, ListItem, ListItemButton, ListItemText, ListItemAvatar, Avatar, CircularProgress, ClickAwayListener, Box } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import { useNavigate } from 'react-router-dom';
import { useMovieAutocomplete } from '../hooks/useMovieAutocomplete';

interface MovieSearchBarProps {
  onSearch: (query: string) => void;
  disabled?: boolean;
}

export default function MovieSearchBar({ onSearch, disabled = false }: MovieSearchBarProps) {
  const [query, setQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const navigate = useNavigate();
  const { suggestions, loading } = useMovieAutocomplete(query);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setShowDropdown(suggestions.length > 0 && query.trim().length >= 2 && !disabled);
  }, [suggestions, query, disabled]);

  const handleSearch = () => {
    const trimmedQuery = query.trim();

    if (trimmedQuery.length < 2) {
      return;
    }

    setShowDropdown(false);
    console.log('[SEARCH] Query:', trimmedQuery);
    onSearch(trimmedQuery);
  };

  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleSearch();
    }
  };

  const handleClear = () => {
    setQuery('');
    setShowDropdown(false);
  };

  const handleSelectMovie = (id: number, title: string, year: number | null) => {
    setQuery(title);
    setShowDropdown(false);
    navigate(`/movie/${id}`, {
      state: {
        title,
        year,
        tmdbId: id
      }
    });
  };

  const isSearchDisabled = disabled || query.trim().length < 2;

  return (
    <ClickAwayListener onClickAway={() => setShowDropdown(false)}>
      <Box sx={{ position: 'relative', width: '100%' }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <TextField
            fullWidth
            inputRef={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyPress={handleKeyPress}
            label="Search for a movie"
            placeholder="Type a movie title (e.g., Interstellar)"
            variant="outlined"
            disabled={disabled}
            InputProps={{
              endAdornment: (
                <>
                  {loading && <CircularProgress size={20} sx={{ mr: 1 }} />}
                  {query && !disabled && (
                    <IconButton size="small" onClick={handleClear} edge="end">
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  )}
                </>
              ),
            }}
          />

          <Button
            variant="contained"
            size="large"
            startIcon={<SearchIcon />}
            onClick={handleSearch}
            disabled={isSearchDisabled}
            sx={{
              minWidth: 120,
              height: 56,
              whiteSpace: 'nowrap',
            }}
          >
            Search
          </Button>
        </Stack>

        {showDropdown && (
          <Paper
            elevation={8}
            sx={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 120,
              mt: 1,
              maxHeight: 400,
              overflow: 'auto',
              zIndex: 1000,
              borderRadius: 2
            }}
          >
            <List disablePadding>
              {suggestions.map((movie) => (
                <ListItem key={movie.id} disablePadding>
                  <ListItemButton onClick={() => handleSelectMovie(movie.id, movie.title, movie.year)}>
                    <ListItemAvatar>
                      <Avatar
                        src={movie.poster || undefined}
                        variant="rounded"
                        sx={{ width: 40, height: 60 }}
                      >
                        {!movie.poster && movie.title[0]}
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      primary={movie.title}
                      secondary={movie.year || 'Year unknown'}
                      primaryTypographyProps={{ fontWeight: 500 }}
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          </Paper>
        )}
      </Box>
    </ClickAwayListener>
  );
}
