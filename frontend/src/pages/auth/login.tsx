import { useState } from 'react';
import { GoogleOAuthWrapper, GoogleLoginButton } from '../../components/common/GoogleLoginButton';

export default function LoginPage() {
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');

  const handleGoogleSuccess = (user: any) => {
    setSuccess(`Welcome, ${user.username}!`);
    setError('');
  };

  const handleGoogleError = (errorMessage: string) => {
    setError(errorMessage);
    setSuccess('');
  };

  return (
    <GoogleOAuthWrapper>
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div>
            <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
              Sign in to WordWise
            </h2>
          </div>

          {/* Error/Success Messages */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
              {success}
            </div>
          )}

          <div className="mt-8 space-y-6">
            {/* Google Sign-In Button */}
            <GoogleLoginButton
              onSuccess={handleGoogleSuccess}
              onError={handleGoogleError}
            />

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-gray-50 text-gray-500">Or continue with email</span>
              </div>
            </div>

            {/* Traditional email/password login form goes here */}
            <form className="mt-8 space-y-6" action="#" method="POST">
              {/* Your existing login form */}
            </form>
          </div>
        </div>
      </div>
    </GoogleOAuthWrapper>
  );
}