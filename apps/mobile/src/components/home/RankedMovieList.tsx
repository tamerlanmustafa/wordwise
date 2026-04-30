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

  if (movies.length === 0) return (
    <Text style={{ textAlign: 'center', color: colors.textSecondary, fontSize: 13, paddingVertical: 16 }}>
      No classified movies found for this level yet.
    </Text>
  );

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

        const badges: Array<{ label: string; color?: string }> = [];
        if (movie.vote_average > 0) {
          const voteStr = movie.vote_count > 0
            ? `★ ${Number(movie.vote_average).toFixed(1)}  (${formatVoteCount(movie.vote_count)})`
            : `★ ${Number(movie.vote_average).toFixed(1)}`;
          badges.push({ label: voteStr, color: '#F5A623' });
        }
        const cefr = scoreToCefr(movie.difficulty_score);
        if (cefr && movie.difficulty_score != null) {
          badges.push({ label: `${cefr}  ${movie.difficulty_score}%`, color: cefrColors[cefr] });
        }
        const lvl = (userLevel || '').toUpperCase();
        const dist = movie.cefr_distribution;
        const levelCount = dist && lvl ? Number(dist[lvl] || 0) : 0;
        if (levelCount > 0) badges.push({ label: `${levelCount} ${lvl} words` });
        else if (movie.unique_words > 0) badges.push({ label: `${movie.unique_words} words` });

        // Info panel — same content whether backdrop or plain fallback.
        const infoPanel = (
          <>
            <View style={s.overlay} pointerEvents="none" />
            <View style={s.info}>
              <Text style={s.title} numberOfLines={2}>{movie.title}</Text>
              {badges.length > 0 && (
                <View style={s.badgeRow}>
                  {badges.map((b, i) => (
                    <View
                      key={i}
                      style={[s.badge, b.color ? { borderColor: b.color + '88' } : null]}
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
          </>
        );

        return (
          <TouchableOpacity
            key={movieId}
            style={s.card}
            onPress={() => onMoviePress(movie)}
            activeOpacity={0.85}
          >
            {/* Poster — tap to zoom, does NOT open movie */}
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation();
                if (posterUri) setZoomedPoster({ uri: posterUri, title: movie.title });
              }}
              activeOpacity={0.85}
            >
              {posterUri ? (
                <Image source={{ uri: posterUri }} style={s.poster} />
              ) : movie.tmdb_id ? (
                <TmdbPoster tmdbId={movie.tmdb_id} style={s.poster} />
              ) : (
                <View style={[s.poster, s.posterPlaceholder]}>
                  <Text style={{ fontSize: 24 }}>🎬</Text>
                </View>
              )}
            </TouchableOpacity>

            {/* Backdrop card — title + badges over the backdrop image */}
            {backdropUri ? (
              <ImageBackground
                source={{ uri: backdropUri }}
                style={s.backdropCard}
                imageStyle={s.backdropImage}
                resizeMode="cover"
              >
                {infoPanel}
              </ImageBackground>
            ) : (
              <View style={[s.backdropCard, s.backdropFallback]}>
                {infoPanel}
              </View>
            )}
          </TouchableOpacity>
        );
      })}
      {/* Poster lightbox */}
      <Modal visible={!!zoomedPoster} transparent animationType="fade" onRequestClose={() => setZoomedPoster(null)}>
        <TouchableOpacity style={s.lightbox} activeOpacity={1} onPress={() => setZoomedPoster(null)}>
          {zoomedPoster && (
            <Image
              source={{ uri: zoomedPoster.uri.replace('w185', 'w500') }}
              style={s.lightboxImage}
              resizeMode="contain"
            />
          )}
          <TouchableOpacity
            style={s.saveBtn}
            onPress={async (e) => {
              e.stopPropagation();
              if (!zoomedPoster) return;
              try {
                const remote = zoomedPoster.uri.replace('w185', 'original');
                const safeTitle = zoomedPoster.title.replace(/[^\w\-]+/g, '_');
                const localPath = `${FileSystem.cacheDirectory}${safeTitle}_poster.jpg`;
                const { uri } = await FileSystem.downloadAsync(remote, localPath);
                const { status } = await MediaLibrary.requestPermissionsAsync();
                if (status === 'granted') {
                  await MediaLibrary.saveToLibraryAsync(uri);
                  Alert.alert('Saved', 'Poster saved to your Photos.');
                } else {
                  Alert.alert('Permission denied', 'Allow photo access to save the poster.');
                }
              } catch {
                Alert.alert('Download failed', 'Could not save poster.');
              }
            }}
          >
            <Text style={s.saveBtnText}>⬇ Save to photos</Text>
          </TouchableOpacity>
          <Text style={s.lightboxHint}>Tap anywhere to close</Text>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const POSTER_H = 110;

const s = StyleSheet.create({
  list: {
    gap: 2,
    paddingHorizontal: 0,
    paddingVertical: 8,
  },

  // Outer card — wraps both poster and backdrop in one box.
  card: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    backgroundColor: colors.paper,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },

  // Poster — outside the backdrop, slightly taller than the card.
  poster: {
    width: 72,
    height: POSTER_H,
    borderRadius: 8,
    backgroundColor: colors.border,
    flexShrink: 0,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  posterPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Backdrop card — fills remaining width, same height as poster.
  backdropCard: {
    flex: 1,
    height: POSTER_H,
    borderRadius: 10,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  backdropImage: {
    borderRadius: 10,
  },
  backdropFallback: {
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },

  // Dark overlay so text is legible over any backdrop.
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.48)',
  },

  // Info — sits over the overlay, pinned to the bottom of the card.
  info: {
    padding: 10,
    gap: 6,
    zIndex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    lineHeight: 19,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },

  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.9)',
  },

  lightbox: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxImage: {
    width: '80%',
    height: '80%',
  },
  saveBtn: {
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  lightboxHint: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 11,
    marginTop: 12,
  },
});
