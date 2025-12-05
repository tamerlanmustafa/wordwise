import { useState } from 'react';
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
  type SelectChangeEvent
} from '@mui/material';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import TranslateIcon from '@mui/icons-material/Translate';
import LoginIcon from '@mui/icons-material/Login';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import { useTheme } from '../contexts/ThemeContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { useTopBarVisibility } from '../contexts/TopBarVisibilityContext';

export default function TopBar() {
  const { mode, toggleTheme } = useTheme();
  const { targetLanguage, setTargetLanguage, availableLanguages } = useLanguage();
  const { user, logout, isAuthenticated } = useAuth();
  const { showTopBar } = useTopBarVisibility();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const location = useLocation();
  const navigate = useNavigate();

  const isHomePage = location.pathname === '/';

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
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
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
          component={Link}
          to="/"
          sx={{
            textDecoration: 'none',
            color: 'primary.main',
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
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
          <Box
            component="form"
            onSubmit={handleSearch}
            sx={{ flexGrow: 1, maxWidth: 500 }}
          >
          <TextField
            size="small"
            fullWidth
            placeholder="Search movies..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end" sx={{ mr: 0.1, borderRadius: 1, }}>
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
                pr: 0.5, // button spacing
              },

              /* smooth placeholder transition */
              '& .MuiInputBase-input::placeholder': {
                fontSize: '0.8rem',
                opacity: 0.7,
                transition: 'opacity 0.25s ease',
              },

              /* fade placeholder ONLY on focus */
              '& .Mui-focused .MuiInputBase-input::placeholder': {
                opacity: 0,
              },

              /* keep input text spacing before button */
              '& .MuiInputBase-input': {
                paddingRight: '6px',
              },
            }}
          />



          </Box>
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
                <MenuItem onClick={handleUserMenuClose}>Account</MenuItem>
                <MenuItem onClick={handleUserMenuClose}>Settings</MenuItem>
                <MenuItem onClick={handleLogout}>Log out</MenuItem>
              </Menu>
            </>
          )}
        </Stack>
      </Toolbar>
    </AppBar>
  );
}
