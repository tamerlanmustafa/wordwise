import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../../stores/authStore';
import { colors, typography, spacing } from '../../../theme';
import { config } from '../../../config/env';

interface AuthResponse {
  user: {
    id: number;
    email: string;
    username: string;
    profilePictureUrl: string | null;
    nativeLanguage: string | null;
    learningLanguage: string | null;
    proficiencyLevel: string | null;
    defaultTab: string | null;
    isAdmin: boolean;
  };
  token: string;
}

export const LoginScreen = () => {
  const login = useAuthStore((s) => s.login);
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAuth = async () => {
    if (!email || !password || (!isLogin && !username)) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      const endpoint = isLogin ? '/auth/login' : '/auth/register';
      const body = isLogin
        ? { email, password }
        : { email, password, username, language_preference: 'en' };

      const response = await fetch(`${config.API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data: AuthResponse = await response.json();

      if (!response.ok) {
        throw new Error((data as any).detail || 'Authentication failed');
      }

      // Map backend user format to app user format
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

      await login(user, data.token, data.token); // Using same token for both (no separate refresh token from backend)
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.content}>
            <Text style={styles.title}>WordWise</Text>
            <Text style={styles.subtitle}>Learn vocabulary from movies & books</Text>

            <View style={styles.formContainer}>
              {!isLogin && (
                <TextInput
                  style={styles.input}
                  placeholder="Username"
                  placeholderTextColor={colors.light.textSecondary}
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                />
              )}
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor={colors.light.textSecondary}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
              />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor={colors.light.textSecondary}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />

              <TouchableOpacity
                style={[styles.authButton, loading && styles.authButtonDisabled]}
                onPress={handleAuth}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.authButtonText}>
                    {isLogin ? 'Login' : 'Register'}
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.switchButton}
                onPress={() => setIsLogin(!isLogin)}
              >
                <Text style={styles.switchButtonText}>
                  {isLogin
                    ? "Don't have an account? Register"
                    : 'Already have an account? Login'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.light.background,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  title: {
    ...typography.h1,
    color: colors.light.primary,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.light.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  formContainer: {
    width: '100%',
    gap: spacing.md,
  },
  input: {
    backgroundColor: colors.light.surface,
    borderWidth: 1,
    borderColor: colors.light.border,
    borderRadius: 8,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    ...typography.body,
    color: colors.light.text,
  },
  authButton: {
    backgroundColor: colors.light.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  authButtonDisabled: {
    opacity: 0.7,
  },
  authButtonText: {
    ...typography.button,
    color: '#fff',
  },
  switchButton: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  switchButtonText: {
    ...typography.body,
    color: colors.light.primary,
  },
});
