import React, { useState, useCallback } from 'react';
import { View, TextInput, StyleSheet, Text, ActivityIndicator } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { MovieSearchResult } from '../../../types';
import type { MainStackParamList } from '../../../navigation/types';
import { useMovieSearch } from '../hooks/useMovieSearch';
import { MovieCard } from '../components/MovieCard';
import { colors, typography, spacing } from '../../../theme';

type NavigationProp = NativeStackNavigationProp<MainStackParamList>;

const keyExtractor = (item: MovieSearchResult) => String(item.id);

export const MovieSearchScreen = () => {
  const [query, setQuery] = useState('');
  const { data, isLoading, error, fetchMore, hasMore } = useMovieSearch(query);
  const navigation = useNavigation<NavigationProp>();

  const handlePress = useCallback(
    (movie: MovieSearchResult) => {
      navigation.navigate('WordList', {
        contentId: movie.id,
        contentType: 'movie',
        title: movie.title,
      });
    },
    [navigation]
  );

  const renderItem = useCallback(
    ({ item }: { item: MovieSearchResult }) => <MovieCard movie={item} onPress={handlePress} />,
    [handlePress]
  );

  const renderEmpty = () => {
    if (isLoading) return null;

    if (error) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      );
    }

    if (query.length < 2) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>Search for Movies</Text>
          <Text style={styles.emptySubtitle}>
            Find movies and learn vocabulary from their scripts
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>No results found</Text>
        <Text style={styles.emptySubtitle}>Try a different search term</Text>
      </View>
    );
  };

  const renderFooter = () => {
    if (!hasMore || data.length === 0) return null;
    return (
      <View style={styles.footer}>
        <ActivityIndicator size="small" color={colors.light.primary} />
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.input}
          placeholder="Search movies..."
          placeholderTextColor={colors.light.textTertiary}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {isLoading && (
          <ActivityIndicator
            size="small"
            color={colors.light.primary}
            style={styles.loadingIndicator}
          />
        )}
      </View>

      <FlashList
        data={data}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        estimatedItemSize={152}
        onEndReached={fetchMore}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        contentContainerStyle={styles.listContent}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.light.background,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.light.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.light.border,
  },
  input: {
    flex: 1,
    height: 44,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.light.surface,
    borderRadius: 10,
    ...typography.body,
    color: colors.light.text,
  },
  loadingIndicator: {
    marginLeft: spacing.sm,
  },
  listContent: {
    paddingBottom: spacing.lg,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: 100,
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
