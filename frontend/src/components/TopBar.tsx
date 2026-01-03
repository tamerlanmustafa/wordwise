import { useState, useRef } from 'react';
import {
  AppBar,
  Toolbar,
  Box,
  IconButton,
  Menu,
  MenuItem,
  Typography,
  Stack,
  Avatar,
  Tooltip,
  Select,
  FormControl,
  TextField,
  InputAdornment,
  Button,
  Paper,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemAvatar,
  ClickAwayListener,
  CircularProgress,
  type SelectChangeEvent
} from '@mui/material';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import TranslateIcon from '@mui/icons-material/Translate';
import LoginIcon from '@mui/icons-material/Login';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import HistoryIcon from '@mui/icons-material/History';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { useTheme } from '../contexts/ThemeContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { useTopBarVisibility } from '../contexts/TopBarVisibilityContext';
import { useRecentSearches } from '../hooks/useRecentSearches';
import { useMovieAutocomplete } from '../hooks/useMovieAutocomplete';

export default function TopBar() {
  const { mode, toggleTheme } = useTheme();
  const { targetLanguage, setTargetLanguage, availableLanguages } = useLanguage();
  const { user, logout, isAuthenticated, isAdmin, isViewingAsAdmin, toggleAdminView } = useAuth();
  const { showTopBar } = useTopBarVisibility();
  const { recentSearches, addRecentSearch } = useRecentSearches();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { suggestions, loading } = useMovieAutocomplete(searchQuery);

  const isHomePage = location.pathname === '/';
  const showRecentSearches = showDropdown && searchQuery.trim().length < 2 && recentSearches.length > 0;
  const showAutocomplete = showDropdown && suggestions.length > 0 && searchQuery.trim().length >= 2;

  const handleUserMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleUserMenuClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = () => {
    logout();
    handleUserMenuClose();
  };

  const handleLanguageChange = (event: SelectChangeEvent) => {
    setTargetLanguage(event.target.value);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setShowDropdown(false);
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const handleSelectMovie = (id: number, title: string, year: number | null, poster?: string | null) => {
    setSearchQuery('');
    setShowDropdown(false);
    addRecentSearch({ id, title, year, poster: poster || null });
    navigate(`/movie/${id}`, {
      state: { title, year, tmdbId: id }
    });
  };

  return (
    <AppBar
      position="sticky"
      elevation={0}
      sx={{
        bgcolor: 'background.paper',
        color: 'text.primary',
        top: 0,
        zIndex: 1200,
        transform: showTopBar ? 'translateY(0)' : 'translateY(-60px)',
        transition: 'transform 0.25s cubic-bezier(0.22, 1, 0.36, 1)'
      }}
    >
      <Toolbar sx={{ justifyContent: 'space-between', gap: 2 }}>
        {/* Left: WordWise Logo */}
        <Box
          onClick={() => {
            // Navigate to home with user's default tab preference
            const defaultTab = user?.default_tab === 'books' ? 1 : 0;
            navigate('/', { state: { defaultTab } });
          }}
          sx={{
            textDecoration: 'none',
            color: 'primary.main',
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
            cursor: 'pointer',
            '&:hover': {
              opacity: 0.8
            }
          }}
        >
          <Typography variant="h5" fontWeight="bold">
            WordWise
          </Typography>
        </Box>

        {/* Center: Search Bar (hidden on homepage) */}
        {!isHomePage && (
          <ClickAwayListener onClickAway={() => setShowDropdown(false)}>
            <Box
              component="form"
              onSubmit={handleSearch}
              sx={{ flexGrow: 1, maxWidth: 500, position: 'relative' }}
            >
              <TextField
                size="small"
                fullWidth
                inputRef={searchInputRef}
                placeholder="Search movies..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setShowDropdown(true)}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end" sx={{ mr: 0.1, borderRadius: 1 }}>
                      {loading && <CircularProgress size={16} sx={{ mr: 1 }} />}
                      <Box
                        onClick={searchQuery.trim() ? handleSearch : undefined}
                        sx={{
                          cursor: searchQuery.trim() ? 'pointer' : 'default',
                          color: searchQuery.trim() ? 'primary.contrastText' : 'text.disabled',
                          bgcolor: searchQuery.trim() ? 'primary.main' : 'transparent',
                          fontWeight: 500,
                          fontSize: '0.75rem',
                          px: 1.2,
                          py: 0.2,
                          borderRadius: 8,
                          border: '1px solid',
                          borderColor: searchQuery.trim() ? 'primary.main' : 'divider',
                          transition: 'all 0.2s',
                          '&:hover': searchQuery.trim()
                            ? { bgcolor: 'primary.dark', borderColor: 'primary.dark' }
                            : {}
                        }}
                      >
                        Search
                      </Box>
                    </InputAdornment>
                  ),
                }}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    height: 34,
                    border: 0,
                    borderRadius: 8,
                    pr: 0.5,
                  },
                  '& .MuiInputBase-input::placeholder': {
                    fontSize: '0.8rem',
                    opacity: 0.7,
                    transition: 'opacity 0.25s ease',
                  },
                  '& .Mui-focused .MuiInputBase-input::placeholder': {
                    opacity: 0,
                  },
                  '& .MuiInputBase-input': {
                    paddingRight: '6px',
                  },
                }}
              />

              {/* Dropdown: Recent Searches or Autocomplete */}
              {(showRecentSearches || showAutocomplete) && (
                <Paper
                  elevation={8}
                  sx={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    mt: 0.5,
                    maxHeight: 300,
                    overflow: 'auto',
                    zIndex: 1300,
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
                      <List disablePadding dense>
                        {recentSearches.map((movie) => (
                          <ListItem key={movie.id} disablePadding>
                            <ListItemButton onClick={() => handleSelectMovie(movie.id, movie.title, movie.year, movie.poster)}>
                              <ListItemAvatar sx={{ minWidth: 36 }}>
                                <HistoryIcon sx={{ color: 'text.secondary', fontSize: 18 }} />
                              </ListItemAvatar>
                              <ListItemAvatar sx={{ minWidth: 44 }}>
                                <Avatar
                                  src={movie.poster || undefined}
                                  variant="rounded"
                                  sx={{ width: 32, height: 48 }}
                                >
                                  {!movie.poster && movie.title[0]}
                                </Avatar>
                              </ListItemAvatar>
                              <ListItemText
                                primary={movie.title}
                                secondary={movie.year || 'Year unknown'}
                                primaryTypographyProps={{ fontWeight: 500, fontSize: '0.875rem' }}
                                secondaryTypographyProps={{ fontSize: '0.75rem' }}
                              />
                            </ListItemButton>
                          </ListItem>
                        ))}
                      </List>
                    </>
                  )}

                  {/* Autocomplete Results */}
                  {showAutocomplete && (
                    <List disablePadding dense>
                      {suggestions.map((movie) => (
                        <ListItem key={movie.id} disablePadding>
                          <ListItemButton onClick={() => handleSelectMovie(movie.id, movie.title, movie.year, movie.poster)}>
                            <ListItemAvatar sx={{ minWidth: 44 }}>
                              <Avatar
                                src={movie.poster || undefined}
                                variant="rounded"
                                sx={{ width: 32, height: 48 }}
                              >
                                {!movie.poster && movie.title[0]}
                              </Avatar>
                            </ListItemAvatar>
                            <ListItemText
                              primary={movie.title}
                              secondary={movie.year || 'Year unknown'}
                              primaryTypographyProps={{ fontWeight: 500, fontSize: '0.875rem' }}
                              secondaryTypographyProps={{ fontSize: '0.75rem' }}
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
        )}

        {/* Right: Controls */}
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
          {/* Sign Up / Log In Buttons (shown when NOT authenticated) */}
          {!isAuthenticated && (
            <>
              <Button
                variant="outlined"
                size="small"
                startIcon={<LoginIcon />}
                component={Link}
                to="/login"
                sx={{
                  textTransform: 'none',
                  fontWeight: 600,
                  px: 2,
                  borderRadius: 2
                }}
              >
                Log In
              </Button>
              <Button
                variant="contained"
                size="small"
                startIcon={<PersonAddIcon />}
                component={Link}
                to="/signup"
                sx={{
                  textTransform: 'none',
                  fontWeight: 600,
                  px: 2,
                  borderRadius: 2
                }}
              >
                Sign Up
              </Button>
            </>
          )}

          {/* Language Selector */}
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <Select
              value={targetLanguage}
              onChange={handleLanguageChange}
              displayEmpty
              startAdornment={
                <TranslateIcon sx={{ mr: 0.5, color: 'action.active', fontSize: 20 }} />
              }
              sx={{
                '& .MuiSelect-select': {
                  py: 1,
                  display: 'flex',
                  alignItems: 'center'
                }
              }}
            >
              {availableLanguages.map((lang) => (
                <MenuItem key={lang.code} value={lang.code}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Typography
                      component="span"
                      sx={{
                        fontWeight: 'medium',
                        color: 'primary.main',
                        fontSize: '0.875rem'
                      }}
                    >
                      {lang.code}
                    </Typography>
                    <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>
                      {lang.nativeName}
                    </Typography>
                  </Stack>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Admin Reports Button (visible only to admins) */}
          {isAdmin && (
            <Tooltip title="Admin Reports">
              <IconButton
                component={Link}
                to="/admin/reports"
                color="inherit"
                sx={{
                  color: isViewingAsAdmin ? 'warning.main' : 'action.active',
                  '&:hover': {
                    color: 'warning.main'
                  }
                }}
              >
                <AdminPanelSettingsIcon />
              </IconButton>
            </Tooltip>
          )}

          {/* Theme Toggle */}
          <Tooltip title={mode === 'dark' ? 'Light mode' : 'Dark mode'}>
            <IconButton onClick={toggleTheme} color="inherit">
              {mode === 'dark' ? <Brightness7Icon /> : <Brightness4Icon />}
            </IconButton>
          </Tooltip>

          {/* User Menu (shown when authenticated) */}
          {isAuthenticated && (
            <>
              <Tooltip title={user?.username || 'Account'}>
                <IconButton onClick={handleUserMenuOpen} color="inherit">
                  <Avatar
                    src={user?.profile_picture_url}
                    sx={{ width: 32, height: 32, bgcolor: 'primary.main' }}
                  >
                    {!user?.profile_picture_url && <AccountCircleIcon />}
                  </Avatar>
                </IconButton>
              </Tooltip>

              <Menu
                anchorEl={anchorEl}
                open={Boolean(anchorEl)}
                onClose={handleUserMenuClose}
                anchorOrigin={{
                  vertical: 'bottom',
                  horizontal: 'right',
                }}
                transformOrigin={{
                  vertical: 'top',
                  horizontal: 'right',
                }}
              >
                <MenuItem disabled>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {user?.email}
                  </Typography>
                </MenuItem>
                <MenuItem
                  component={Link}
                  to="/lists"
                  onClick={handleUserMenuClose}
                >
                  Lists
                </MenuItem>
                <MenuItem
                  component={Link}
                  to="/settings"
                  onClick={handleUserMenuClose}
                >
                  Settings
                </MenuItem>
                {isAdmin && (
                  <>
                    <MenuItem
                      component={Link}
                      to="/admin/reports"
                      onClick={handleUserMenuClose}
                    >
                      <AdminPanelSettingsIcon sx={{ mr: 1, fontSize: 20 }} />
                      Admin Reports
                    </MenuItem>
                    <MenuItem onClick={() => { toggleAdminView(); handleUserMenuClose(); }}>
                      {isViewingAsAdmin ? (
                        <>
                          <VisibilityOffIcon sx={{ mr: 1, fontSize: 20 }} />
                          View as User
                        </>
                      ) : (
                        <>
                          <VisibilityIcon sx={{ mr: 1, fontSize: 20 }} />
                          View as Admin
                        </>
                      )}
                    </MenuItem>
                  </>
                )}
                <MenuItem onClick={handleLogout}>Log out</MenuItem>
              </Menu>
            </>
          )}
        </Stack>
      </Toolbar>
    </AppBar>
  );
}
