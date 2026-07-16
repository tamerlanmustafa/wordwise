import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { useThemeStore } from '../../stores/themeStore';
import { showToast } from '../../stores/toastStore';
import { formatAppleFullName } from '../../utils/appleName';

interface Props {
  onLogin: (user: any, token: string, refreshToken: string) => void;
}

export const LoginScreen = ({ onLogin }: Props) => {
  const tc = useThemeColors();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  // Apple's own availability check (iOS 13+, real device/simulator support).
  // Guideline 4.8: this button must be offered wherever Google Sign-In is.
  const [appleAvailable, setAppleAvailable] = useState(false);
  const resolvedTheme = useThemeStore((s) => s.resolved);
  const [error, setError] = useState('');

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AppleAuthentication.isAvailableAsync()
      .then(setAppleAvailable)
      .catch(() => setAppleAvailable(false));
  }, []);

  const handleGoogleSignIn = async () => {
    setError('');
    setGoogleLoading(true);

    try {
      // Clear any cached Google session first so signIn() always shows the
      // account chooser. Without this the SDK silently reuses the last
      // account, so a user with multiple Google accounts can't switch. No-op
      // (and harmless) when there's no prior session.
      try {
        await GoogleSignin.signOut();
      } catch {}

      const signInResult: any = await GoogleSignin.signIn();

      const userData = signInResult.data?.user || signInResult.user || signInResult.data;
      if (!userData) {
        throw new Error('No user data received from Google');
      }

      let idToken = signInResult.data?.idToken || signInResult.idToken;
      if (!idToken) {
        try {
          const tokens = await GoogleSignin.getTokens();
          idToken = tokens.idToken || tokens.accessToken;
        } catch {}
      }

      const email = userData.email;
      const name = userData.name || userData.givenName;
      const photo = userData.photo;
      const googleId = userData.id;

      const { config } = await import('../../config/env');

      const backendResponse = await fetch(`${config.API_URL}/auth/google/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_token: idToken,
          email,
          name,
          picture: photo,
          google_id: googleId,
        }),
      });

      const data = await backendResponse.json();

      if (!backendResponse.ok) {
        throw new Error(data.detail || 'Google login failed');
      }

      // Map backend user format to app user format
      const user = {
        id: data.user.id,
        email: data.user.email,
        username: data.user.username,
        profile_picture_url: data.user.profile_picture_url || data.user.profilePictureUrl,
        native_language: data.user.native_language || data.user.nativeLanguage || 'en',
        learning_language: data.user.learning_language || data.user.learningLanguage || 'es',
        proficiency_level: data.user.proficiency_level || data.user.proficiencyLevel || 'B1',
        default_tab: (data.user.default_tab || data.user.defaultTab || 'movies') as 'movies' | 'books',
        is_admin: data.user.is_admin || data.user.isAdmin || false,
      };

      onLogin(user, data.access_token || data.token, data.refresh_token);
    } catch (err: any) {
      if (err.code === statusCodes.SIGN_IN_CANCELLED) {
        setError('Sign-in cancelled');
      } else if (err.code === statusCodes.IN_PROGRESS) {
        setError('Sign-in already in progress');
      } else {
        setError(err.message || 'Google sign-in failed');
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    setError('');
    setAppleLoading(true);

    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) {
        throw new Error('No identity token received from Apple');
      }

      // Apple provides the name exactly once (first authorization); forward
      // it so the backend can derive a username. Repeat logins send null.
      const fullName = formatAppleFullName(
        credential.fullName?.givenName,
        credential.fullName?.familyName,
      );

      const { config } = await import('../../config/env');

      const backendResponse = await fetch(`${config.API_URL}/auth/apple/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identity_token: credential.identityToken,
          full_name: fullName,
        }),
      });

      const data = await backendResponse.json();

      if (!backendResponse.ok) {
        throw new Error(data.detail || 'Apple sign-in failed');
      }

      const user = {
        id: data.user.id,
        email: data.user.email,
        username: data.user.username,
        profile_picture_url: data.user.profile_picture_url || null,
        native_language: data.user.native_language || 'en',
        learning_language: data.user.learning_language || 'es',
        proficiency_level: data.user.proficiency_level || 'B1',
        default_tab: (data.user.default_tab || 'movies') as 'movies' | 'books',
        is_admin: data.user.is_admin || false,
      };

      onLogin(user, data.access_token, data.refresh_token);
    } catch (err: any) {
      // User dismissed the Apple sheet — not an error.
      if (err?.code !== 'ERR_REQUEST_CANCELED') {
        setError(err?.message || 'Apple sign-in failed');
      }
    } finally {
      setAppleLoading(false);
    }
  };

  const handleAuth = async () => {
    if (!email || !password || (!isLoginMode && !username)) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { config } = await import('../../config/env');
      const endpoint = isLoginMode ? '/auth/login' : '/auth/register';
      const body = isLoginMode
        ? { email: email.trim(), password }
        : { email: email.trim(), password, username: username.trim(), language_preference: 'en' };

      const authResponse = await fetch(`${config.API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await authResponse.json();

      if (!authResponse.ok) {
        throw new Error(data.detail || 'Authentication failed');
      }

      const user = {
        id: data.user.id,
        email: data.user.email,
        username: data.user.username,
        profile_picture_url: data.user.profilePictureUrl,
        native_language: data.user.nativeLanguage || 'en',
        learning_language: data.user.learningLanguage || 'es',
        proficiency_level: data.user.proficiencyLevel || 'B1',
        default_tab: (data.user.defaultTab || 'movies') as 'movies' | 'books',
        is_admin: data.user.isAdmin,
      };

      onLogin(user, data.token, data.refresh_token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  // Forgot password: reuses the email field above — the backend always
  // answers 202 (no account enumeration), so the confirmation copy is
  // deliberately "if an account exists".
  const handleForgotPassword = async () => {
    const target = email.trim();
    if (!target) {
      setError('Enter your email above first, then tap "Forgot password?"');
      return;
    }
    setError('');
    setForgotLoading(true);
    try {
      const { config } = await import('../../config/env');
      const res = await fetch(`${config.API_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: target }),
      });
      if (!res.ok) throw new Error('Could not send the reset email. Please try again.');
      showToast({
        tone: 'success',
        message: `If an account exists for ${target}, a reset link is on its way.`,
      });
    } catch (err: any) {
      showToast({ tone: 'error', message: err?.message ?? 'Could not send the reset email.' });
    } finally {
      setForgotLoading(false);
    }
  };

  const isLoading = loading || googleLoading || appleLoading || forgotLoading;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.loginContent}>
        <Text style={styles.logo}>WordWise</Text>
        <Text style={styles.tagline}>Learn vocabulary from movies & books</Text>

        <View style={styles.formContainer}>
          <TouchableOpacity
            style={[styles.googleButton, isLoading && styles.buttonDisabled]}
            onPress={handleGoogleSignIn}
            disabled={isLoading}
          >
            {googleLoading ? (
              <ActivityIndicator color={tc.text} />
            ) : (
              <>
                <Text style={styles.googleIcon}>G</Text>
                <Text style={styles.googleButtonText}>Continue with Google</Text>
              </>
            )}
          </TouchableOpacity>

          {/* Sign in with Apple — iOS only; required by Guideline 4.8 because
              Google Sign-In is offered. Apple mandates its own button UI. */}
          {appleAvailable && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={
                resolvedTheme === 'dark'
                  ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                  : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
              }
              cornerRadius={12}
              style={styles.appleButton}
              onPress={isLoading ? () => {} : handleAppleSignIn}
            />
          )}

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          {!isLoginMode && (
            <TextInput
              style={styles.input}
              placeholder="Username"
              placeholderTextColor={tc.textFaint}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
            />
          )}
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={tc.textFaint}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={tc.textFaint}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          {isLoginMode && (
            <TouchableOpacity
              style={styles.forgotButton}
              onPress={handleForgotPassword}
              disabled={isLoading}
              accessibilityRole="button"
            >
              <Text style={styles.forgotButtonText}>
                {forgotLoading ? 'Sending reset link…' : 'Forgot password?'}
              </Text>
            </TouchableOpacity>
          )}

          {error ? <Text style={styles.loginError}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.primaryButton, isLoading && styles.buttonDisabled]}
            onPress={handleAuth}
            disabled={isLoading}
          >
            {loading ? (
              <ActivityIndicator color={tc.textInverse} />
            ) : (
              <Text style={styles.primaryButtonText}>
                {isLoginMode ? 'Login' : 'Register'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.switchButton}
            onPress={() => setIsLoginMode(!isLoginMode)}
          >
            <Text style={styles.switchButtonText}>
              {isLoginMode
                ? "Don't have an account? Register"
                : 'Already have an account? Login'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

// Local theme-aware styles (the shared core/styles sheet is a light-only
// snapshot; the auth screen owns its own themed copy until that sheet is
// migrated). Mirrors the login keys from core/styles.
const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: tc.background },
  loginContent: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  logo: { fontSize: 36, fontWeight: '700', color: tc.primaryOnSurface, marginBottom: 8 },
  tagline: { fontSize: 16, color: tc.textSecondary, marginBottom: 48, textAlign: 'center' },
  formContainer: { width: '100%', gap: 12 },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tc.paper,
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: tc.border,
    gap: 10,
  },
  googleIcon: { fontSize: 18, fontWeight: '700', color: '#4285F4' }, // Google brand blue
  googleButtonText: { fontSize: 16, fontWeight: '500', color: tc.text },
  // Native Apple button draws its own chrome — we only size/space it to
  // line up with the Google button above.
  appleButton: { height: 48, marginTop: 10 },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 8 },
  dividerLine: { flex: 1, height: 1, backgroundColor: tc.border },
  dividerText: { paddingHorizontal: 16, color: tc.textSecondary, fontSize: 14 },
  input: {
    backgroundColor: tc.paper,
    borderWidth: 1,
    borderColor: tc.border,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    color: tc.text,
  },
  primaryButton: { backgroundColor: tc.primary, paddingVertical: 16, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  buttonDisabled: { opacity: 0.7 },
  primaryButtonText: { color: tc.textInverse, fontSize: 16, fontWeight: '600' },
  forgotButton: { alignSelf: 'flex-end', paddingVertical: 2, paddingHorizontal: 4 },
  forgotButtonText: { color: tc.textSecondary, fontSize: 13.5, fontWeight: '600' },
  switchButton: { alignItems: 'center', paddingVertical: 12 },
  switchButtonText: { color: tc.primaryOnSurface, fontSize: 14 },
  loginError: { color: tc.error, fontSize: 14, textAlign: 'center' },
});
