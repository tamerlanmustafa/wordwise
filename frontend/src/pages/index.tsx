import { useRouter } from 'next/router';
import { Box, Container, Typography, Button, Grid, AppBar, Toolbar } from '@mui/material';
import Card from '@/components/common/Card';

export default function Home() {
  const router = useRouter();

  return (
    <Box>
      {/* Navigation */}
      <AppBar position="static" color="transparent" elevation={0} sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
        <Container maxWidth="lg">
          <Toolbar sx={{ justifyContent: 'space-between', px: { xs: 0 } }}>
            <Typography variant="h5" component="h1" fontWeight="bold" color="primary">
              WordWise
            </Typography>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button variant="outlined" onClick={() => router.push('/auth/login')}>
                Login
              </Button>
              <Button variant="contained" onClick={() => router.push('/auth/register')}>
                Get Started
              </Button>
            </Box>
          </Toolbar>
        </Container>
      </AppBar>

      {/* Hero Section */}
      <Box
        sx={{
          minHeight: 'calc(100vh - 64px)',
          background: 'linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)',
          display: 'flex',
          alignItems: 'center',
          py: 10,
        }}
      >
        <Container maxWidth="lg">
          <Box sx={{ textAlign: 'center', mb: 10 }}>
            <Typography
              variant="h2"
              component="h2"
              gutterBottom
              fontWeight="bold"
              sx={{
                fontSize: { xs: '2.5rem', md: '3rem' },
                color: 'text.primary',
                mb: 3,
              }}
            >
              Learn English Through Movies
            </Typography>
            <Typography
              variant="h6"
              color="text.secondary"
              sx={{
                maxWidth: 'md',
                mx: 'auto',
                mb: 4,
                fontSize: { xs: '1.125rem', md: '1.25rem' },
              }}
            >
              Master vocabulary by analyzing movie scripts. Study words from your favorite films,
              track your progress, and improve your English skills through engaging content.
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Button
                variant="contained"
                size="large"
                onClick={() => router.push('/auth/register')}
                sx={{ px: 4 }}
              >
                Start Learning
              </Button>
              <Button
                variant="outlined"
                size="large"
                onClick={() => router.push('/movies')}
                sx={{ px: 4 }}
              >
                Browse Movies
              </Button>
            </Box>
          </Box>

          {/* Features */}
          <Grid container spacing={4}>
            <Grid item xs={12} md={4}>
              <Card>
                <Box sx={{ textAlign: 'center' }}>
                  <Box
                    sx={{
                      width: 64,
                      height: 64,
                      bgcolor: 'primary.light',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      mx: 'auto',
                      mb: 2,
                    }}
                  >
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" width="32" height="32">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                    </svg>
                  </Box>
                  <Typography variant="h6" component="h3" gutterBottom fontWeight="600">
                    Script Analysis
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Analyze movie scripts to extract and categorize vocabulary by difficulty level.
                  </Typography>
                </Box>
              </Card>
            </Grid>

            <Grid item xs={12} md={4}>
              <Card>
                <Box sx={{ textAlign: 'center' }}>
                  <Box
                    sx={{
                      width: 64,
                      height: 64,
                      bgcolor: 'primary.light',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      mx: 'auto',
                      mb: 2,
                    }}
                  >
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" width="32" height="32">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                    </svg>
                  </Box>
                  <Typography variant="h6" component="h3" gutterBottom fontWeight="600">
                    Personalized Lists
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Create custom word lists: Learn Later, Favorites, and Mastered.
                  </Typography>
                </Box>
              </Card>
            </Grid>

            <Grid item xs={12} md={4}>
              <Card>
                <Box sx={{ textAlign: 'center' }}>
                  <Box
                    sx={{
                      width: 64,
                      height: 64,
                      bgcolor: 'primary.light',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      mx: 'auto',
                      mb: 2,
                    }}
                  >
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" width="32" height="32">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </Box>
                  <Typography variant="h6" component="h3" gutterBottom fontWeight="600">
                    Progress Tracking
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Monitor your learning progress and improve your vocabulary systematically.
                  </Typography>
                </Box>
              </Card>
            </Grid>
          </Grid>
        </Container>
      </Box>
    </Box>
  );
}
