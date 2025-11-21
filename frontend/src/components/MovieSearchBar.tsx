import { useState } from 'react';
import { TextField, Button, Stack, IconButton } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';

interface MovieSearchBarProps {
  onSearch: (query: string) => void;
  disabled?: boolean;
}

export default function MovieSearchBar({ onSearch, disabled = false }: MovieSearchBarProps) {
  const [query, setQuery] = useState('');

  const handleSearch = () => {
    const trimmedQuery = query.trim();

    if (trimmedQuery.length < 2) {
      return; // Don't search if less than 2 characters
    }

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
  };

  const isSearchDisabled = disabled || query.trim().length < 2;

  return (
    <Stack direction="row" spacing={2} alignItems="center">
      <TextField
        fullWidth
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyPress={handleKeyPress}
        label="Search for a movie"
        placeholder="Type a movie title (e.g., Interstellar)"
        variant="outlined"
        disabled={disabled}
        InputProps={{
          endAdornment: query && !disabled && (
            <IconButton size="small" onClick={handleClear} edge="end">
              <ClearIcon fontSize="small" />
            </IconButton>
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
          height: 56, // Match TextField height
          whiteSpace: 'nowrap',
        }}
      >
        Search
      </Button>
    </Stack>
  );
}
