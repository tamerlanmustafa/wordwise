import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import HomePage from './pages/HomePage';
import SearchPage from './pages/SearchPage';
import MovieDetailPage from './pages/MovieDetailPage';
import BookDetailPage from './pages/BookDetailPage';
import BookSearchPage from './pages/BookSearchPage';
import MovieSearchPage from './pages/MovieSearchPage';
import SignUpPage from './pages/SignUpPage';
import LoginPage from './pages/LoginPage';
import SavedWordsPage from './pages/SavedWordsPage';
import AllListsPage from './pages/AllListsPage';
import SettingsPage from './pages/SettingsPage';
import AdminReportsPage from './pages/AdminReportsPage';
import BookReaderPage from './pages/BookReaderPage';
import PricingPage from './pages/PricingPage';
import PrivacyPage from './pages/PrivacyPage';
import TermsPage from './pages/TermsPage';
import MyMoviesPage from './pages/MyMoviesPage';
import { ThemeProvider } from './contexts/ThemeContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { AuthProvider } from './contexts/AuthContext';
import { TopBarVisibilityProvider } from './contexts/TopBarVisibilityContext';
import { AppShell } from './components/shell/AppShell';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

function App() {
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <ThemeProvider>
        <LanguageProvider>
          <AuthProvider>
            <TopBarVisibilityProvider>
              <Router>
                <Routes>
                  {/* Full-bleed auth pages — no sidebar */}
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/signup" element={<SignUpPage />} />

                  {/* Everything else lives inside the redesigned shell */}
                  <Route element={<AppShell />}>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/my-movies" element={<MyMoviesPage />} />
                    <Route path="/search" element={<SearchPage />} />
                    <Route path="/movie/:id" element={<MovieDetailPage />} />
                    <Route path="/book/:id" element={<BookDetailPage />} />
                    <Route path="/book/:id/read" element={<BookReaderPage />} />
                    <Route path="/books/search" element={<BookSearchPage />} />
                    <Route path="/analyze" element={<MovieSearchPage />} />
                    <Route path="/lists" element={<AllListsPage />} />
                    <Route path="/lists/:listName" element={<SavedWordsPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/admin/reports" element={<AdminReportsPage />} />
                    <Route path="/pricing" element={<PricingPage />} />
                    <Route path="/privacy" element={<PrivacyPage />} />
                    <Route path="/terms" element={<TermsPage />} />
                  </Route>
                </Routes>
              </Router>
            </TopBarVisibilityProvider>
          </AuthProvider>
        </LanguageProvider>
      </ThemeProvider>
    </GoogleOAuthProvider>
  );
}

export default App;
