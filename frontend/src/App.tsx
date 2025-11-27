import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Box } from '@mui/material';
import MovieSearchPage from './pages/MovieSearchPage';
import { ThemeProvider } from './contexts/ThemeContext';
import { LanguageProvider } from './contexts/LanguageContext';
import TopBar from './components/TopBar';

function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <Router>
          <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            <TopBar />
            <Box component="main" sx={{ flexGrow: 1 }}>
              <Routes>
                <Route path="/" element={<MovieSearchPage />} />
              </Routes>
            </Box>
          </Box>
        </Router>
      </LanguageProvider>
    </ThemeProvider>
  );
}

export default App;
