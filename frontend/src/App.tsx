import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import MovieSearchPage from './pages/MovieSearchPage';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1976d2',
    },
    secondary: {
      main: '#dc004e',
    },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
  },
});

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <MovieSearchPage />
    </ThemeProvider>
  );
}

export default App;
