import React, { memo } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import type { MovieSearchResult } from '../../../types';
import { colors, typography, spacing, shadows } from '../../../theme';

interface MovieCardProps {
  movie: MovieSearchResult;
  onPress: (movie: MovieSearchResult) => void;
}

const POSTER_WIDTH = 80;
const POSTER_HEIGHT = 120;
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w200';

export const MovieCard = memo(({ movie, onPress }: MovieCardProps) => {
  const posterUri = movie.poster ? `${TMDB_IMAGE_BASE}${movie.poster}` : null;

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => onPress(movie)}
      activeOpacity={0.7}
    >
      {posterUri ? (
        <Image source={{ uri: posterUri }} style={styles.poster} resizeMode="cover" />
      ) : (
        <View style={[styles.poster, styles.placeholderPoster]}>
          <Text style={styles.placeholderText}>No Image</Text>
        </View>
      )}

      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>
          {movie.title}
        </Text>
        {movie.year && <Text style={styles.year}>{movie.year}</Text>}
        {movie.overview && (
          <Text style={styles.overview} numberOfLines={2}>
            {movie.overview}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
});

MovieCard.displayName = 'MovieCard';

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    padding: spacing.md,
    backgroundColor: colors.light.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.light.border,
  },
  poster: {
    width: POSTER_WIDTH,
    height: POSTER_HEIGHT,
    borderRadius: 6,
    backgroundColor: colors.light.surface,
  },
  placeholderPoster: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    ...typography.caption,
    color: colors.light.textTertiary,
  },
  info: {
    flex: 1,
    marginLeft: spacing.md,
    justifyContent: 'center',
  },
  title: {
    ...typography.body,
    fontWeight: '600',
    color: colors.light.text,
  },
  year: {
    ...typography.caption,
    color: colors.light.textSecondary,
    marginTop: 2,
  },
  overview: {
    ...typography.bodySmall,
    color: colors.light.textSecondary,
    marginTop: spacing.xs,
  },
});
