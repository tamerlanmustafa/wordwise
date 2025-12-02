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
import { ThemeProvider } from './contexts/ThemeContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { AuthProvider } from './contexts/AuthContext';
import TopBar from './components/TopBar';
import Breadcrumbs from './components/Breadcrumbs';

// Type declaration for Google OAuth API
declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          prompt?: (momentListener?: any) => void;
        };
      };
    };
  }
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

function App() {
  return (
    <GoogleOAuthProvider
      clientId={GOOGLE_CLIENT_ID}
      onScriptLoadSuccess={() => {
        // Override Google's popup positioning to center it
        if (window.google?.accounts?.id) {
          const originalPrompt = window.google.accounts.id.prompt;
          window.google.accounts.id.prompt = function(momentListener) {
            // Center popup configuration
            const width = 500;
            const height = 600;
            const left = (window.screen.width - width) / 2;
            const top = (window.screen.height - height) / 2;

            // Store original window.open
            const originalOpen = window.open;
            window.open = function(url, target, features) {
              const urlString = typeof url === 'string' ? url : url?.toString() || '';
              if (urlString.includes('accounts.google.com')) {
                const centeredFeatures = `width=${width},height=${height},left=${left},top=${top},toolbar=no,location=no,directories=no,status=no,menubar=no,scrollbars=yes,resizable=yes,centerscreen=yes,chrome=yes`;
                return originalOpen.call(window, url, target, centeredFeatures);
              }
              return originalOpen.call(window, url, target, features);
            };

            return originalPrompt?.call(this, momentListener);
          };
        }
      }}
    >
      <ThemeProvider>
        <LanguageProvider>
          <AuthProvider>
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
                  </Routes>
                </Box>
              </Box>
            </Router>
          </AuthProvider>
        </LanguageProvider>
      </ThemeProvider>
    </GoogleOAuthProvider>
  );
}

export default App;
