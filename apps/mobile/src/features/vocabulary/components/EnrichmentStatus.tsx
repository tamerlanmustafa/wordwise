import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useEnrichment } from '../hooks/useEnrichment';
import { colors, typography, spacing } from '../../../theme';

interface EnrichmentStatusProps {
  movieId: number;
  targetLang: string;
}

export const EnrichmentStatus = ({ movieId, targetLang }: EnrichmentStatusProps) => {
  const { status, isStarting, startEnrichment } = useEnrichment({ movieId, targetLang });

  if (status === 'checking') {
    return null;
  }

  if (status === 'not_started' || status === 'error') {
    return (
      <View style={styles.container}>
        <TouchableOpacity
          style={[styles.button, isStarting && styles.buttonDisabled]}
          onPress={startEnrichment}
          disabled={isStarting}
          activeOpacity={0.7}
        >
          <Text style={styles.sparkle}>✦</Text>
          <Text style={styles.buttonText}>
            {isStarting ? 'Starting...' : 'Enrich with sentence examples'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (status === 'enriching') {
    return (
      <View style={styles.container}>
        <View style={styles.enrichingBanner}>
          <ActivityIndicator size="small" color={colors.light.primary} />
          <Text style={styles.enrichingText}>
            Generating sentence examples... This takes 1-2 minutes.
          </Text>
        </View>
      </View>
    );
  }

  if (status === 'ready') {
    return (
      <View style={styles.container}>
        <View style={styles.readyChip}>
          <Text style={styles.checkmark}>✓</Text>
          <Text style={styles.readyText}>Sentence examples ready</Text>
        </View>
      </View>
    );
  }

  return null;
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.light.primary,
    backgroundColor: 'transparent',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  sparkle: {
    fontSize: 14,
    color: colors.light.primary,
    marginRight: 6,
  },
  buttonText: {
    ...typography.caption,
    color: colors.light.primary,
    fontWeight: '500',
  },
  enrichingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e3f2fd',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  enrichingText: {
    ...typography.caption,
    color: colors.light.primary,
    marginLeft: 8,
    flex: 1,
  },
  readyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.light.success,
    backgroundColor: 'transparent',
  },
  checkmark: {
    fontSize: 12,
    color: colors.light.success,
    marginRight: 4,
  },
  readyText: {
    ...typography.caption,
    color: colors.light.success,
    fontWeight: '500',
  },
});
