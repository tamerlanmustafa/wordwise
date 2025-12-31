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
  Chip,
  Menu,
  MenuItem,
  ListItemIcon
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import PersonIcon from '@mui/icons-material/Person';
import DownloadIcon from '@mui/icons-material/Download';
import DescriptionIcon from '@mui/icons-material/Description';
import CodeIcon from '@mui/icons-material/Code';
import FindInPageIcon from '@mui/icons-material/FindInPage';
import { useNavigate } from 'react-router-dom';
import { useBookAutocomplete } from '../hooks/useBookAutocomplete';
import { UploadButton } from './UploadButton';
import { useAuth } from '../contexts/AuthContext';

interface BookSearchBarProps {
  onSearch?: (query: string) => void;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function BookSearchBar({ onSearch }: BookSearchBarProps) {
  const [query, setQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [downloadMenuAnchor, setDownloadMenuAnchor] = useState<null | HTMLElement>(null);
  const [selectedBookId, setSelectedBookId] = useState<number | null>(null);
  const navigate = useNavigate();
  const { suggestions, loading } = useBookAutocomplete(query);
  const { isAdmin } = useAuth();
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

  const handleDownloadClick = (e: React.MouseEvent<HTMLElement>, gutenbergId: number) => {
    e.stopPropagation();
    setDownloadMenuAnchor(e.currentTarget);
    setSelectedBookId(gutenbergId);
  };

  const handleDownloadMenuClose = () => {
    setDownloadMenuAnchor(null);
    setSelectedBookId(null);
  };

  const handleAnalyzePages = async () => {
    if (!selectedBookId) return;

    const gutenbergId = selectedBookId;
    handleDownloadMenuClose();
    setDownloading(gutenbergId);

    try {
      const token = localStorage.getItem('wordwise_token');
      const response = await fetch(
        `${API_BASE_URL}/api/books/gutenberg/${gutenbergId}/pages`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Analysis failed' }));
        throw new Error(error.detail || 'Analysis failed');
      }

      const data = await response.json();

      // Display results in console and alert
      console.log('Page Analysis Result:', data);
      alert(
        `Page Analysis for "${data.title}"\n\n` +
        `Method: ${data.method}\n` +
        `Total Pages: ${data.total_pages}\n` +
        `Warnings: ${data.warnings.join(', ') || 'None'}\n\n` +
        `Sample pages:\n${data.sample_pages.map((p: { page_number: number; word_count: number; text_preview: string }) =>
          `Page ${p.page_number}: ${p.word_count} words`
        ).join('\n')}`
      );
    } catch (error) {
      console.error('Page analysis failed:', error);
      alert(error instanceof Error ? error.message : 'Page analysis failed');
    } finally {
      setDownloading(null);
    }
  };

  const handleDownload = async (format: 'txt' | 'epub' | 'html') => {
    if (!selectedBookId) return;

    const gutenbergId = selectedBookId;
    handleDownloadMenuClose();
    setDownloading(gutenbergId);

    try {
      const token = localStorage.getItem('wordwise_token');
      const response = await fetch(
        `${API_BASE_URL}/api/books/gutenberg/${gutenbergId}/download?format=${format}`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Download failed' }));
        throw new Error(error.detail || 'Download failed');
      }

      // Get filename from Content-Disposition header
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `book_${gutenbergId}.${format}`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="(.+)"/);
        if (match) {
          filename = match[1];
        }
      }

      // Create download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Download failed:', error);
      alert(error instanceof Error ? error.message : 'Download failed');
    } finally {
      setDownloading(null);
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
                  <ListItem
                    key={book.gutenberg_id}
                    disablePadding
                    secondaryAction={
                      isAdmin && (
                        <IconButton
                          edge="end"
                          aria-label="download"
                          onClick={(e) => handleDownloadClick(e, book.gutenberg_id)}
                          disabled={downloading === book.gutenberg_id}
                          sx={{ mr: 1 }}
                        >
                          {downloading === book.gutenberg_id ? (
                            <CircularProgress size={20} />
                          ) : (
                            <DownloadIcon />
                          )}
                        </IconButton>
                      )
                    }
                  >
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
                            <Typography fontWeight={500} noWrap sx={{ maxWidth: isAdmin ? 250 : 300 }}>
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

      {/* Download format menu */}
      <Menu
        anchorEl={downloadMenuAnchor}
        open={Boolean(downloadMenuAnchor)}
        onClose={handleDownloadMenuClose}
        onClick={(e) => e.stopPropagation()}
      >
        <MenuItem onClick={() => handleDownload('txt')}>
          <ListItemIcon>
            <DescriptionIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Plain Text (.txt)" secondary="No page numbers" />
        </MenuItem>
        <MenuItem onClick={() => handleDownload('epub')}>
          <ListItemIcon>
            <MenuBookIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="EPUB (.epub)" secondary="May have page markers" />
        </MenuItem>
        <MenuItem onClick={() => handleDownload('html')}>
          <ListItemIcon>
            <CodeIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="HTML (.html)" secondary="May have chapter markers" />
        </MenuItem>
        <Divider />
        <MenuItem onClick={handleAnalyzePages}>
          <ListItemIcon>
            <FindInPageIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Analyze Pages" secondary="Check for page markers" />
        </MenuItem>
      </Menu>
    </Box>
  );
}
