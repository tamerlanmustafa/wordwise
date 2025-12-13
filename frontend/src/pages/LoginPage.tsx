import { useState } from 'react';
import {
  Container,
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Stack,
  Alert,
  Link as MuiLink,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem
} from '@mui/material';
import { Link } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import type { SelectChangeEvent } from '@mui/material';
import axios from 'axios';

// Supported languages (same as SignUpPage)
const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'tr', name: 'Turkish' },
  { code: 'pl', name: 'Polish' },
  { code: 'nl', name: 'Dutch' },
  { code: 'sv', name: 'Swedish' },
  { code: 'da', name: 'Danish' },
  { code: 'fi', name: 'Finnish' },
  { code: 'no', name: 'Norwegian' },
  { code: 'cs', name: 'Czech' },
  { code: 'el', name: 'Greek' },
  { code: 'he', name: 'Hebrew' },
  { code: 'th', name: 'Thai' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'id', name: 'Indonesian' },
  { code: 'ms', name: 'Malay' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'ro', name: 'Romanian' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'bg', name: 'Bulgarian' },
];

export default function LoginPage() {
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Language selection dialog state
  const [showLanguageDialog, setShowLanguageDialog] = useState(false);
  const [pendingUserData, setPendingUserData] = useState<{ user: any; token: string } | null>(null);
  const [languagePrefs, setLanguagePrefs] = useState({
    nativeLanguage: '',
    learningLanguage: 'en'
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
    setError('');
  };

  const handleLanguageSelectChange = (e: SelectChangeEvent) => {
    setLanguagePrefs({
      ...languagePrefs,
      [e.target.name]: e.target.value
    });
  };

  // Check if user needs language preferences
  const checkAndPromptLanguagePrefs = (userData: any, token: string) => {
    // If user doesn't have native_language set, show the dialog
    if (!userData.native_language) {
      setPendingUserData({ user: userData, token });
      setShowLanguageDialog(true);
      return true;
    }
    return false;
  };

  // Complete login after language selection
  const completeLoginWithLanguages = async () => {
    if (!pendingUserData || !languagePrefs.nativeLanguage) {
      setError('Please select your native language');
      return;
    }

    setLoading(true);
    try {
      const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

      // Update user profile with language preferences
      await axios.patch(
        `${API_BASE_URL}/auth/me`,
        {
          native_language: languagePrefs.nativeLanguage,
          learning_language: languagePrefs.learningLanguage
        },
        {
          headers: { Authorization: `Bearer ${pendingUserData.token}` }
        }
      );

      // Update stored user data with language preferences
      const updatedUser = {
        ...pendingUserData.user,
        native_language: languagePrefs.nativeLanguage,
        learning_language: languagePrefs.learningLanguage
      };

      localStorage.setItem('wordwise_user', JSON.stringify(updatedUser));
      localStorage.setItem('wordwise_token', pendingUserData.token);

      // Redirect to home
      window.location.href = '/wordwise/';
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to update language preferences');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!formData.email || !formData.password) {
      setError('Email and password are required');
      return;
    }

    setLoading(true);

    try {
      const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Invalid email or password');
      }

      const data = await response.json();

      // Check if user needs to set language preferences
      if (checkAndPromptLanguagePrefs(data.user, data.token)) {
        setLoading(false);
        return; // Dialog will handle the rest
      }

      // Store user and token
      localStorage.setItem('wordwise_user', JSON.stringify(data.user));
      localStorage.setItem('wordwise_token', data.token);

      // Redirect to home (use full reload to update auth state)
      window.location.href = '/wordwise/';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Custom Google login handler that checks for language preferences
  const handleGoogleLoginWithLanguageCheck = async (credentialResponse: any) => {
    try {
      const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
      const response = await axios.post(`${API_BASE_URL}/auth/google/login`, {
        id_token: credentialResponse.credential
      });

      const userData = response.data.user;
      const token = response.data.access_token;

      // Check if user needs to set language preferences
      if (checkAndPromptLanguagePrefs(userData, token)) {
        return; // Dialog will handle the rest
      }

      // Complete login normally
      localStorage.setItem('wordwise_user', JSON.stringify(userData));
      localStorage.setItem('wordwise_token', token);
      window.location.href = '/wordwise/';
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Google login failed. Please try again.');
    }
  };

  return (
    <Container maxWidth="sm">
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          py: 4
        }}
      >
        <Paper
          elevation={3}
          sx={{
            p: 4,
            width: '100%',
            borderRadius: 2
          }}
        >
          <Typography variant="h4" fontWeight="bold" gutterBottom align="center">
            Log In to WordWise
          </Typography>
          <Typography variant="body2" color="text.secondary" align="center" sx={{ mb: 3 }}>
            Welcome back! Enter your credentials to continue
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Box
            sx={{
              mb: 2,
              '& > div': {
                width: '100% !important',
              },
              '& iframe': {
                width: '100% !important',
                minHeight: '56px !important', // Match MUI TextField height
              }
            }}
          >
            <GoogleLogin
              onSuccess={handleGoogleLoginWithLanguageCheck}
              onError={() => {
                setError('Google login failed. Please try again.');
              }}
              size="large"
              text="signin_with"
            />
          </Box>

          <Divider sx={{ my: 2 }}>
            <Typography variant="body2" color="text.secondary">
              OR
            </Typography>
          </Divider>

          <form onSubmit={handleSubmit}>
            <Stack spacing={2}>
              <TextField
                label="Email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                fullWidth
                required
                autoComplete="email"
                autoFocus
              />

              <TextField
                label="Password"
                name="password"
                type="password"
                value={formData.password}
                onChange={handleChange}
                fullWidth
                required
                autoComplete="current-password"
              />

              <Button
                type="submit"
                variant="contained"
                size="large"
                fullWidth
                disabled={loading}
                sx={{
                  mt: 2,
                  textTransform: 'none',
                  fontWeight: 600,
                  py: 1.5
                }}
              >
                {loading ? 'Logging in...' : 'Log In'}
              </Button>
            </Stack>
          </form>

          <Box sx={{ mt: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              Don't have an account?{' '}
              <MuiLink
                component={Link}
                to="/signup"
                sx={{
                  fontWeight: 600,
                  textDecoration: 'none',
                  '&:hover': { textDecoration: 'underline' }
                }}
              >
                Sign Up
              </MuiLink>
            </Typography>
          </Box>
        </Paper>
      </Box>

      {/* Language Selection Dialog for existing users */}
      <Dialog
        open={showLanguageDialog}
        maxWidth="sm"
        fullWidth
        disableEscapeKeyDown
      >
        <DialogTitle>
          <Typography variant="h5" fontWeight="bold">
            Set Your Language Preferences
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Help us personalize your learning experience
          </Typography>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ mt: 2 }}>
            <FormControl fullWidth required>
              <InputLabel>What is your native language?</InputLabel>
              <Select
                name="nativeLanguage"
                value={languagePrefs.nativeLanguage}
                label="What is your native language?"
                onChange={handleLanguageSelectChange}
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <MenuItem key={lang.code} value={lang.code}>
                    {lang.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>What language are you learning?</InputLabel>
              <Select
                name="learningLanguage"
                value={languagePrefs.learningLanguage}
                label="What language are you learning?"
                onChange={handleLanguageSelectChange}
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <MenuItem key={lang.code} value={lang.code}>
                    {lang.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {error && (
              <Alert severity="error">
                {error}
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 0 }}>
          <Button
            variant="contained"
            size="large"
            fullWidth
            onClick={completeLoginWithLanguages}
            disabled={loading || !languagePrefs.nativeLanguage}
          >
            {loading ? 'Saving...' : 'Continue'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
