import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Stack,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Avatar,
  Divider,
  CircularProgress
} from '@mui/material';
import {
  Person as PersonIcon,
  Language as LanguageIcon,
  Save as SaveIcon
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import type { SelectChangeEvent } from '@mui/material';

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

const PROFICIENCY_LEVELS = [
  { code: 'A1', name: 'A1 - Beginner' },
  { code: 'A2', name: 'A2 - Elementary' },
  { code: 'B1', name: 'B1 - Intermediate' },
  { code: 'B2', name: 'B2 - Upper Intermediate' },
  { code: 'C1', name: 'C1 - Advanced' },
  { code: 'C2', name: 'C2 - Proficient' },
];

export default function SettingsPage() {
  const navigate = useNavigate();
  const { user, isAuthenticated, updateUser, refreshUser } = useAuth();

  const [formData, setFormData] = useState({
    username: '',
    nativeLanguage: '',
    learningLanguage: '',
    proficiencyLevel: ''
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, navigate]);

  // Load user data
  useEffect(() => {
    const loadUserData = async () => {
      if (user) {
        // Refresh user data from backend to get latest values
        await refreshUser();
      }
      setInitialLoading(false);
    };
    loadUserData();
  }, []);

  // Update form when user data changes
  useEffect(() => {
    if (user) {
      setFormData({
        username: user.username || '',
        nativeLanguage: user.native_language || '',
        learningLanguage: user.learning_language || 'en',
        proficiencyLevel: user.proficiency_level || 'A1'
      });
    }
  }, [user]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
    setError('');
    setSuccess('');
  };

  const handleSelectChange = (e: SelectChangeEvent) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
    setError('');
    setSuccess('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!formData.username) {
      setError('Username is required');
      return;
    }

    setLoading(true);

    try {
      await updateUser({
        username: formData.username,
        native_language: formData.nativeLanguage,
        learning_language: formData.learningLanguage,
        proficiency_level: formData.proficiencyLevel
      });
      setSuccess('Settings updated successfully!');
    } catch (err: any) {
      const errorMessage = err.response?.data?.detail || err.message || 'Failed to update settings';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (initialLoading) {
    return (
      <Container maxWidth="sm">
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <Container maxWidth="sm">
      <Box sx={{ py: 4 }}>
        <Paper elevation={2} sx={{ p: 4, borderRadius: 2 }}>
          {/* Header */}
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
            <Avatar
              src={user.profile_picture_url}
              sx={{ width: 64, height: 64, mr: 2 }}
            >
              {user.username?.charAt(0).toUpperCase()}
            </Avatar>
            <Box>
              <Typography variant="h5" fontWeight="bold">
                Account Settings
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {user.email}
              </Typography>
            </Box>
          </Box>

          <Divider sx={{ my: 3 }} />

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {success && (
            <Alert severity="success" sx={{ mb: 2 }}>
              {success}
            </Alert>
          )}

          <form onSubmit={handleSubmit}>
            <Stack spacing={3}>
              {/* Profile Section */}
              <Box>
                <Typography variant="subtitle1" fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <PersonIcon sx={{ mr: 1 }} />
                  Profile
                </Typography>
                <TextField
                  fullWidth
                  label="Username"
                  name="username"
                  value={formData.username}
                  onChange={handleChange}
                  variant="outlined"
                />
              </Box>

              <Divider />

              {/* Language Section */}
              <Box>
                <Typography variant="subtitle1" fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <LanguageIcon sx={{ mr: 1 }} />
                  Language Preferences
                </Typography>

                <Stack spacing={2}>
                  <FormControl fullWidth>
                    <InputLabel>Native Language</InputLabel>
                    <Select
                      name="nativeLanguage"
                      value={formData.nativeLanguage}
                      label="Native Language"
                      onChange={handleSelectChange}
                    >
                      {SUPPORTED_LANGUAGES.map((lang) => (
                        <MenuItem key={lang.code} value={lang.code}>
                          {lang.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <FormControl fullWidth>
                    <InputLabel>Learning Language</InputLabel>
                    <Select
                      name="learningLanguage"
                      value={formData.learningLanguage}
                      label="Learning Language"
                      onChange={handleSelectChange}
                    >
                      {SUPPORTED_LANGUAGES.map((lang) => (
                        <MenuItem key={lang.code} value={lang.code}>
                          {lang.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <FormControl fullWidth>
                    <InputLabel>Proficiency Level</InputLabel>
                    <Select
                      name="proficiencyLevel"
                      value={formData.proficiencyLevel}
                      label="Proficiency Level"
                      onChange={handleSelectChange}
                    >
                      {PROFICIENCY_LEVELS.map((level) => (
                        <MenuItem key={level.code} value={level.code}>
                          {level.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Stack>
              </Box>

              <Box sx={{ pt: 2 }}>
                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  fullWidth
                  disabled={loading}
                  startIcon={loading ? <CircularProgress size={20} /> : <SaveIcon />}
                >
                  {loading ? 'Saving...' : 'Save Changes'}
                </Button>
              </Box>
            </Stack>
          </form>
        </Paper>
      </Box>
    </Container>
  );
}
