import React from 'react';
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
  if (movies.length === 0) return (
    <Text style={{ textAlign: 'center', color: colors.textSecondary, fontSize: 13, paddingVertical: 16 }}>
      No classified movies found for this level yet.
    </Text>
  );

  return (
    <View>
      {movies.slice(0, 10).map((movie) => {
        const movieId = movie.id || movie.movie_id;
        const posterUri = movie.poster_path
          ? `https://image.tmdb.org/t/p/w185${movie.poster_path}`
          : movie.poster_url || undefined;

        // Build badge data — only include fields that have values.
        const badges: Array<{ label: string; color?: string }> = [];
        if (movie.vote_average > 0) {
          const voteStr = movie.vote_count > 0
            ? `★ ${Number(movie.vote_average).toFixed(1)}  (${formatVoteCount(movie.vote_count)})`
            : `★ ${Number(movie.vote_average).toFixed(1)}`;
          badges.push({ label: voteStr, color: '#F5A623' });
        }
        const cefr = scoreToCefr(movie.difficulty_score);
        if (cefr && movie.difficulty_score != null) {
          badges.push({
            label: `${cefr}  ${movie.difficulty_score}%`,
            color: cefrColors[cefr] || colors.textSecondary,
          });
        }
        const lvl = (userLevel || '').toUpperCase();
        const dist = movie.cefr_distribution;
        const levelCount = dist && lvl ? Number(dist[lvl] || 0) : 0;
        if (levelCount > 0) {
          badges.push({ label: `${levelCount} ${lvl} words` });
        } else if (movie.unique_words > 0) {
          badges.push({ label: `${movie.unique_words} words` });
        }

        return (
          <TouchableOpacity
            key={movieId}
            style={s.row}
            onPress={() => onMoviePress(movie)}
            activeOpacity={0.7}
          >
            {posterUri ? (
              <Image source={{ uri: posterUri }} style={s.poster} />
            ) : movie.tmdb_id ? (
              <TmdbPoster tmdbId={movie.tmdb_id} style={s.poster} />
            ) : (
              <View style={[s.poster, { alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={{ fontSize: 24 }}>🎬</Text>
              </View>
            )}

            <View style={s.info}>
              <Text style={s.title} numberOfLines={2}>{movie.title}</Text>

              {badges.length > 0 && (
                <View style={s.badgeRow}>
                  {badges.map((b, i) => (
                    <View
                      key={i}
                      style={[
                        s.badge,
                        b.color ? { backgroundColor: b.color + '1A', borderColor: b.color + '55' } : null,
                      ]}
                    >
                      <Text
                        style={[s.badgeText, b.color ? { color: b.color } : null]}
                        numberOfLines={1}
                      >
                        {b.label}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 14,
  },
  poster: {
    width: 74,
    height: 110,
    borderRadius: 8,
    backgroundColor: colors.border,
    flexShrink: 0,
  },
  info: {
    flex: 1,
    gap: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    lineHeight: 20,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
  },
});
