/**
 * MyMoviesScreen — v0.7 "My Movies" tab.
 *
 * Flat, sortable, filterable list of the user's added movies. Replaces
 * the rejected film-reel zigzag (JourneyScreen) entirely. Layout copied
 * from `tabs/my-movies.jsx`; data comes from the existing reelStore.
 *
 * Sections, top → bottom:
 *   1. Header: eyebrow + serif title + 2 circular icon buttons.
 *   2. Stat strip: 3 stats (films, words known, avg comprehension).
 *   3. Filter chips: All / In progress / Mastered / Not started + CEFR
 *      chips for any level the user has at least one movie in.
 *   4. Sort row: "N films · sorted by" + pill → ActionSheet.
 *   5. List card: poster rows tappable into MoviePreviewHub.
 *   6. FAB ("+"): opens existing movie-search flow.
 *
 * Empty states:
 *   • No movies at all → ReadyToWatchShelf recommendations.
 *   • Filter excludes everything → "No films match" + reset CTA.
 */

import { useEffect, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Svg, { Circle, Path } from 'react-native-svg';
import { useThemeColors, type ThemeColors } from '../theme/tokens';
import { useReelStore } from '../stores/reelStore';
import {
  useMyMoviesUiStore,
  SORT_LABELS,
  type MyMoviesFilter,
  type MyMoviesSort,
} from '../stores/myMoviesStore';
import type { ReelTile } from '../services/api';
import { FilterChips, labelFor } from './myMovies/FilterChips';
import { MovieRow } from './myMovies/MovieRow';
import { SortPill } from './myMovies/SortPill';
import { ReadyToWatchShelf } from './journey/ReadyToWatchShelf';
import { OfflineBanner } from './common/OfflineBanner';
import { EmptyState } from './common/EmptyState';
import type { MoviePreviewPayload, NodeLevel } from './journey/sharedTypes';

const SERIF_FAMILY = 'Source Serif 4';

export interface MyMoviesScreenProps {
  /** Open the existing movie-search flow (App.tsx navigateToSearch('')).  */
  onSearchPress: () => void;
  /** Open MoviePreviewHub for a tapped tile. Same shape JourneyScreen
   *  used so MoviePreviewHub doesn't need changes. */
  onOpenMoviePreview: (payload: MoviePreviewPayload) => void;
}

// Static filter keys + label. CEFR keys are appended at render time.
const STATIC_FILTERS: MyMoviesFilter[] = ['all', 'in_progress', 'mastered', 'not_started'];

const CEFR_RANK: Record<string, number> = { A1: 0, A2: 1, B1: 2, B2: 3, C1: 4, C2: 5 };

export function MyMoviesScreen({ onSearchPress, onOpenMoviePreview }: MyMoviesScreenProps) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  // Hydrate stores on mount.
  const tiles = useReelStore((st) => st.tiles);
  const reelHydrated = useReelStore((st) => st.hydrated);
  const hydrateReel = useReelStore((st) => st.hydrate);

  const sort = useMyMoviesUiStore((st) => st.sort);
  const filter = useMyMoviesUiStore((st) => st.filter);
  const uiHydrated = useMyMoviesUiStore((st) => st.hydrated);
  const hydrateUi = useMyMoviesUiStore((st) => st.hydrate);
  const setSort = useMyMoviesUiStore((st) => st.setSort);
  const setFilter = useMyMoviesUiStore((st) => st.setFilter);

  useEffect(() => {
    if (!reelHydrated) void hydrateReel();
  }, [reelHydrated, hydrateReel]);
  useEffect(() => {
    if (!uiHydrated) void hydrateUi();
  }, [uiHydrated, hydrateUi]);

  // ── Derived: filter chip availability ─────────────────────────────
  // CEFR chips appear only for levels the user actually has at least
  // one movie in. ReelTile doesn't carry CEFR today — when it does,
  // the union below picks up automatically.
  const availableFilters = useMemo<MyMoviesFilter[]>(() => {
    const set = new Set<string>();
    for (const t of tiles) {
      const cefr = (t as unknown as { cefr_level?: string | null }).cefr_level;
      if (cefr) set.add(cefr);
    }
    const cefrChips = Array.from(set).sort(
      (a, b) => (CEFR_RANK[a] ?? 99) - (CEFR_RANK[b] ?? 99),
    );
    return [...STATIC_FILTERS, ...cefrChips];
  }, [tiles]);

  // ── Derived: filtered + sorted tile list ──────────────────────────
  const visible = useMemo(() => applyFilter(tiles, filter), [tiles, filter]);
  const sorted = useMemo(() => applySort(visible, sort), [visible, sort]);

  // ── Derived: stat strip values ────────────────────────────────────
  const filmsCount = tiles.length;
  const avgComp = useMemo(() => {
    if (tiles.length === 0) return 0;
    const sum = tiles.reduce(
      (acc, t) => acc + (t.comprehensibility_percent ?? 0),
      0,
    );
    return Math.round(sum / tiles.length);
  }, [tiles]);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* ── Header row ─────────────────────────────────────────────── */}
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.eyebrow}>{t('movies:myMovies.eyebrow')}</Text>
          <Text style={s.title}>{t('movies:myMovies.title')}</Text>
        </View>
        <View style={s.headerBtns}>
          {/* Search is the only header action — the old sliders button beside
              it had no handler (dead control); sort/filter live below. */}
          <IconBtn onPress={onSearchPress} tc={tc}>
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={tc.textSecondary} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <Circle cx={11} cy={11} r={7} />
              <Path d="M21 21l-4.3-4.3" />
            </Svg>
          </IconBtn>
        </View>
      </View>

      {/* ── Offline banner (States §D) — above the still-usable reel ── */}
      <OfflineBanner />

      {/* ── Stat strip ─────────────────────────────────────────────── */}
      {/* "words known" was hard-coded to 0 (no real per-reel count exists yet),
          so it's dropped rather than shipping a permanently-zero headline stat. */}
      <View style={s.statStrip}>
        <Stat n={String(filmsCount)} l="films" tc={tc} />
        <View style={s.statDivider} />
        <Stat n={`${avgComp}%`} l="avg comp." accent tc={tc} />
      </View>

      {/* ── Filter chips ───────────────────────────────────────────── */}
      <FilterChips
        available={availableFilters}
        active={filter}
        onChange={setFilter}
      />

      {/* ── Sort row ───────────────────────────────────────────────── */}
      <SortPill
        value={sort}
        onChange={setSort}
        summary={t('movies:myMovies.sortSummary', { count: visible.length })}
      />

      {/* ── List card OR empty state ───────────────────────────────── */}
      {filmsCount === 0 ? (
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}>
          <EmptyState
            icon="film-outline"
            title={t('movies:myMovies.empty')}
            body={t('movies:myMovies.emptyBody')}
            ctaLabel={t('movies:myMovies.addFirstFilm')}
            onCta={onSearchPress}
            style={s.emptyStateInline}
          />
          <View style={s.shelfEmptyWrap}>
            <ReadyToWatchShelf
              onAdded={() => {
                /* reel rehydrates inside the shelf */
              }}
            />
          </View>
        </ScrollView>
      ) : sorted.length === 0 ? (
        <View style={s.emptyState}>
          <Text style={s.emptyTitle}>{t('movies:myMovies.noMatch')}</Text>
          <Text style={s.emptyBody}>
            Your current filter excludes everything in your reel. Try
            another chip — or clear the filter.
          </Text>
          <Pressable
            onPress={() => setFilter('all')}
            style={({ pressed }) => [s.resetBtn, pressed && { opacity: 0.85 }]}
          >
            <Text style={s.resetBtnText}>{t('movies:myMovies.showAll')}</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView style={s.listCard} contentContainerStyle={{ paddingBottom: 24 }}>
          {sorted.map((t, idx) => (
            <MovieRow
              key={`${t.tmdb_id}-${idx}`}
              tile={t}
              onPress={() =>
                onOpenMoviePreview({
                  tileIndex: idx,
                  level: inferLevelLabel(t),
                  tile: t,
                })
              }
            />
          ))}
        </ScrollView>
      )}

      {/* ── FAB ────────────────────────────────────────────────────── */}
      <Pressable
        onPress={onSearchPress}
        style={({ pressed }) => [
          s.fab,
          { backgroundColor: tc.gold, shadowColor: tc.gold },
          pressed && { opacity: 0.85 },
        ]}
        hitSlop={6}
      >
        <Text style={[s.fabGlyph, { color: tc.goldDeep }]}>+</Text>
      </Pressable>
    </SafeAreaView>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function applyFilter(tiles: ReelTile[], filter: MyMoviesFilter): ReelTile[] {
  if (filter === 'all') return tiles;
  if (filter === 'in_progress') {
    return tiles.filter((t) => {
      const p = t.comprehensibility_percent ?? 0;
      return p > 0 && p < 100;
    });
  }
  if (filter === 'mastered') {
    return tiles.filter((t) => t.status === 'mastered');
  }
  if (filter === 'not_started') {
    return tiles.filter((t) => {
      const p = t.comprehensibility_percent ?? 0;
      return p === 0 && t.status !== 'mastered';
    });
  }
  // CEFR filter — when ReelTile carries `cefr_level` (future enrichment),
  // this matches it. Today it returns [] for any CEFR chip.
  return tiles.filter(
    (t) => (t as unknown as { cefr_level?: string | null }).cefr_level === filter,
  );
}

function applySort(tiles: ReelTile[], sort: MyMoviesSort): ReelTile[] {
  const arr = [...tiles];
  switch (sort) {
    case 'recently_added':
      // Reel response is already most-recently-added first; preserve.
      return arr;
    case 'title_asc':
      return arr.sort((a, b) => a.title.localeCompare(b.title));
    case 'year_desc':
      return arr.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    case 'year_asc':
      return arr.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
    case 'comprehension_desc':
      return arr.sort(
        (a, b) => (b.comprehensibility_percent ?? 0) - (a.comprehensibility_percent ?? 0),
      );
    case 'comprehension_asc':
      return arr.sort(
        (a, b) => (a.comprehensibility_percent ?? 0) - (b.comprehensibility_percent ?? 0),
      );
    case 'cefr_easy_first':
      return arr.sort((a, b) => {
        const al = (a as unknown as { cefr_level?: string }).cefr_level ?? '';
        const bl = (b as unknown as { cefr_level?: string }).cefr_level ?? '';
        return (CEFR_RANK[al] ?? 99) - (CEFR_RANK[bl] ?? 99);
      });
    case 'rating_desc':
      // ReelTile doesn't carry rating today — preserve current order.
      return arr;
  }
}

const NODE_LEVELS: ReadonlySet<NodeLevel> = new Set(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const);

function inferLevelLabel(t: ReelTile): NodeLevel {
  // MoviePreviewHub expects a CEFR enum; we don't know the user's per-
  // movie target yet, so default to 'B1' when nothing on the tile hints
  // a level. The hub falls back to movie metadata downstream.
  const inferred = (t as unknown as { cefr_level?: string }).cefr_level;
  if (inferred && NODE_LEVELS.has(inferred as NodeLevel)) {
    return inferred as NodeLevel;
  }
  return 'B1';
}

// Silence the unused-import warning when SORT_LABELS isn't referenced
// directly here (used inside SortPill — kept exported for callers).
void SORT_LABELS;
void labelFor;

// ── Pieces ─────────────────────────────────────────────────────────────

function IconBtn({
  children,
  onPress,
  tc,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  tc: ThemeColors;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          width: 38,
          height: 38,
          borderRadius: 19,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: tc.chipBg,
          borderWidth: 1,
          borderColor: tc.border,
        },
        pressed && { opacity: 0.85 },
      ]}
      hitSlop={6}
    >
      {children}
    </Pressable>
  );
}

function Stat({
  n,
  l,
  accent,
  tc,
}: {
  n: string;
  l: string;
  accent?: boolean;
  tc: ThemeColors;
}) {
  return (
    <View style={{ flex: 1 }}>
      <Text
        style={{
          fontFamily: SERIF_FAMILY,
          fontSize: 22,
          fontWeight: '700',
          lineHeight: 22,
          color: accent ? tc.goldOnSurface : tc.text,
        }}
      >
        {n}
      </Text>
      <Text
        style={{
          fontSize: 10,
          color: tc.textFaint,
          marginTop: 4,
          letterSpacing: 1,
          textTransform: 'uppercase',
          fontWeight: '700',
        }}
      >
        {l}
      </Text>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: tc.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      paddingHorizontal: 18,
      paddingTop: 8,
      paddingBottom: 8,
    },
    eyebrow: {
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 2,
      color: tc.goldOnSurface,
      textTransform: 'uppercase',
      marginBottom: 4,
    },
    title: {
      fontFamily: SERIF_FAMILY,
      fontSize: 30,
      fontWeight: '600',
      letterSpacing: -0.8,
      color: tc.text,
      lineHeight: 32,
    },
    headerBtns: {
      flexDirection: 'row',
      gap: 8,
    },
    statStrip: {
      marginHorizontal: 18,
      marginTop: 6,
      marginBottom: 14,
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderRadius: 14,
      backgroundColor: tc.paper,
      borderWidth: 1,
      borderColor: tc.border,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 2,
    },
    statDivider: {
      width: 1,
      height: 28,
      backgroundColor: tc.divider,
    },
    listCard: {
      flex: 1,
      marginHorizontal: 12,
      backgroundColor: tc.paper,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: tc.border,
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 2,
    },
    emptyState: {
      flex: 1,
      paddingHorizontal: 28,
      paddingTop: 32,
      gap: 12,
    },
    // Empty-reel EmptyState sits above the suggestions shelf (not centered in
    // the whole viewport), so size it to content rather than flex:1.
    emptyStateInline: {
      flex: 0,
      paddingTop: 40,
      paddingBottom: 20,
    },
    emptyTitle: {
      fontFamily: SERIF_FAMILY,
      fontSize: 20,
      fontWeight: '700',
      color: tc.text,
      letterSpacing: -0.3,
    },
    emptyBody: {
      fontSize: 13,
      lineHeight: 19,
      color: tc.textSecondary,
    },
    shelfEmptyWrap: {
      marginTop: 4,
    },
    resetBtn: {
      alignSelf: 'flex-start',
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 999,
      backgroundColor: tc.gold,
      marginTop: 4,
    },
    resetBtnText: {
      fontSize: 13,
      fontWeight: '900',
      color: tc.goldDeep,
      letterSpacing: 0.3,
    },
    fab: {
      position: 'absolute',
      right: 22,
      bottom: 96,
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      shadowOpacity: 0.4,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 10 },
      elevation: 8,
    },
    fabGlyph: {
      fontSize: 28,
      fontWeight: '300',
      lineHeight: 28,
    },
  });
