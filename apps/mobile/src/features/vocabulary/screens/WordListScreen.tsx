import React, { useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute } from '@react-navigation/native';
import type { Word } from '../../../types';
import type { MainScreenProps } from '../../../navigation/types';
import { useVocabulary } from '../hooks/useVocabulary';
import { WordRow, WORD_ROW_HEIGHT } from '../components/WordRow';
import { colors, typography, spacing } from '../../../theme';

type RouteProps = MainScreenProps<'WordList'>['route'];

const keyExtractor = (item: Word) => String(item.id);

export const WordListScreen = () => {
  const route = useRoute<RouteProps>();
  const { contentId, contentType, title } = route.params;

  const { words, isLoading, error, fetchMore, hasMore, total } = useVocabulary({
    contentId,
    contentType,
  });

  const handleWordPress = useCallback((word: Word) => {
    // TODO: Show word detail modal
    console.log('Word pressed:', word.word);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Word }) => <WordRow word={item} onPress={handleWordPress} />,
    [handleWordPress]
  );

  const renderHeader = () => (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>{title}</Text>
      <Text style={styles.headerSubtitle}>
        {total > 0 ? `${total} words` : 'Loading...'}
      </Text>
    </View>
  );

  const renderEmpty = () => {
    if (isLoading) {
      return (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.light.primary} />
          <Text style={styles.loadingText}>Loading vocabulary...</Text>
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.centerContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      );
    }

    return (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyTitle}>No vocabulary yet</Text>
        <Text style={styles.emptySubtitle}>
          This content hasn't been analyzed yet
        </Text>
      </View>
    );
  };

  const renderFooter = () => {
    if (!hasMore || words.length === 0) return null;
    return (
      <View style={styles.footer}>
        <ActivityIndicator size="small" color={colors.light.primary} />
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlashList
        data={words}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        estimatedItemSize={WORD_ROW_HEIGHT}
        onEndReached={fetchMore}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.light.background,
  },
  header: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.light.border,
  },
  headerTitle: {
    ...typography.h2,
    color: colors.light.text,
  },
  headerSubtitle: {
    ...typography.bodySmall,
    color: colors.light.textSecondary,
    marginTop: spacing.xs,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: 100,
  },
  loadingText: {
    ...typography.body,
    color: colors.light.textSecondary,
    marginTop: spacing.md,
  },
  emptyTitle: {
    ...typography.h3,
    color: colors.light.text,
    textAlign: 'center',
  },
  emptySubtitle: {
    ...typography.body,
    color: colors.light.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  errorText: {
    ...typography.body,
    color: colors.light.error,
    textAlign: 'center',
  },
  footer: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
});
