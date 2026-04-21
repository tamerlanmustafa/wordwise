import React, { useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, cefrColors } from '../../theme/palette';
import { TmdbPoster } from '../movies/TmdbPoster';
import { formatVoteCount, scoreToCefr } from '../../utils/formatting';

interface Props {
  movies: any[];
  onMoviePress: (movie: any) => void;
  userLevel?: string;
}

export const RankedMovieList = ({ movies, onMoviePress, userLevel }: Props) => {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const OVERVIEW_LIMIT = 100;

  if (movies.length === 0) return (
    <Text style={{ textAlign: 'center', color: colors.textSecondary, fontSize: 13, paddingVertical: 16 }}>
      No classified movies found for this level yet.
    </Text>
  );

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <View>
      {movies.slice(0, 10).map((movie) => {
        const movieId = movie.id || movie.movie_id;
        const posterUri = movie.poster_path
          ? `https://image.tmdb.org/t/p/w185${movie.poster_path}`
          : movie.poster_url || undefined;
        const overview = movie.overview || movie.description || '';
        const isLong = overview.length > OVERVIEW_LIMIT;
        const expanded = expandedIds.has(movieId);
        const displayText = isLong && !expanded
          ? overview.slice(0, OVERVIEW_LIMIT).trimEnd() + '…'
          : overview;

        return (
          <TouchableOpacity
            key={movieId}
            style={rankedStyles.row}
            onPress={() => onMoviePress(movie)}
            activeOpacity={0.7}
          >
            {posterUri ? (
              <Image source={{ uri: posterUri }} style={rankedStyles.poster} />
            ) : movie.tmdb_id ? (
              <TmdbPoster tmdbId={movie.tmdb_id} style={rankedStyles.poster} />
            ) : (
              <View style={[rankedStyles.poster, { alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={{ fontSize: 24 }}>🎬</Text>
              </View>
            )}
            <View style={rankedStyles.info}>
              <View>
                <Text style={rankedStyles.title} numberOfLines={2}>{movie.title}</Text>
                {(movie.vote_average > 0 || movie.difficulty_score != null) && (
                  <Text style={rankedStyles.ratingInline}>
                    {movie.vote_average > 0 ? `★ ${Number(movie.vote_average).toFixed(1)}` : ''}
                    {movie.vote_count > 0 ? `  ·  ${formatVoteCount(movie.vote_count)} votes` : ''}
                    {movie.difficulty_score != null && (
                      <Text>  ·  <Text style={{ color: cefrColors[scoreToCefr(movie.difficulty_score)!] || colors.textSecondary }}>{scoreToCefr(movie.difficulty_score)} ({movie.difficulty_score}%)</Text></Text>
                    )}
                    {(() => {
                      const lvl = (userLevel || '').toUpperCase();
                      const dist = movie.cefr_distribution;
                      const levelCount = dist && lvl ? Number(dist[lvl] || 0) : 0;
                      if (levelCount > 0) {
                        return (
                          <Text style={{ color: colors.textSecondary }}>  ·  {levelCount} {lvl} words</Text>
                        );
                      }
                      if (movie.unique_words > 0) {
                        return (
                          <Text style={{ color: colors.textSecondary }}>  ·  {movie.unique_words} words</Text>
                        );
                      }
                      return null;
                    })()}
                  </Text>
                )}
              </View>
              {overview.length > 0 && (
                <View>
                  <Text style={rankedStyles.overview}>{displayText}</Text>
                  {isLong && (
                    <TouchableOpacity
                      onPress={(e) => { e.stopPropagation(); toggleExpand(movieId); }}
                      hitSlop={8}
                      style={rankedStyles.expandBtn}
                    >
                      <Text style={rankedStyles.expandArrow}>{expanded ? '▲' : '▼'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const rankedStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rank: {
    width: 36,
    fontSize: 22,
    fontWeight: '800',
    color: colors.textSecondary,
    textAlign: 'center',
    marginRight: 12,
  },
  rankTop: { color: colors.primary },
  poster: {
    width: 60,
    height: 90,
    borderRadius: 6,
    backgroundColor: colors.border,
    marginRight: 14,
  },
  info: {
    flex: 1,
    minHeight: 90,
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  ratingInline: {
    fontSize: 12,
    color: '#F5A623',
    fontWeight: '600',
    marginTop: 3,
  },
  overview: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
    marginTop: 6,
  },
  expandBtn: {
    alignSelf: 'flex-start',
    marginTop: 2,
    paddingVertical: 2,
  },
  expandArrow: {
    fontSize: 10,
    color: colors.primary,
  },
});
