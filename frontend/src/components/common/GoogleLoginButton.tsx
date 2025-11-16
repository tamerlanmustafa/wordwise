/**
 * Google OAuth Login Button Component
 *
 * Displays Google's branded "Sign in with Google" button
 * and handles the OAuth flow.
 */

import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';
import { useRouter } from 'next/router';
import { useState } from 'react';

interface GoogleLoginButtonProps {
  onSuccess?: (user: any) => void;
  onError?: (error: string) => void;
}

export function GoogleLoginButton({ onSuccess, onError }: GoogleLoginButtonProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleSuccess = async (credentialResponse: any) => {
    setIsLoading(true);

    try {
      // Send the Google ID token to your backend
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/google/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id_token: credentialResponse.credential,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Google login failed');
      }

      const data = await response.json();

      // Store the JWT token
      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('user', JSON.stringify(data.user));

      // Call success callback
      if (onSuccess) {
        onSuccess(data.user);
      }

      // Redirect to dashboard
      router.push('/dashboard');

    } catch (error) {
      console.error('Google login error:', error);
      if (onError) {
        onError(error instanceof Error ? error.message : 'Google login failed');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleError = () => {
    console.error('Google login failed');
    if (onError) {
      onError('Google login was unsuccessful');
    }
  };

  return (
    <div className="w-full">
      {isLoading ? (
        <div className="flex justify-center items-center py-3">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
        </div>
      ) : (
        <GoogleLogin
          onSuccess={handleGoogleSuccess}
          onError={handleGoogleError}
          useOneTap
          size="large"
          width="100%"
        />
      )}
    </div>
  );
} 

/**
 * Wrapper component that provides Google OAuth context
 * Use this in your login/signup pages
 */
export function GoogleOAuthWrapper({ children }: { children: React.ReactNode }) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  if (!clientId) {
    console.error('Google Client ID is not configured');
    return <div>Google Sign-In is not configured</div>;
  }

  return (
    <GoogleOAuthProvider clientId={clientId}>
      {children}
    </GoogleOAuthProvider>
  );
}