import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Box } from '@mui/material';
import { GoogleOAuthProvider } from '@react-oauth/google';
import HomePage from './pages/HomePage';
import SearchPage from './pages/SearchPage';
import MovieDetailPage from './pages/MovieDetailPage';
import MovieSearchPage from './pages/MovieSearchPage';
import SignUpPage from './pages/SignUpPage';
import LoginPage from './pages/LoginPage';
import SavedWordsPage from './pages/SavedWordsPage';
import AllListsPage from './pages/AllListsPage';
import SettingsPage from './pages/SettingsPage';
import { ThemeProvider } from './contexts/ThemeContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { AuthProvider } from './contexts/AuthContext';
import { TopBarVisibilityProvider } from './contexts/TopBarVisibilityContext';
import TopBar from './components/TopBar';
import Breadcrumbs from './components/Breadcrumbs';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
// APP
function App() {
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <ThemeProvider>
        <LanguageProvider>
          <AuthProvider>
            <TopBarVisibilityProvider>
              <Router basename="/wordwise/">
                <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
                  <TopBar />
                  <Box component="main" sx={{ flexGrow: 1 }}>
                    <Breadcrumbs />
                    <Routes>
                      <Route path="/" element={<HomePage />} />
                      <Route path="/search" element={<SearchPage />} />
                      <Route path="/movie/:id" element={<MovieDetailPage />} />
                      <Route path="/analyze" element={<MovieSearchPage />} />
                      <Route path="/signup" element={<SignUpPage />} />
                      <Route path="/login" element={<LoginPage />} />
                      <Route path="/lists" element={<AllListsPage />} />
                      <Route path="/lists/:listName" element={<SavedWordsPage />} />
                      <Route path="/settings" element={<SettingsPage />} />
                    </Routes>
                  </Box>
                </Box>
              </Router>
            </TopBarVisibilityProvider>
          </AuthProvider>
        </LanguageProvider>
      </ThemeProvider>
    </GoogleOAuthProvider>
  );
}

export default App;
