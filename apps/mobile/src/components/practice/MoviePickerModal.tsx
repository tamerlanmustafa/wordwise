/**
 * MoviePickerModal — v0.7.2.
 *
 * Shown when the user taps the "Movie Deep-Dive" tile. Lists the
 * movies in their reel that have at least some progress (any
 * `comprehensibility_percent > 0`), sorted desc so the strongest match
 * is the obvious pick. Tap one → fires `onPick(movieInternalId)` →
 * parent calls `srsApi.startSession({ kind: 'movie_deep_dive',
 * movieId })`.
 *
 * Empty state: when the user has no in-progress reel movies, we render
 * a one-line "no eligible movies yet — finish a quick recall first"
 * explainer instead of a tile list. The Deep-Dive tile would normally
 * be locked at streak < 7 anyway, but this is the defensive fallback.
 *
 * Movie-to-id mapping: the reel response carries `tmdb_id` but not the
 * internal `Movie.id` the SRS engine needs. Today we work around it
 * by resolving via `/movies/ready-to-watch`-style join; for now the
 * modal accepts both ids on each row (the parent will have looked them
 * up before opening the modal).
 */

import { useMemo } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { useTranslation } from 'react-i18next';

const SERIF_FAMILY = 'Source Serif 4';
const MONO_FAMILY = 'JetBrains Mono';

export interface DeepDiveMovieOption {
  /** Internal Movie.id — what `srsApi.startSession` expects. */
  movieId: number;
  title: string;
  posterPath: string | null;
  comprehensibilityPercent: number;
  cefrLevel?: string | null;
}

export interface MoviePickerModalProps {
  visible: boolean;
  options: DeepDiveMovieOption[];
  onPick: (movieId: number) => void;
  onClose: () => void;
}

function tmdb(path: string | null): string | null {
  return path ? `https://image.tmdb.org/t/p/w92${path}` : null;
}

export function MoviePickerModal({
  visible,
  options,
  onPick,
  onClose,
}: MoviePickerModalProps) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  const sorted = useMemo(
    () =>
      [...options].sort(
        (a, b) => b.comprehensibilityPercent - a.comprehensibilityPercent,
      ),
    [options],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={s.overlay} onPress={onClose}>
        {/* Inner pressable that captures taps so they don't bubble to
            the overlay's close handler. */}
        <Pressable style={s.sheet} onPress={() => undefined}>
          <Text style={s.eyebrow}>{t('practice:moviePicker.eyebrow')}</Text>
          <Text style={s.title}>{t('practice:moviePicker.title')}</Text>
          <Text style={s.body}>
            10 cards drawn from the words in this one movie. Comprehension
            % is your current coverage of the film's vocabulary.
          </Text>

          {sorted.length === 0 ? (
            <View style={s.emptyState}>
              <Text style={s.emptyText}>
                No eligible movies yet — finish a few Quick Recalls so the
                deep-dive pool has something to pull from.
              </Text>
            </View>
          ) : (
            <ScrollView style={s.list} contentContainerStyle={{ paddingBottom: 4 }}>
              {sorted.map((m) => {
                const posterUri = tmdb(m.posterPath);
                return (
                  <Pressable
                    key={m.movieId}
                    onPress={() => onPick(m.movieId)}
                    style={({ pressed }) => [s.row, pressed && { opacity: 0.85 }]}
                  >
                    <View style={s.posterWrap}>
                      {posterUri ? (
                        <Image source={{ uri: posterUri }} style={s.poster} resizeMode="cover" />
                      ) : (
                        <View style={[s.poster, { backgroundColor: tc.surface }]} />
                      )}
                    </View>
                    <View style={s.metaCol}>
                      <Text style={s.rowTitle} numberOfLines={1}>
                        {m.title}
                      </Text>
                      <Text style={s.rowSub}>
                        {m.cefrLevel ? `${m.cefrLevel} · ` : ''}
                        <Text style={s.rowPct}>
                          {Math.round(m.comprehensibilityPercent)}%
                        </Text>
                      </Text>
                    </View>
                    <Text style={s.chevron}>›</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          <Pressable
            onPress={onClose}
            style={({ pressed }) => [s.closeBtn, pressed && { opacity: 0.85 }]}
            hitSlop={6}
          >
            <Text style={s.closeBtnText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: tc.background,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      paddingHorizontal: 20,
      paddingTop: 18,
      paddingBottom: 24,
      maxHeight: '80%',
      gap: 6,
    },
    eyebrow: {
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 1.8,
      color: tc.goldOnSurface,
      textTransform: 'uppercase',
    },
    title: {
      fontFamily: SERIF_FAMILY,
      fontSize: 22,
      fontWeight: '700',
      color: tc.text,
      letterSpacing: -0.4,
    },
    body: {
      fontSize: 13,
      lineHeight: 18,
      color: tc.textSecondary,
      marginBottom: 6,
    },
    list: {
      maxHeight: 360,
      borderRadius: 12,
      backgroundColor: tc.paper,
      borderWidth: 1,
      borderColor: tc.border,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: tc.divider,
    },
    posterWrap: {
      width: 42,
      height: 60,
      borderRadius: 4,
      overflow: 'hidden',
      backgroundColor: tc.surface,
    },
    poster: { width: '100%', height: '100%' },
    metaCol: {
      flex: 1,
      minWidth: 0,
    },
    rowTitle: {
      fontFamily: SERIF_FAMILY,
      fontSize: 15,
      fontWeight: '600',
      color: tc.text,
      letterSpacing: -0.2,
    },
    rowSub: {
      marginTop: 2,
      fontSize: 11,
      fontWeight: '700',
      color: tc.textFaint,
    },
    rowPct: {
      fontFamily: MONO_FAMILY,
      fontWeight: '900',
      color: tc.goldOnSurface,
    },
    chevron: {
      fontSize: 18,
      color: tc.textFaint,
    },
    emptyState: {
      paddingVertical: 24,
      paddingHorizontal: 8,
    },
    emptyText: {
      fontSize: 13,
      color: tc.textSecondary,
      textAlign: 'center',
      lineHeight: 19,
    },
    closeBtn: {
      marginTop: 10,
      alignSelf: 'center',
      paddingHorizontal: 22,
      paddingVertical: 10,
    },
    closeBtnText: {
      fontSize: 13,
      fontWeight: '900',
      letterSpacing: 0.4,
      color: tc.textFaint,
      textTransform: 'uppercase',
    },
  });
