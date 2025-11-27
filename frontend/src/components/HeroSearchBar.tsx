import { useState } from 'react';
import { Paper, InputBase, IconButton, Box } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useNavigate } from 'react-router-dom';

interface HeroSearchBarProps {
  onSearch?: (query: string) => void;
}

export default function HeroSearchBar({ onSearch }: HeroSearchBarProps) {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      if (onSearch) {
        onSearch(query.trim());
      } else {
        // Navigate to search page with query
        navigate(`/search?q=${encodeURIComponent(query.trim())}`);
      }
    }
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
      <Paper
        component="form"
        onSubmit={handleSubmit}
        elevation={6}
        sx={{
          p: '4px 8px',
          display: 'flex',
          alignItems: 'center',
          width: '100%',
          maxWidth: 600,
          borderRadius: 3,
          border: '2px solid',
          borderColor: 'primary.main'
        }}
      >
        <InputBase
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
          inputProps={{ 'aria-label': 'search movies' }}
        />
        <IconButton type="submit" sx={{ p: 1.5 }} aria-label="search">
          <SearchIcon fontSize="large" />
        </IconButton>
      </Paper>
    </Box>
  );
}
