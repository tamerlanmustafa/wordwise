/**
 * WatchedPage — the web "Watched Films" list (My Lists → Watched Films).
 * Web parity with the mobile WatchedScreen; populated by "Seen it" on the
 * Home feed rows. Rows are denormalized server-side, so no per-row TMDB calls.
 */

import {
  Container,
  Box,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemAvatar,
  Avatar,
  ListItemText,
  IconButton,
  CircularProgress,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import CloseIcon from '@mui/icons-material/Close';
import MovieIcon from '@mui/icons-material/Movie';
import { useEffect, useState } from 'react';
import { watchedApi, type WatchedMovie } from '../services/watchedApi';

export default function WatchedPage() {
  const navigate = useNavigate();
  // null = still loading; [] = loaded-empty.
  const [movies, setMovies] = useState<WatchedMovie[] | null>(null);

  useEffect(() => {
    watchedApi.listWatched().then(setMovies).catch(() => setMovies([]));
  }, []);

  const remove = async (m: WatchedMovie, e: React.MouseEvent) => {
    e.stopPropagation();
    setMovies((prev) => (prev ? prev.filter((x) => x.tmdb_id !== m.tmdb_id) : prev));
    try {
      await watchedApi.unmarkWatched(m.tmdb_id);
    } catch {
      /* best-effort; the row is already gone locally */
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" fontWeight="bold" gutterBottom sx={{ mb: 3 }}>
        Watched Films
      </Typography>

      {movies === null ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : movies.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
          <MovieIcon sx={{ fontSize: 48, opacity: 0.4 }} />
          <Typography sx={{ mt: 1 }}>No watched films yet</Typography>
          <Typography variant="body2">Use “Seen it” on a Home feed row to add one.</Typography>
        </Box>
      ) : (
        <List sx={{ width: '100%', bgcolor: 'background.paper', borderRadius: 2, boxShadow: 2 }}>
          {movies.map((m) => (
            <ListItem
              key={m.tmdb_id}
              disablePadding
              secondaryAction={
                <IconButton edge="end" aria-label={`Remove ${m.title}`} onClick={(e) => remove(m, e)}>
                  <CloseIcon />
                </IconButton>
              }
            >
              <ListItemButton onClick={() => navigate(`/movie/${m.tmdb_id}`)} sx={{ py: 1.5 }}>
                <ListItemAvatar>
                  <Avatar
                    variant="rounded"
                    src={m.poster_path ? `https://image.tmdb.org/t/p/w185${m.poster_path}` : undefined}
                    sx={{ width: 46, height: 68, mr: 2 }}
                  >
                    🎬
                  </Avatar>
                </ListItemAvatar>
                <ListItemText
                  primary={<Typography fontWeight={600}>{m.title}</Typography>}
                  secondary={m.year ?? undefined}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      )}
    </Container>
  );
}
