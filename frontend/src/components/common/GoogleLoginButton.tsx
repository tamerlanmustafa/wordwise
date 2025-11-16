/**
 * Google OAuth Button Component
 *
 * Displays Google's branded "Sign in with Google" button
 * and handles the OAuth flow for both login and signup.
 */

import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { Box, CircularProgress } from '@mui/material';
import { apiService } from '@/services/api';
import type { GoogleAuthResponse } from '@/types';

interface GoogleOAuthButtonProps {
  mode: 'login' | 'signup';
  onSuccess?: (user: any) => void;
  onError?: (error: string) => void;
  redirectTo?: string;
}

export function GoogleOAuthButton({
  mode,
  onSuccess,
  onError,
  redirectTo = '/movies'
}: GoogleOAuthButtonProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleSuccess = async (credentialResponse: any) => {
    setIsLoading(true);

    try {
      const idToken = credentialResponse.credential;
      let data: GoogleAuthResponse;

      // Call the appropriate endpoint based on mode
      if (mode === 'signup') {
        data = await apiService.googleSignup(idToken);
      } else {
        data = await apiService.googleLogin(idToken);
      }

      // Store user data in localStorage
      localStorage.setItem('user', JSON.stringify(data.user));

      // Call success callback
      if (onSuccess) {
        onSuccess(data.user);
      }

      // Redirect to specified page
      router.push(redirectTo);

    } catch (error: any) {
      console.error(`Google ${mode} error:`, error);
      const errorMessage = error.response?.data?.detail ||
                          error.message ||
                          `Google ${mode} failed`;
      if (onError) {
        onError(errorMessage);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleError = () => {
    console.error(`Google ${mode} failed`);
    if (onError) {
      onError(`Google ${mode} was unsuccessful`);
    }
  };

  const buttonText = mode === 'signup' ? 'signup_with' : 'signin_with';

  return (
    <Box sx={{ width: '100%' }}>
      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 1.5 }}>
          <CircularProgress size={24} />
        </Box>
      ) : (
        <GoogleLogin
          onSuccess={handleGoogleSuccess}
          onError={handleGoogleError}
          useOneTap={mode === 'login'}
          size="large"
          width={300}
          text={buttonText}
        />
      )}
    </Box>
  );
}

/**
 * Legacy component for backward compatibility
 * @deprecated Use GoogleOAuthButton with mode="login" instead
 */
export function GoogleLoginButton(props: Omit<GoogleOAuthButtonProps, 'mode'>) {
  return <GoogleOAuthButton {...props} mode="login" />;
} 

/**
 * Wrapper component that provides Google OAuth context
 * Use this in your login/signup pages
 */
export function GoogleOAuthWrapper({ children }: { children: React.ReactNode }) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  if (!clientId) {
    console.error('Google Client ID is not configured');
    return <Box sx={{ p: 2, textAlign: 'center', color: 'error.main' }}>Google Sign-In is not configured</Box>;
  }

 

  return (
    <GoogleOAuthProvider clientId={clientId}>
      {children}
    </GoogleOAuthProvider>
  );
}