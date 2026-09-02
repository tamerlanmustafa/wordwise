/**
 * SavedMoviesScreen — the user's saved reel, reached from the Profile sheet.
 *
 * This is what's left of the old My Movies tab after the Explore word feed
 * took position 2 in the bottom bar. The tab's chrome went with it — stat
 * strip, CEFR filter chips, sort pill and the sort/filter store are all
 * gone — because a list reached from a menu doesn't need a control surface
 * that assumed a permanent home. What remains is the part that would
 * otherwise have been orphaned: seeing what you've added, and opening one.
 *
 * Rows are the same `MovieRow` the tab used, and tapping still hands off to
 * MoviePreviewHub via the shared `MoviePreviewPayload`. Ordering is the
 * reel's own (most recently added first), so there's nothing to configure.
 */

import { useEffect, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../theme/tokens';
import { useReelStore } from '../stores/reelStore';
import type { ReelTile } from '../services/api';
import { MovieRow } from './myMovies/MovieRow';
import { ReadyToWatchShelf } from './journey/ReadyToWatchShelf';
import { OfflineBanner } from './common/OfflineBanner';
import { EmptyState } from './common/EmptyState';
import type { MoviePreviewPayload, NodeLevel } from './journey/sharedTypes';
import { BACK_ARROW } from '../i18n/rtl';
import { useBottomBarInset } from '../hooks/useBottomBarInset';

interface Props {
  onBack: () => void;
  /** Names where Back lands (e.g. "Profile"). */
  backLabel?: string;
  /** Opens the existing movie-search flow. */
  onSearchPress: () => void;
  onOpenMoviePreview: (payload: MoviePreviewPayload) => void;
}

const NODE_LEVELS: ReadonlySet<NodeLevel> = new Set([
  'A1', 'A2', 'B1', 'B2', 'C1', 'C2',
] as const);

/** MoviePreviewHub expects a CEFR enum; reel tiles don't carry one, so fall
 *  back to B1 and let the hub refine it from movie metadata downstream. */
function inferLevelLabel(tile: ReelTile): NodeLevel {
  const inferred = (tile as unknown as { cefr_level?: string }).cefr_level;
  if (inferred && NODE_LEVELS.has(inferred as NodeLevel)) {
    return inferred as NodeLevel;
  }
  return 'B1';
}

export function SavedMoviesScreen({
  onBack,
  backLabel,
  onSearchPress,
  onOpenMoviePreview,
}: Props) {
  // The tab bar is an absolute overlay, so every scroller reserves its height
  // itself or its last rows sit behind the floating capsule.
  const barInset = useBottomBarInset();
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  const tiles = useReelStore((st) => st.tiles);
  const hydrated = useReelStore((st) => st.hydrated);
  const hydrate = useReelStore((st) => st.hydrate);

  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrated, hydrate]);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} style={s.backBtn}>
          <Text style={s.backText}>
            {BACK_ARROW} {backLabel ?? t('action.back')}
          </Text>
        </TouchableOpacity>
        <Text style={s.title} numberOfLines={1}>
          {t('movies:myMovies.title')}
        </Text>
        <View style={s.headerSpacer} />
      </View>

      <OfflineBanner />

      {tiles.length === 0 ? (
        <ScrollView contentContainerStyle={[s.emptyScroll, { paddingBottom: barInset + 24 }]}>
          <EmptyState
            icon="film-outline"
            title={t('movies:myMovies.empty')}
            body={t('movies:myMovies.emptyBody')}
            ctaLabel={t('movies:myMovies.addFirstFilm')}
            onCta={onSearchPress}
            style={s.emptyStateInline}
          />
          <View style={s.shelfWrap}>
            <ReadyToWatchShelf onAdded={() => { /* the shelf rehydrates the reel */ }} />
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={[s.list, { paddingBottom: barInset + 24 }]}>
          {tiles.map((tile, idx) => (
            <MovieRow
              key={`${tile.tmdb_id}-${idx}`}
              tile={tile}
              onPress={() =>
                onOpenMoviePreview({
                  tileIndex: idx,
                  level: inferLevelLabel(tile),
                  tile,
                })
              }
            />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: tc.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 12,
      backgroundColor: tc.paper,
      borderBottomWidth: 1,
      borderBottomColor: tc.border,
    },
    backBtn: { width: 90 },
    backText: { fontSize: 15, color: tc.primary },
    title: {
      flex: 1,
      textAlign: 'center',
      fontSize: 16,
      fontWeight: '700',
      color: tc.text,
    },
    headerSpacer: { width: 90 },
    list: { padding: 16, gap: 10 },
    emptyScroll: { paddingHorizontal: 16 },
    emptyStateInline: { flex: 0, paddingTop: 40, paddingBottom: 20 },
    shelfWrap: { paddingBottom: 32 },
  });
