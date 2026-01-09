import React, { Component, ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, typography, spacing } from '../theme';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log to error tracking service
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);

    // TODO: Send to Sentry
    // Sentry.captureException(error, { extra: { componentStack: errorInfo.componentStack } });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <View style={styles.container}>
          <Text style={styles.emoji}>😕</Text>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>
            We're sorry, but something unexpected happened. Please try again.
          </Text>

          <TouchableOpacity style={styles.button} onPress={this.handleRetry}>
            <Text style={styles.buttonText}>Try Again</Text>
          </TouchableOpacity>

          {__DEV__ && this.state.error && (
            <View style={styles.debugContainer}>
              <Text style={styles.debugTitle}>Debug Info:</Text>
              <Text style={styles.debugText}>{this.state.error.toString()}</Text>
            </View>
          )}
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    backgroundColor: colors.light.background,
  },
  emoji: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  title: {
    ...typography.h2,
    color: colors.light.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  message: {
    ...typography.body,
    color: colors.light.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  button: {
    backgroundColor: colors.light.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: 8,
  },
  buttonText: {
    ...typography.button,
    color: '#fff',
  },
  debugContainer: {
    marginTop: spacing.xl,
    padding: spacing.md,
    backgroundColor: colors.light.surface,
    borderRadius: 8,
    maxWidth: '100%',
  },
  debugTitle: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.light.error,
    marginBottom: spacing.xs,
  },
  debugText: {
    ...typography.caption,
    color: colors.light.textSecondary,
    fontFamily: 'monospace',
  },
});
