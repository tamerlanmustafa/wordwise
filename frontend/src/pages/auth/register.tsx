import { useState } from 'react';
import { useRouter } from 'next/router';
import { useForm } from 'react-hook-form';
import { useDispatch } from 'react-redux';
import Link from 'next/link';
import { Box, Typography, Alert, Divider, Stack } from '@mui/material';
import Button from '@/components/common/Button';
import Input from '@/components/common/Input';
import Card from '@/components/common/Card';
import { apiService } from '@/services/api';
import { setUser } from '@/store/slices/authSlice';
import { GoogleOAuthWrapper, GoogleOAuthButton } from '@/components/common/GoogleLoginButton';

interface RegisterForm {
  email: string;
  username: string;
  password: string;
  confirmPassword: string;
}

export default function Register() {
  const router = useRouter();
  const dispatch = useDispatch();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { register, handleSubmit, formState: { errors }, watch } = useForm<RegisterForm>();

  const password = watch('password');

  const handleGoogleSuccess = (user: any) => {
    setSuccess(`Welcome, ${user.username}! Your account has been created.`);
    setError('');
    dispatch(setUser(user));
  };

  const handleGoogleError = (errorMessage: string) => {
    setError(errorMessage);
    setSuccess('');
  };

  const onSubmit = async (data: RegisterForm) => {
    try {
      setIsLoading(true);
      setError('');

      const response = await apiService.register({
        email: data.email,
        username: data.username,
        password: data.password,
      });

      // Auto login after registration
      await apiService.login(data.email, data.password);
      const user = await apiService.getCurrentUser();
      dispatch(setUser(user));

      router.push('/movies');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Registration failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <GoogleOAuthWrapper>
      <Box
        sx={{
          minHeight: '100vh',
          background: 'linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          px: 2,
          py: 4,
        }}
      >
        <Card sx={{ width: '100%', maxWidth: 480 }}>
          <Box sx={{ textAlign: 'center', mb: 4 }}>
            <Typography variant="h4" component="h1" gutterBottom fontWeight="bold">
              Create Account
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Start learning with WordWise
            </Typography>
          </Box>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          {success && (
            <Alert severity="success" sx={{ mb: 2 }}>
              {success}
            </Alert>
          )}

          {/* Google Sign-Up Button */}
          <Box sx={{ mb: 3 }}>
            <GoogleOAuthButton
              mode="signup"
              onSuccess={handleGoogleSuccess}
              onError={handleGoogleError}
            />
          </Box>

          {/* Divider */}
          <Divider sx={{ my: 3 }}>
            <Typography variant="body2" color="text.secondary">
              Or sign up with email
            </Typography>
          </Divider>

          <form onSubmit={handleSubmit(onSubmit)}>
            <Stack spacing={3}>
              <Input
                label="Email"
                type="email"
                placeholder="your@email.com"
                {...register('email', {
                  required: 'Email is required',
                  pattern: {
                    value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                    message: 'Invalid email address',
                  },
                })}
                error={errors.email?.message}
              />

              <Input
                label="Username"
                type="text"
                placeholder="johndoe"
                {...register('username', {
                  required: 'Username is required',
                  minLength: {
                    value: 3,
                    message: 'Username must be at least 3 characters',
                  },
                })}
                error={errors.username?.message}
              />

              <Input
                label="Password"
                type="password"
                placeholder="••••••••"
                {...register('password', {
                  required: 'Password is required',
                  minLength: {
                    value: 6,
                    message: 'Password must be at least 6 characters',
                  },
                })}
                error={errors.password?.message}
              />

              <Input
                label="Confirm Password"
                type="password"
                placeholder="••••••••"
                {...register('confirmPassword', {
                  required: 'Please confirm your password',
                  validate: (value) => value === password || 'Passwords do not match',
                })}
                error={errors.confirmPassword?.message}
              />

              <Button type="submit" fullWidth isLoading={isLoading}>
                Create Account
              </Button>
            </Stack>
          </form>

          <Box sx={{ mt: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              Already have an account?{' '}
              <Link href="/auth/login" style={{ color: '#0ea5e9', textDecoration: 'none', fontWeight: 500 }}>
                Login
              </Link>
            </Typography>
          </Box>
        </Card>
      </Box>
    </GoogleOAuthWrapper>
  );
}


