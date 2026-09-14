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
import { useTranslation } from 'react-i18next';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { useThemeStore } from '../../stores/themeStore';
import { showToast } from '../../stores/toastStore';
import { formatAppleFullName } from '../../utils/appleName';
import { getAppLanguage } from '../../i18n';
import { withTap } from '../../utils/feedback';
import { mapAuthUser, readAuthTokens } from '../../services/auth/authUser';
import { readApiError } from '../../services/apiError';
import { credentialProblem } from './credentialForm';

interface Props {
  onLogin: (user: any, token: string, refreshToken: string) => void;
}

export const LoginScreen = ({ onLogin }: Props) => {
  const { t } = useTranslation();
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
        throw new Error(t('auth:error.googleNoUser'));
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
          // Only read on first sign-in (see _create_or_update_user): it seeds
          // the account's language so the welcome email isn't English by
          // default. Ignored for an account that already has one.
          app_language: getAppLanguage(),
        }),
      });

      const data = await backendResponse.json();

      if (!backendResponse.ok) {
        throw new Error(readApiError(data) || t('auth:error.googleLoginFailed'));
      }

      const tokens = readAuthTokens(data);
      if (!tokens) throw new Error(t('auth:error.googleLoginFailed'));
      onLogin(mapAuthUser(data.user), tokens.access, tokens.refresh);
    } catch (err: any) {
      if (err.code === statusCodes.SIGN_IN_CANCELLED) {
        setError(t('auth:error.googleCancelled'));
      } else if (err.code === statusCodes.IN_PROGRESS) {
        setError(t('auth:error.googleInProgress'));
      } else {
        setError(err.message || t('auth:error.googleFailed'));
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
        throw new Error(t('auth:error.appleNoToken'));
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
          app_language: getAppLanguage(),
        }),
      });

      const data = await backendResponse.json();

      if (!backendResponse.ok) {
        throw new Error(readApiError(data) || t('auth:error.appleFailed'));
      }

      const tokens = readAuthTokens(data);
      if (!tokens) throw new Error(t('auth:error.appleFailed'));
      onLogin(mapAuthUser(data.user), tokens.access, tokens.refresh);
    } catch (err: any) {
      // User dismissed the Apple sheet — not an error.
      if (err?.code !== 'ERR_REQUEST_CANCELED') {
        setError(err?.message || t('auth:error.appleFailed'));
      }
    } finally {
      setAppleLoading(false);
    }
  };

  const handleAuth = async () => {
    if (!email || !password || (!isLoginMode && !username)) {
      setError(t('auth:error.fillAllFields'));
      return;
    }

    // Check the rules the server is going to check anyway, before spending a
    // round trip and ~173ms of bcrypt on a password we already know is too
    // short. Only on the way IN to an account — a sign-IN must never reject
    // credentials locally, because the rules have changed over time and an
    // existing user's valid password may not satisfy today's minimum.
    if (!isLoginMode) {
      const problem = credentialProblem({ email, password, username }, t);
      if (problem) {
        setError(problem);
        return;
      }
    }

    setLoading(true);
    setError('');

    try {
      const { config } = await import('../../config/env');
      const endpoint = isLoginMode ? '/auth/login' : '/auth/register';
      const body = isLoginMode
        ? { email: email.trim(), password }
        : {
            email: email.trim(),
            password,
            username: username.trim(),
            // The language this screen is currently rendered in — not a
            // hard-coded 'en'. It is the only chance to get the welcome email
            // right: that mail is sent from the register handler, long before
            // the user could open Settings.
            language_preference: getAppLanguage(),
          };

      const authResponse = await fetch(`${config.API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await authResponse.json();

      if (!authResponse.ok) {
        // `readApiError`, not `data.detail`. A 422 sends an array of objects,
        // which `new Error(detail)` rendered to the user as the literal text
        // "[object Object]" — the response to a mistyped email and to a short
        // password, i.e. the two commonest ways a signup goes wrong.
        throw new Error(readApiError(data) || t('auth:error.authFailed'));
      }

      const tokens = readAuthTokens(data);
      if (!tokens) throw new Error(t('auth:error.authFailed'));
      onLogin(mapAuthUser(data.user), tokens.access, tokens.refresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth:error.generic'));
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
      setError(t('auth:error.emailFirst'));
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
      if (!res.ok) throw new Error(t('auth:error.resetSendFailed'));
      showToast({
        tone: 'success',
        message: t('auth:resetEmailSent', { email: target }),
      });
    } catch (err: any) {
      showToast({ tone: 'error', message: err?.message ?? t('auth:error.resetSendFailed') });
    } finally {
      setForgotLoading(false);
    }
  };

  const isLoading = loading || googleLoading || appleLoading || forgotLoading;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.loginContent}>
        <Text style={styles.logo}>WordWise</Text>
        <Text style={styles.tagline}>{t('auth:tagline')}</Text>

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
                <Text style={styles.googleButtonText}>{t('auth:continueWithGoogle')}</Text>
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
              placeholder={t('auth:field.username')}
              placeholderTextColor={tc.textFaint}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
            />
          )}
          <TextInput
            style={styles.input}
            placeholder={t('auth:field.email')}
            placeholderTextColor={tc.textFaint}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TextInput
            style={styles.input}
            placeholder={t('auth:field.password')}
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
                {forgotLoading ? t('auth:sendingResetLink') : t('auth:forgotPassword')}
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
              <ActivityIndicator color={tc.goldDeep} />
            ) : (
              <Text style={styles.primaryButtonText}>
                {isLoginMode ? t('auth:login') : t('auth:register')}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.switchButton}
            onPress={withTap(() => setIsLoginMode(!isLoginMode))}
          >
            <Text style={styles.switchButtonText}>
              {isLoginMode ? t('auth:switchToRegister') : t('auth:switchToLogin')}
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
  // Gold, not `primary`. The rest of the app moved off the older purple in
  // a68f254 — "a purple Save button on a gold app reads as a different
  // product" — and this screen was missed, which made the very first thing a
  // new user sees the one screen that does not look like WordWise.
  logo: { fontSize: 36, fontWeight: '700', color: tc.goldOnSurface, marginBottom: 8 },
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
  primaryButton: { backgroundColor: tc.gold, paddingVertical: 16, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  buttonDisabled: { opacity: 0.7 },
  // Ink on gold is `goldDeep`, never white — white on this gold measures
  // about 2:1, which is below the floor for body text at any size.
  primaryButtonText: { color: tc.goldDeep, fontSize: 16, fontWeight: '600' },
  forgotButton: { alignSelf: 'flex-end', paddingVertical: 2, paddingHorizontal: 4 },
  forgotButtonText: { color: tc.textSecondary, fontSize: 13.5, fontWeight: '600' },
  switchButton: { alignItems: 'center', paddingVertical: 12 },
  switchButtonText: { color: tc.goldOnSurface, fontSize: 14 },
  loginError: { color: tc.error, fontSize: 14, textAlign: 'center' },
});
