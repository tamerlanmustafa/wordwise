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
  type SelectChangeEvent
} from '@mui/material';
import { Link } from 'react-router-dom';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import TranslateIcon from '@mui/icons-material/Translate';
import { useTheme } from '../contexts/ThemeContext';
import { useLanguage } from '../contexts/LanguageContext';

export default function TopBar() {
  const { mode, toggleTheme } = useTheme();
  const { targetLanguage, setTargetLanguage, availableLanguages } = useLanguage();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const handleUserMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleUserMenuClose = () => {
    setAnchorEl(null);
  };

  const handleLanguageChange = (event: SelectChangeEvent) => {
    setTargetLanguage(event.target.value);
  };

  return (
    <AppBar position="static" elevation={0} sx={{ bgcolor: 'background.paper', color: 'text.primary' }}>
      <Toolbar sx={{ justifyContent: 'space-between' }}>
        {/* Left: WordWise Logo */}
        <Box
          component={Link}
          to="/"
          sx={{
            textDecoration: 'none',
            color: 'primary.main',
            display: 'flex',
            alignItems: 'center',
            '&:hover': {
              opacity: 0.8
            }
          }}
        >
          <Typography variant="h5" fontWeight="bold">
            WordWise
          </Typography>
        </Box>

        {/* Right: Controls */}
        <Stack direction="row" spacing={1} alignItems="center">
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

          {/* User Menu */}
          <Tooltip title="Account">
            <IconButton onClick={handleUserMenuOpen} color="inherit">
              <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main' }}>
                <AccountCircleIcon />
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
            <MenuItem onClick={handleUserMenuClose}>Account</MenuItem>
            <MenuItem onClick={handleUserMenuClose}>Settings</MenuItem>
            <MenuItem onClick={handleUserMenuClose}>Log out</MenuItem>
          </Menu>
        </Stack>
      </Toolbar>
    </AppBar>
  );
}
