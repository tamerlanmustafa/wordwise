import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Typography,
  Chip,
  Paper
} from '@mui/material';
import MovieIcon from '@mui/icons-material/Movie';
import type { MovieSearchResult } from '../services/scriptService';

interface MovieSelectionListProps {
  movies: MovieSearchResult[];
  onSelect: (movie: MovieSearchResult) => void;
  loading?: boolean;
}

export default function MovieSelectionList({ movies, onSelect, loading = false }: MovieSelectionListProps) {
  if (movies.length === 0) {
    return (
      <Paper elevation={2} sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="body1" color="text.secondary">
          No movies found. Try a different search term.
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper elevation={2} sx={{ mb: 3 }}>
      <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="h6" fontWeight="bold">
          Select a Movie ({movies.length} results)
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Click on a movie to analyze its script
        </Typography>
      </Box>

      <List sx={{ maxHeight: '400px', overflow: 'auto' }}>
        {movies.map((movie, index) => (
          <ListItem
            key={`${movie.id}-${index}`}
            disablePadding
            sx={{
              borderBottom: index < movies.length - 1 ? '1px solid' : 'none',
              borderColor: 'divider'
            }}
          >
            <ListItemButton
              onClick={() => onSelect(movie)}
              disabled={loading}
              sx={{
                py: 2,
                '&:hover': {
                  backgroundColor: 'action.hover',
                },
              }}
            >
              <MovieIcon sx={{ mr: 2, color: 'primary.main' }} />
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', flexDirection: 'row', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography variant="body1" fontWeight="medium" component="span">
                      {String(movie.title || 'Unknown')}
                    </Typography>
                    {movie.year && String(movie.year) && (
                      <Chip
                        label={String(movie.year)}
                        size="small"
                        sx={{
                          backgroundColor: 'primary.main',
                          color: 'white',
                          fontWeight: 'bold',
                          fontSize: '0.75rem'
                        }}
                      />
                    )}
                  </Box>
                }
                secondary={
                  <span>
                    {movie.subtitle && String(movie.subtitle) && (
                      <span style={{ display: 'block', marginTop: '4px', fontSize: '0.875rem', color: 'rgba(0, 0, 0, 0.6)' }}>
                        {String(movie.subtitle)}
                      </span>
                    )}
                    <span style={{ display: 'block', marginTop: '4px', fontSize: '0.75rem', color: 'rgba(0, 0, 0, 0.6)' }}>
                      {movie.author && String(movie.author) && (
                        <span>
                          <strong>Writer:</strong> {String(movie.author)}
                        </span>
                      )}
                      {movie.genre && String(movie.genre) && (
                        <span>
                          {movie.author && ' • '}
                          <strong>Genre:</strong> {String(movie.genre)}
                        </span>
                      )}
                    </span>
                  </span>
                }
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Paper>
  );
}
