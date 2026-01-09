import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../../stores/authStore';
import { colors, typography, spacing } from '../../../theme';

export const LoginScreen = () => {
  const login = useAuthStore((s) => s.login);

  // Temporary: Skip login for development
  const handleDevLogin = async () => {
    const mockUser = {
      id: 1,
      email: 'dev@wordwise.app',
      username: 'Developer',
      profile_picture_url: null,
      native_language: 'tr',
      learning_language: 'en',
      proficiency_level: 'B1',
      default_tab: 'movies' as const,
      is_admin: false,
    };
    await login(mockUser, 'mock-access-token', 'mock-refresh-token');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>WordWise</Text>
        <Text style={styles.subtitle}>Learn vocabulary from movies & books</Text>

        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.googleButton} onPress={handleDevLogin}>
            <Text style={styles.googleButtonText}>Continue with Google</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.devButton} onPress={handleDevLogin}>
            <Text style={styles.devButtonText}>Skip Login (Dev Mode)</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.light.background,
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
  buttonContainer: {
    width: '100%',
    gap: spacing.md,
  },
  googleButton: {
    backgroundColor: colors.light.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    alignItems: 'center',
  },
  googleButtonText: {
    ...typography.button,
    color: '#fff',
  },
  devButton: {
    backgroundColor: colors.light.surface,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.light.border,
  },
  devButtonText: {
    ...typography.button,
    color: colors.light.textSecondary,
  },
});
