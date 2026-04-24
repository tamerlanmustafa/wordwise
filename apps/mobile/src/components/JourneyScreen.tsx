/**
 * JourneyScreen — global practice engine.
 *
 * Auto-starts on tab entry. Reads the user's Watch Later list from
 * `watchLaterStore` and fetches each movie's vocabulary in parallel.
 * Produces one *section* per movie:
 *   - TMDB backdrop (35% opacity) + dark overlay for tile contrast
 *   - Movie title chip, top-left of the section
 *   - Readiness bar (known rare words / total rare words at ≥ userLevel)
 *   - Diamond-tile zigzag chain, one tile per ~10 smart-sampled words
 *
 * "Smart sampling" = top N highest-frequency words the user doesn't
 * already know, pulled from levels ≥ user's proficiency. A 1000-word
 * movie collapses to ~10 tiles of the most impactful words, not 100.
 *
 * Phase 2 will wire real `/movies/{id}/readiness` + server-side
 * SRS-aware sampling; for now everything is computed client-side.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/palette';
import { wordwiseApi, type VocabularyResponse, type WordInfo } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useWatchLaterStore, type WatchLaterMovie } from '../stores/watchLaterStore';
import {
  JourneyNode,
  JOURNEY_NODE_WIDTH,
  JOURNEY_NODE_HEIGHT,
  type NodeState,
  type NodeLevel,
} from './journey/JourneyNode';
import { GlobalBottomBar, type BottomTab } from './GlobalBottomBar';

export interface JourneyScreenProps {
  onTabPress: (tab: BottomTab) => void;
  onMoviePress?: (movieId: number) => void;
}

const LEVELS: NodeLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const WINDOW_WIDTH = Dimensions.get('window').width;

// Tuning
const WORDS_PER_TILE = 10;
const MAX_WORDS_PER_MOVIE = 100; // smart sampling cap
const TILES_PER_DIAGONAL = 2;
const STEP_X = 70;
const STEP_Y = 75;

interface MovieSection {
  movie: WatchLaterMovie;
  vocab: VocabularyResponse | null;
  loading: boolean;
  error: string | null;
}

export function JourneyScreen({ onTabPress, onMoviePress }: JourneyScreenProps) {
  const user = useAuthStore((s) => s.user);
  const userLevel = ((user?.proficiency_level || 'A1').toUpperCase() as NodeLevel);
  const watchLater = useWatchLaterStore((s) => s.movies);

  const [sections, setSections] = useState<MovieSection[]>([]);

  // Fetch vocabulary for each Watch Later movie in parallel.
  useEffect(() => {
    let cancelled = false;
    setSections(
      watchLater.map((m) => ({ movie: m, vocab: null, loading: true, error: null })),
    );
    if (watchLater.length === 0) return;

    watchLater.forEach((m, idx) => {
      wordwiseApi
        .getVocabularyFull(m.movieId)
        .then((vocab) => {
          if (cancelled) return;
          setSections((prev) => {
            const next = [...prev];
            next[idx] = { movie: m, vocab, loading: false, error: null };
            return next;
          });
        })
        .catch((e) => {
          if (cancelled) return;
          console.warn('[Journey] vocab fetch failed for', m.title, e);
          setSections((prev) => {
            const next = [...prev];
            next[idx] = { movie: m, vocab: null, loading: false, error: 'Could not load vocabulary' };
            return next;
          });
        });
    });
    return () => { cancelled = true; };
  }, [watchLater]);

  // Build per-section tile layouts. Tiles are laid out continuously
  // across sections so the zigzag chain is unbroken from bottom to top.
  const layout = useMemo(() => {
    const userIdx = Math.max(0, LEVELS.indexOf(userLevel));
    const visibleLevels = new Set(LEVELS.slice(userIdx));

    const centerX = (WINDOW_WIDTH - JOURNEY_NODE_WIDTH) / 2;
    // Zigzag X offset for a given global tile index (tile 1 is centered).
    const offsetFor = (idx: number) => {
      const cycle = 2 * TILES_PER_DIAGONAL;
      const p = idx % cycle;
      return (p <= TILES_PER_DIAGONAL ? p : cycle - p) * STEP_X;
    };

    const built: Array<{
      section: MovieSection;
      tiles: Array<{ id: string; x: number; y: number; level: NodeLevel; state: NodeState }>;
      headerY: number;
      sectionHeight: number;
      readiness: number;
      totalRare: number;
      knownRare: number;
      words: WordInfo[];
    }> = [];

    const SECTION_HEADER_HEIGHT = 120;
    const BOTTOM_PAD = 40;
    const TOP_PAD = 60;

    let globalTileIdx = 0;
    let cumulativeHeight = BOTTOM_PAD;

    // Build sections bottom-up (first movie at bottom). Each section's
    // tiles stack above its header; the next section sits above.
    for (const s of sections) {
      const words = selectSmartSampledWords(s.vocab, visibleLevels, MAX_WORDS_PER_MOVIE);
      const readinessResult = computeReadiness(s.vocab, visibleLevels, userIdx);
      const tilesForSection = Math.max(1, Math.ceil(words.length / WORDS_PER_TILE));

      // Assemble tile metadata; actual Y comes after we know totalHeight.
      const tilesMeta: Array<{ level: NodeLevel; state: NodeState; wordsForTile: WordInfo[] }> = [];
      for (let k = 0; k < tilesForSection; k++) {
        const slice = words.slice(k * WORDS_PER_TILE, (k + 1) * WORDS_PER_TILE);
        // The dominant level of the slice drives tile color.
        const level = pickDominantLevel(slice) || userLevel;
        // First tile of first section = active; rest = inactive for now.
        const state: NodeState =
          globalTileIdx + k === 0 ? 'active' : 'inactive';
        tilesMeta.push({ level, state, wordsForTile: slice });
      }

      const sectionHeight = SECTION_HEADER_HEIGHT + tilesForSection * STEP_Y;
      built.push({
        section: s,
        tiles: [],           // will fill in after we know totalHeight
        headerY: 0,
        sectionHeight,
        readiness: readinessResult.score,
        totalRare: readinessResult.totalRare,
        knownRare: readinessResult.knownRare,
        words,
      });

      // Track cumulative; we'll flip bottom-up at the end.
      (built[built.length - 1] as any)._tileMeta = tilesMeta;
      (built[built.length - 1] as any)._startIdx = globalTileIdx;
      globalTileIdx += tilesForSection;
      cumulativeHeight += sectionHeight;
    }

    const totalHeight = cumulativeHeight + TOP_PAD;

    // Now fill in y positions (top of canvas = last section = hardest).
    let yCursor = totalHeight - BOTTOM_PAD;
    for (const b of built) {
      const meta = (b as any)._tileMeta as Array<{ level: NodeLevel; state: NodeState; wordsForTile: WordInfo[] }>;
      const startIdx = (b as any)._startIdx as number;

      // Tile Y: from bottom of the section upward.
      for (let k = 0; k < meta.length; k++) {
        const globalIdx = startIdx + k;
        const tileY = yCursor - JOURNEY_NODE_HEIGHT - k * STEP_Y;
        const x = centerX - STEP_X + offsetFor(globalIdx);
        b.tiles.push({
          id: `${b.section.movie.movieId}-${k}`,
          x,
          y: tileY,
          level: meta[k].level,
          state: meta[k].state,
        });
      }

      const tilesStackHeight = meta.length * STEP_Y;
      b.headerY = yCursor - tilesStackHeight - SECTION_HEADER_HEIGHT;
      yCursor -= b.sectionHeight;
    }

    return { built, totalHeight };
  }, [sections, userLevel]);

  // Auto-scroll to the bottom (user's current level / first tile) on mount.
  const scrollRef = useRef<ScrollView>(null);
  const scrolledOnce = useRef(false);
  const onContentSizeChange = (_w: number, _h: number) => {
    if (scrolledOnce.current) return;
    scrolledOnce.current = true;
    scrollRef.current?.scrollToEnd({ animated: false });
  };

  const allLoading = sections.length > 0 && sections.every((s) => s.loading);
  const isEmpty = watchLater.length === 0;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {isEmpty ? (
        <JourneyEmptyState />
      ) : allLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.centerHint}>Loading your journey…</Text>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ height: layout.totalHeight }}
          onContentSizeChange={onContentSizeChange}
          showsVerticalScrollIndicator={false}
        >
          {/* Backdrops + headers per section */}
          {layout.built.map((b) => (
            <JourneySectionHeader
              key={`hdr-${b.section.movie.movieId}`}
              section={b.section}
              readiness={b.readiness}
              knownRare={b.knownRare}
              totalRare={b.totalRare}
              headerY={b.headerY}
              sectionHeight={b.sectionHeight}
              onMoviePress={onMoviePress}
            />
          ))}

          {/* Tiles (rendered after so they sit on top of the backdrops) */}
          {layout.built.flatMap((b) =>
            b.tiles.map((t) => (
              <View
                key={t.id}
                style={[styles.tileWrapper, { left: t.x, top: t.y }]}
              >
                <JourneyNode level={t.level} state={t.state} />
              </View>
            )),
          )}
        </ScrollView>
      )}

      <GlobalBottomBar active="journey" onTabPress={onTabPress} />
    </SafeAreaView>
  );
}

// ─── Smart sampling ────────────────────────────────────────────────────
// Prefer higher-frequency words (lower frequency_rank) from levels at or
// above the user's. The highest-frequency rare words unlock the biggest
// comprehension gains per tile practiced.
function selectSmartSampledWords(
  vocab: VocabularyResponse | null,
  visibleLevels: Set<NodeLevel>,
  cap: number,
): WordInfo[] {
  if (!vocab) return [];
  const pool: WordInfo[] = [];
  for (const lv of Array.from(visibleLevels)) {
    const list = vocab.top_words_by_level[lv] || [];
    pool.push(...list);
  }
  // Sort by frequency rank ascending (lower rank = more frequent =
  // higher practice value). Words with null rank go to the end.
  pool.sort((a, b) => {
    const ar = a.frequency_rank ?? Number.POSITIVE_INFINITY;
    const br = b.frequency_rank ?? Number.POSITIVE_INFINITY;
    return ar - br;
  });
  return pool.slice(0, cap);
}

// Dominant CEFR level of a tile's word slice — so the tile's color
// matches whichever level most of its words come from.
function pickDominantLevel(words: WordInfo[]): NodeLevel | null {
  if (words.length === 0) return null;
  // WordInfo doesn't expose `level` directly — we can't infer level from
  // the word itself here without the source map. Fall back to the user's
  // level until Phase 2 threads the level through with each word.
  return null;
}

// Readiness = knownRare / totalRare where "rare" means at or above the
// user's current level. Phase 1 knowsCount is a placeholder (uses
// wordlist_coverage as a rough heuristic); Phase 2 will compute from
// actual SRS / learned flags.
function computeReadiness(
  vocab: VocabularyResponse | null,
  visibleLevels: Set<NodeLevel>,
  _userIdx: number,
): { score: number; totalRare: number; knownRare: number } {
  if (!vocab) return { score: 0, totalRare: 0, knownRare: 0 };
  let totalRare = 0;
  for (const lv of Array.from(visibleLevels)) {
    totalRare += vocab.level_distribution[lv as 'A1'] || 0;
  }
  // Phase-1 heuristic: use wordlist_coverage (0-1) as a stand-in for
  // "how much of the movie you already know at this level."
  const known = Math.round(totalRare * (vocab.wordlist_coverage || 0));
  const score = totalRare > 0 ? Math.round((known / totalRare) * 100) : 0;
  return { score, totalRare, knownRare: known };
}

// ─── Section header + backdrop ────────────────────────────────────────
interface HeaderProps {
  section: MovieSection;
  readiness: number;
  knownRare: number;
  totalRare: number;
  headerY: number;
  sectionHeight: number;
  onMoviePress?: (movieId: number) => void;
}

function JourneySectionHeader({
  section,
  readiness,
  knownRare,
  totalRare,
  headerY,
  sectionHeight,
  onMoviePress,
}: HeaderProps) {
  const { movie } = section;
  const backdropUri = movie.backdropPath
    ? `https://image.tmdb.org/t/p/w780${movie.backdropPath}`
    : movie.posterPath
      ? `https://image.tmdb.org/t/p/w780${movie.posterPath}`
      : null;

  const readinessColor = readiness >= 75 ? '#4CAF9A' : readiness >= 50 ? '#F4A261' : '#D66A6A';
  const readinessLabel = readiness >= 75 ? 'Ready' : readiness >= 50 ? 'Almost' : 'Tough';

  return (
    <View style={[styles.section, { top: headerY, height: sectionHeight }]}>
      {/* Backdrop image — fills the section behind the tiles */}
      {backdropUri && (
        <Image
          source={{ uri: backdropUri }}
          style={styles.sectionBackdrop}
          resizeMode="cover"
        />
      )}
      {/* Dark overlay for tile readability */}
      <View style={styles.sectionOverlay} />

      {/* Header content */}
      <TouchableOpacity
        style={styles.sectionHeaderContent}
        onPress={() => onMoviePress?.(movie.movieId)}
        activeOpacity={0.8}
      >
        <Text style={styles.sectionTitle} numberOfLines={1}>{movie.title}</Text>
        <View style={styles.readinessRow}>
          <View style={styles.readinessBarBg}>
            <View
              style={[
                styles.readinessBarFill,
                { width: `${readiness}%`, backgroundColor: readinessColor },
              ]}
            />
          </View>
          <Text style={[styles.readinessLabel, { color: readinessColor }]}>
            {readinessLabel} · {readiness}%
          </Text>
        </View>
        {totalRare > 0 && (
          <Text style={styles.sectionMeta}>
            {knownRare}/{totalRare} rare words known
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

function JourneyEmptyState() {
  return (
    <View style={styles.centered}>
      <Ionicons name="bookmark-outline" size={48} color={colors.textSecondary} />
      <Text style={styles.emptyTitle}>Your journey is empty</Text>
      <Text style={styles.emptyHint}>
        Tap "Watch Later" on a movie to start prepping for it. Your
        journey will combine those movies' vocabulary into one practice
        flow.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#2E3B2C' },

  section: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  sectionBackdrop: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    opacity: 0.35,
  },
  sectionOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sectionHeaderContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  readinessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  readinessBarBg: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
    overflow: 'hidden',
  },
  readinessBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  readinessLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  sectionMeta: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 4,
  },

  tileWrapper: {
    position: 'absolute',
    width: JOURNEY_NODE_WIDTH,
  },

  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  centerHint: {
    marginTop: 12,
    color: 'rgba(255,255,255,0.7)',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 12,
  },
  emptyHint: {
    marginTop: 8,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    lineHeight: 20,
  },
});
