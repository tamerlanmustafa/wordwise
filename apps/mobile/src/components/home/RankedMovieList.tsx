import React, { useState } from 'react';
import {
  Alert,
  Image,
  ImageBackground,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

function prefetchMovieImages(movie: any) {
  if (movie.poster_path) {
    Image.prefetch(`https://image.tmdb.org/t/p/w500${movie.poster_path}`).catch(() => {});
  }
  if (movie.backdrop_path) {
    Image.prefetch(`https://image.tmdb.org/t/p/w780${movie.backdrop_path}`).catch(() => {});
  }
}

import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { colors, cefrColors } from '../../theme/palette';
import { TmdbPoster } from '../movies/TmdbPoster';
import { formatVoteCount, scoreToCefr } from '../../utils/formatting';

interface Props {
  movies: any[];
  onMoviePress: (movie: any) => void;
  userLevel?: string;
}

export const RankedMovieList = ({ movies, onMoviePress, userLevel }: Props) => {
  const [zoomedPoster, setZoomedPoster] = useState<{ uri: string; title: string } | null>(null);

  if (!movies.length) {
    return (
      <Text style={{ textAlign: 'center', color: colors.textSecondary, fontSize: 13, paddingVertical: 16 }}>
        No classified movies found for this level yet.
      </Text>
    );
  }

  return (
    <View style={s.list}>
      {movies.slice(0, 10).map((movie) => {
        const movieId = movie.id || movie.movie_id;

        const posterUri = movie.poster_path
          ? `https://image.tmdb.org/t/p/w185${movie.poster_path}`
          : movie.poster_url || undefined;

        const backdropUri = movie.backdrop_path
          ? `https://image.tmdb.org/t/p/w780${movie.backdrop_path}`
          : null;

        const rating =
          movie.vote_average > 0
            ? `★ ${Number(movie.vote_average).toFixed(1)}`
            : null;

        const cefr = scoreToCefr(movie.difficulty_score);

        const level =
          cefr && movie.difficulty_score != null
            ? `${cefr} ${movie.difficulty_score}%`
            : null;

        const wordCount =
          movie.unique_words > 0 ? `${movie.unique_words} words` : null;

        return (
          <TouchableOpacity
            key={movieId}
            style={s.card}
            onPress={() => onMoviePress(movie)}
            onPressIn={() => prefetchMovieImages(movie)}
            activeOpacity={0.9}
          >
            {backdropUri ? (
              <ImageBackground
                source={{ uri: backdropUri }}
                style={s.backdrop}
                imageStyle={s.backdropImage}
                resizeMode="cover"
              >
                <View style={s.overlay} />

                <View style={s.row}>
                  {/* Poster (ONLY centered) */}
                  <TouchableOpacity
                    onPress={(e) => {
                      e.stopPropagation();
                      if (posterUri) {
                        setZoomedPoster({ uri: posterUri, title: movie.title });
                      }
                    }}
                    activeOpacity={0.85}
                  >
                    {posterUri ? (
                      <Image source={{ uri: posterUri }} style={s.poster} />
                    ) : movie.tmdb_id ? (
                      <TmdbPoster tmdbId={movie.tmdb_id} style={s.poster} />
                    ) : (
                      <View style={[s.poster, s.posterPlaceholder]}>
                        <Text style={{ fontSize: 22 }}>🎬</Text>
                      </View>
                    )}
                  </TouchableOpacity>

                  {/* Bottom-left stacked metrics */}
                  <View style={s.info}>
                    <Text style={s.title} numberOfLines={2}>
                      {movie.title}
                    </Text>

                    {(rating || level) && (
                      <Text style={s.subText}>
                        {[rating, level].filter(Boolean).join('  •  ')}
                      </Text>
                    )}

                    {wordCount && (
                      <Text style={s.wordText}>{wordCount}</Text>
                    )}
                  </View>
                </View>
              </ImageBackground>
            ) : (
              <View style={[s.backdrop, s.fallback]}>
                <View style={s.row}>
                  <View style={[s.poster, s.posterPlaceholder]}>
                    <Text>🎬</Text>
                  </View>

                  <View style={s.info}>
                    <Text style={s.title}>{movie.title}</Text>
                  </View>
                </View>
              </View>
            )}
          </TouchableOpacity>
        );
      })}

      {/* Lightbox */}
      <Modal
        visible={!!zoomedPoster}
        transparent
        animationType="fade"
        onRequestClose={() => setZoomedPoster(null)}
      >
        <TouchableOpacity
          style={s.lightbox}
          activeOpacity={1}
          onPress={() => setZoomedPoster(null)}
        >
          {zoomedPoster && (
            <Image
              source={{
                uri: zoomedPoster.uri.replace('w185', 'w500'),
              }}
              style={s.lightboxImage}
              resizeMode="contain"
            />
          )}

          <Text style={s.lightboxHint}>Tap anywhere to close</Text>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const CARD_H = 140;
const POSTER_H = 110;

const s = StyleSheet.create({
  list: {
    gap: 8,
    paddingVertical: 8,
  },

  card: {
    borderRadius: 14,
    overflow: 'hidden',

    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },

  backdrop: {
    height: CARD_H,
    justifyContent: 'center',
  },

  backdropImage: {
    borderRadius: 14,
  },

  fallback: {
    backgroundColor: colors.paper,
  },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },

  // 🔥 KEY FIX: poster centered only, text not centered
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingHorizontal: 12,
    gap: 12,
  },

  poster: {
    width: 70,
    height: POSTER_H,
    borderRadius: 8,
    backgroundColor: colors.border,
    alignSelf: 'center', // 👈 ONLY poster is centered vertically
  },

  posterPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  // 🔥 KEY FIX: text bottom-left aligned
  info: {
    flex: 1,
    justifyContent: 'flex-end', // 👈 pushes content to bottom
    alignItems: 'flex-start',
    paddingVertical: 6,
    gap: 4,
  },

  title: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },

  subText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '600',
  },

  wordText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.7)',
  },

  lightbox: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  lightboxImage: {
    width: '85%',
    height: '80%',
  },

  lightboxHint: {
    position: 'absolute',
    bottom: 40,
    color: 'rgba(255,255,255,0.3)',
  },
});