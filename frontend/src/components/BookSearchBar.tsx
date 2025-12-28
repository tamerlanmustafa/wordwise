import { useState, useRef, useEffect } from 'react';
import {
  Paper,
  InputBase,
  IconButton,
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemAvatar,
  Avatar,
  CircularProgress,
  ClickAwayListener,
  Typography,
  Divider,
  Chip
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import PersonIcon from '@mui/icons-material/Person';
import { useNavigate } from 'react-router-dom';
import { useBookAutocomplete } from '../hooks/useBookAutocomplete';
import { UploadButton } from './UploadButton';

interface BookSearchBarProps {
  onSearch?: (query: string) => void;
}

export default function BookSearchBar({ onSearch }: BookSearchBarProps) {
  const [query, setQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const navigate = useNavigate();
  const { suggestions, loading } = useBookAutocomplete(query);
  const inputRef = useRef<HTMLInputElement>(null);

  const showAutocomplete = suggestions.length > 0 && query.trim().length >= 2;

  useEffect(() => {
    setShowDropdown(showAutocomplete);
  }, [showAutocomplete]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      setShowDropdown(false);
      if (onSearch) {
        onSearch(query.trim());
      } else {
        navigate(`/books/search?q=${encodeURIComponent(query.trim())}`);
      }
    }
  };

  const handleSelectBook = (gutenbergId: number, title: string, author: string | null) => {
    setQuery(title);
    setShowDropdown(false);

    // Navigate to book detail page with state
    navigate(`/book/${gutenbergId}`, {
      state: {
        title,
        author,
        gutenbergId
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
      <ClickAwayListener onClickAway={() => { setShowDropdown(false); }}>
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
            <MenuBookIcon sx={{ ml: 1, mr: 1, color: 'primary.main' }} />
            <InputBase
              inputRef={inputRef}
              sx={{
                ml: 1,
                flex: 1,
                fontSize: '1.2rem',
                '& input::placeholder': {
                  opacity: 0.7
                }
              }}
              placeholder="Search public domain books..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              inputProps={{ 'aria-label': 'search books' }}
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
              <Typography
                variant="caption"
                sx={{ px: 2, py: 1, display: 'block', color: 'text.secondary', fontWeight: 500 }}
              >
                Public Domain Books
              </Typography>
              <List disablePadding>
                {suggestions.map((book) => (
                  <ListItem key={book.gutenberg_id} disablePadding>
                    <ListItemButton
                      onClick={() => handleSelectBook(book.gutenberg_id, book.title, book.author)}
                    >
                      <ListItemAvatar>
                        <Avatar
                          src={book.cover || undefined}
                          variant="rounded"
                          sx={{ width: 40, height: 60, bgcolor: 'primary.light' }}
                        >
                          {!book.cover && <MenuBookIcon />}
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography fontWeight={500} noWrap sx={{ maxWidth: 300 }}>
                              {book.title}
                            </Typography>
                            {book.year && (
                              <Chip
                                label={book.year}
                                size="small"
                                sx={{ height: 20, fontSize: '0.7rem' }}
                              />
                            )}
                          </Box>
                        }
                        secondary={
                          book.author && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                              <PersonIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                              <Typography variant="body2" color="text.secondary" noWrap>
                                {book.author}
                              </Typography>
                            </Box>
                          )
                        }
                      />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            </Paper>
          )}
        </Box>
      </ClickAwayListener>
    </Box>
  );
}
