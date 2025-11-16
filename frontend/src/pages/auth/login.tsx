import { useState } from 'react';
import Link from 'next/link';
import { Box, Typography, Alert, Divider, Container } from '@mui/material';
import Card from '@/components/common/Card';
import { GoogleOAuthWrapper, GoogleOAuthButton } from '../../components/common/GoogleLoginButton';

export default function LoginPage() {
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');

  const handleGoogleSuccess = (user: any) => {
    setSuccess(`Welcome back, ${user.username}!`);
    setError('');
  };

  const handleGoogleError = (errorMessage: string) => {
    setError(errorMessage);
    setSuccess('');
  };

  return (
    <GoogleOAuthWrapper>
      <Box
        sx={{
          minHeight: '100vh',
          bgcolor: 'background.default',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          py: 6,
          px: 2,
        }}
      >
        <Container maxWidth="sm">
          <Box sx={{ mb: 4, textAlign: 'center' }}>
            <Typography variant="h3" component="h2" gutterBottom fontWeight="bold">
              Sign in to WordWise
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Or{' '}
              <Link href="/auth/register" style={{ color: '#0ea5e9', textDecoration: 'none', fontWeight: 500 }}>
                create a new account
              </Link>
            </Typography>
          </Box>

          {/* Error/Success Messages */}
          {error && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {error}
            </Alert>
          )}
          {success && (
            <Alert severity="success" sx={{ mb: 3 }}>
              {success}
            </Alert>
          )}

          <Card>
            {/* Google Sign-In Button */}
            <GoogleOAuthButton
              mode="login"
              onSuccess={handleGoogleSuccess}
              onError={handleGoogleError}
            />

            {/* Divider */}
            <Divider sx={{ my: 3 }}>
              <Typography variant="body2" color="text.secondary">
                Or continue with email
              </Typography>
            </Divider>

            {/* Traditional email/password login form placeholder */}
            <Box sx={{ textAlign: 'center', py: 2 }}>
              <Typography variant="body2" color="text.secondary">
                Email/password login form coming soon
              </Typography>
            </Box>
          </Card>
        </Container>
      </Box>
    </GoogleOAuthWrapper>
  );
}
