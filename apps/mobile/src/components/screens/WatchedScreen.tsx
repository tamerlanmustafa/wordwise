/**
 * WatchedScreen — the user's "Watched Films" list (Profile → My Lists →
 * Watched Films). Populated by swiping movie cards right on Home ("Seen it").
 *
 * Rows are denormalized on the server (title/poster/year), so this renders
 * without per-row TMDB calls. Tapping a row opens the movie; the × removes it
 * from the list (with Undo), which also lets it reappear in the home feed.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { styles } from '../../core/styles';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { watchedApi, type WatchedMovie } from '../../services/api';
import { showToast } from '../../stores/toastStore';
import type { MovieData } from '../../core/types';
import { BACK_ARROW } from '../../i18n/rtl';
import { FilmIcon } from '../ui/icons';
import { useBottomBarInset } from '../../hooks/useBottomBarInset';

interface Props {
  onBack: () => void;
  /** Names where Back lands (e.g. "Profile"). Defaults to a plain "Back". */
  backLabel?: string;
  onMoviePress: (movie: MovieData) => void;
}

const toMovieData = (m: WatchedMovie): MovieData => ({
  id: m.tmdb_id,
  tmdb_id: m.tmdb_id,
  title: m.title,
  poster_path: m.poster_path,
  release_date: m.year ? `${m.year}-01-01` : '',
});

export const WatchedScreen = ({ onBack, backLabel, onMoviePress }: Props) => {
  // The tab bar is an absolute overlay, so every scroller reserves its height
  // itself or its last rows sit behind the floating capsule.
  const barInset = useBottomBarInset();
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  // null = still loading; [] = loaded-empty.
  const [movies, setMovies] = useState<WatchedMovie[] | null>(null);

  useEffect(() => {
    watchedApi.list().then(setMovies).catch(() => setMovies([]));
  }, []);

  const remove = (m: WatchedMovie) => {
    setMovies((prev) => (prev ? prev.filter((x) => x.tmdb_id !== m.tmdb_id) : prev));
    watchedApi.unmarkWatched(m.tmdb_id).catch(() => {});
    showToast({
      message: `Removed “${m.title}” from Watched`,
      actionLabel: 'Undo',
      onAction: () => {
        watchedApi
          .markWatched({ tmdb_id: m.tmdb_id, title: m.title, poster_path: m.poster_path, year: m.year })
          .catch(() => {});
        setMovies((prev) => (prev ? [m, ...prev] : [m]));
      },
    });
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: tc.background }]} edges={['top']}>
      <View style={[styles.detailHeader, { backgroundColor: tc.paper, borderBottomColor: tc.border }]}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={[styles.backButtonText, { color: tc.primary }]}>{BACK_ARROW} {backLabel ?? t('action.back')}</Text>
        </TouchableOpacity>
        <Text style={[styles.detailHeaderTitle, { color: tc.text }]} numberOfLines={1}>{t('movies:watched.title')}</Text>
        <View style={{ width: 60 }} />
      </View>

      {movies === null ? (
        <View style={s.center}>
          <ActivityIndicator color={tc.gold} />
        </View>
      ) : movies.length === 0 ? (
        <View style={s.center}>
          <Ionicons name="film-outline" size={40} color={tc.textFaint} />
          <Text style={s.emptyTitle}>{t('movies:watched.empty')}</Text>
          <Text style={s.emptyBody}>{t('movies:watched.emptyBody')}</Text>
        </View>
      ) : (
        <FlatList
          data={movies}
          keyExtractor={(m) => String(m.tmdb_id)}
          contentContainerStyle={[s.listContent, { paddingBottom: barInset + 24 }]}
          renderItem={({ item }) => (
            <View style={s.row}>
              <TouchableOpacity
                style={s.rowMain}
                activeOpacity={0.8}
                onPress={() => onMoviePress(toMovieData(item))}
              >
                {item.poster_path ? (
                  <Image
                    source={{ uri: `https://image.tmdb.org/t/p/w185${item.poster_path}` }}
                    style={s.poster}
                  />
                ) : (
                  <View style={[s.poster, s.posterFallback]}>
                    <FilmIcon size={26} />
                  </View>
                )}
                <View style={s.meta}>
                  <Text style={s.title} numberOfLines={2}>{item.title}</Text>
                  {item.year ? <Text style={s.year}>{item.year}</Text> : null}
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => remove(item)}
                hitSlop={10}
                style={s.removeBtn}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.title} from Watched`}
              >
                <Ionicons name="close" size={20} color={tc.textFaint} />
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
};

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
    emptyTitle: { fontSize: 16, fontWeight: '800', color: tc.text, marginTop: 6 },
    emptyBody: { fontSize: 13, color: tc.textSecondary, textAlign: 'center' },
    listContent: { padding: 16, gap: 10 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: tc.paper,
      borderWidth: 1,
      borderColor: tc.border,
      borderRadius: 12,
      padding: 10,
    },
    rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
    poster: { width: 46, height: 68, borderRadius: 6, backgroundColor: tc.border },
    posterFallback: { alignItems: 'center', justifyContent: 'center' },
    posterEmoji: { fontSize: 20 },
    meta: { flex: 1, gap: 3 },
    title: { fontSize: 15, fontWeight: '700', color: tc.text },
    year: { fontSize: 12, color: tc.textSecondary },
    removeBtn: { padding: 8 },
  });
