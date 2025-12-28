import { useState, useRef, useEffect } from 'react';
import { Paper, InputBase, IconButton, Box, List, ListItem, ListItemButton, ListItemText, ListItemAvatar, Avatar, CircularProgress, ClickAwayListener, Typography, Divider } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import HistoryIcon from '@mui/icons-material/History';
import { useNavigate } from 'react-router-dom';
import { useMovieAutocomplete } from '../hooks/useMovieAutocomplete';
import { useRecentSearches } from '../hooks/useRecentSearches';
import { UploadButton } from './UploadButton';

interface HeroSearchBarProps {
  onSearch?: (query: string) => void;
}

export default function HeroSearchBar({ onSearch }: HeroSearchBarProps) {
  const [query, setQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const navigate = useNavigate();
  const { suggestions, loading } = useMovieAutocomplete(query);
  const { recentSearches, addRecentSearch } = useRecentSearches();
  const inputRef = useRef<HTMLInputElement>(null);

  // Show dropdown: either autocomplete results OR recent searches when focused with empty query
  const showRecentSearches = isFocused && query.trim().length < 2 && recentSearches.length > 0;
  const showAutocomplete = suggestions.length > 0 && query.trim().length >= 2;

  useEffect(() => {
    setShowDropdown(showAutocomplete || showRecentSearches);
  }, [showAutocomplete, showRecentSearches]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      setShowDropdown(false);
      if (onSearch) {
        onSearch(query.trim());
      } else {
        navigate(`/search?q=${encodeURIComponent(query.trim())}`);
      }
    }
  };

  const handleSelectMovie = (id: number, title: string, year: number | null, poster?: string | null) => {
    setQuery(title);
    setShowDropdown(false);
    setIsFocused(false);

    // Save to recent searches
    addRecentSearch({ id, title, year, poster: poster || null });

    navigate(`/movie/${id}`, {
      state: {
        title,
        year,
        tmdbId: id
      }
    });
  };

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        py: 8,
        px: 2
      }}
    >
      <ClickAwayListener onClickAway={() => { setShowDropdown(false); setIsFocused(false); }}>
        <Box sx={{ width: '100%', maxWidth: 600, position: 'relative' }}>
          <Paper
            component="form"
            onSubmit={handleSubmit}
            elevation={6}
            sx={{
              p: '4px 8px',
              display: 'flex',
              alignItems: 'center',
              width: '100%',
              borderRadius: 3,
              border: '2px solid',
              borderColor: 'primary.main'
            }}
          >
            <InputBase
              inputRef={inputRef}
              sx={{
                ml: 2,
                flex: 1,
                fontSize: '1.2rem',
                '& input::placeholder': {
                  opacity: 0.7
                }
              }}
              placeholder="Search for a movie to analyze..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setIsFocused(true)}
              inputProps={{ 'aria-label': 'search movies' }}
            />
            {loading && <CircularProgress size={20} sx={{ mr: 1 }} />}
            <IconButton type="submit" sx={{ p: 1.5 }} aria-label="search">
              <SearchIcon fontSize="large" />
            </IconButton>
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
            <UploadButton variant="hero" />
          </Paper>

          {showDropdown && (
            <Paper
              elevation={8}
              sx={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                mt: 1,
                maxHeight: 400,
                overflow: 'auto',
                zIndex: 1000,
                borderRadius: 2
              }}
            >
              {/* Recent Searches */}
              {showRecentSearches && (
                <>
                  <Typography
                    variant="caption"
                    sx={{ px: 2, py: 1, display: 'block', color: 'text.secondary', fontWeight: 500 }}
                  >
                    Recent searches
                  </Typography>
                  <List disablePadding>
                    {recentSearches.map((movie) => (
                      <ListItem key={movie.id} disablePadding>
                        <ListItemButton onClick={() => handleSelectMovie(movie.id, movie.title, movie.year, movie.poster)}>
                          <ListItemAvatar>
                            <HistoryIcon sx={{ color: 'text.secondary', mr: 1 }} />
                          </ListItemAvatar>
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
                </>
              )}

              {/* Autocomplete Results */}
              {showAutocomplete && (
                <List disablePadding>
                  {suggestions.map((movie) => (
                    <ListItem key={movie.id} disablePadding>
                      <ListItemButton onClick={() => handleSelectMovie(movie.id, movie.title, movie.year, movie.poster)}>
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
              )}
            </Paper>
          )}
        </Box>
      </ClickAwayListener>
    </Box>
  );
}
