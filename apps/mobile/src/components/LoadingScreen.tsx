import React from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { colors, typography } from '../theme';

interface LoadingScreenProps {
  message?: string;
}

export const LoadingScreen = ({ message }: LoadingScreenProps) => (
  <View style={styles.container}>
    <ActivityIndicator size="large" color={colors.light.primary} />
    {message && <Text style={styles.message}>{message}</Text>}
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.light.background,
  },
  message: {
    ...typography.body,
    color: colors.light.textSecondary,
    marginTop: 16,
  },
});
