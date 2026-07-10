/**
 * RankedMovieList — a virtualized, infinitely-scrolling ranked feed.
 *
 * Backed by FlashList: only a small window of cards is mounted at a time no
 * matter how long the list grows, so memory and render cost stay flat. The
 * list lives in a fixed-height panel inside the HomeScreen page; scrolling it
 * to the bottom calls onEndReached to fetch the next page, and a footer
 * spinner shows while that page is in flight (visible on slow connections).
 *
 * Each card carries a small "+ Add to my list" button in the top-right
 * corner — the one-tap pipeline from the home feed into the user's Journey
 * Reel. Tap stops propagation so the card's main onPress (→ MovieDetail) is
 * not triggered. Tapping the poster opens a lightbox.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  ImageBackground,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { RefreshControlProps } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { colors } from '../../theme/palette';
import { TmdbPoster } from '../movies/TmdbPoster';
import { scoreToCefr } from '../../utils/formatting';
import { useReelStore } from '../../stores/reelStore';
import { useFlightStore } from '../../stores/flightStore';
import { useReelBadgeStore } from '../../stores/reelBadgeStore';

// ── Geometry ─────────────────────────────────────────────────────────────────
const CARD_H        = 116;
const CARD_GAP      = 8;
const ITEM_H        = CARD_H + CARD_GAP;
// How many cards the fixed-height panel shows at rest. The list scrolls
// (and virtualizes) within this window; the rest of the page scrolls around it.
const VISIBLE_CARDS = 4;
const CONTAINER_H   = VISIBLE_CARDS * ITEM_H;

function prefetchMovieImages(movie: any) {
  if (movie.poster_path)
    Image.prefetch(`https://image.tmdb.org/t/p/w500${movie.poster_path}`).catch(() => {});
  if (movie.backdrop_path)
    Image.prefetch(`https://image.tmdb.org/t/p/w780${movie.backdrop_path}`).catch(() => {});
}

interface Props {
  movies: any[];
  onMoviePress: (movie: any) => void;
  userLevel?: string;
  /** Called when the user scrolls near the bottom — load the next page. */
  onEndReached?: () => void;
  /** True while the next page is being fetched (drives the footer spinner). */
  loadingMore?: boolean;
  /** False once the server reports no further pages. */
  hasMore?: boolean;
  /** Live vertical scroll offset of the feed, so the parent can collapse the
   *  Word-of-the-Hour card away as the user browses movies. */
  onScrollOffset?: (offsetY: number) => void;
  /** When true the list fills its parent (flex:1) and is the page's sole
   *  scroller, instead of the fixed-height panel used in embedded contexts. */
  fillHeight?: boolean;
  /** Passed straight to the underlying list — lets the parent own pull-to-
   *  refresh now that this list, not an outer ScrollView, is the scroller. */
  refreshControl?: React.ReactElement<RefreshControlProps>;
  /** Fires when the user starts dragging (e.g. to dismiss the keyboard). */
  onScrollBeginDrag?: () => void;
}

// ── Add-to-reel chip ────────────────────────────────────────────────────────
// Small pill in the top-right of each card. Reads the live reelStore
// membership for this tmdb_id so the label swaps between "+ Add to list"
// and "✓ Added — tap to remove." Tapping toggles: tap once adds (and
// triggers the poster-flight animation toward the Reel tab); tap again
// removes the movie from the reel.
const AddToReelChip = React.memo(({
  movie,
  flightSourceRef,
}: {
  movie: any;
  /** Ref to the node we want the flight animation to launch from
   *  (the card's poster image). Optional — if absent, the flight skips. */
  flightSourceRef?: React.RefObject<View | null>;
}) => {
  const tmdbId: number | undefined = movie.tmdb_id ?? (typeof movie.id === 'number' ? movie.id : undefined);
  const inReel = useReelStore((s) =>
    tmdbId != null && s.tiles.some((t) => t.tmdb_id === tmdbId && t.source === 'user'),
  );
  const add = useReelStore((s) => s.add);
  const remove = useReelStore((s) => s.remove);
  const fly = useFlightStore((s) => s.fly);
  const bumpBadge = useReelBadgeStore((s) => s.bump);
  const unbumpBadge = useReelBadgeStore((s) => s.unbump);
  const [busy, setBusy] = useState(false);

  // Tiny scale pulse on tap (both add and remove). The big motion lives
  // in the global poster-flight overlay, not this chip.
  const tapScale = useRef(new Animated.Value(1)).current;
  const playTap = () => {
    Animated.sequence([
      Animated.timing(tapScale, { toValue: 0.92, duration: 90, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.spring(tapScale, { toValue: 1, friction: 4, useNativeDriver: true }),
    ]).start();
  };

  const launchFlight = () => {
    const node = flightSourceRef?.current;
    if (!node || !movie.poster_path) return;
    // measureInWindow gives us window-space coords, which is what the
    // PosterFlight overlay (StyleSheet.absoluteFill at root) expects.
    node.measureInWindow((x, y, width, height) => {
      if (width <= 0 || height <= 0) return;
      fly({
        posterPath: movie.poster_path,
        from: { x, y, width, height },
      });
    });
  };

  const onPress = async (e: any) => {
    e?.stopPropagation?.();
    if (!tmdbId || busy) return;
    setBusy(true);
    playTap();
    try {
      if (inReel) {
        unbumpBadge();
        await remove(tmdbId);
      } else {
        // Kick off the flight BEFORE the await so the animation is
        // visually tied to the tap, not to the round-trip latency.
        launchFlight();
        bumpBadge();
        await add({
          tmdb_id: tmdbId,
          title: movie.title,
          poster_path: movie.poster_path ?? null,
          year: movie.release_date ? parseInt(String(movie.release_date).slice(0, 4), 10) : null,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Animated.View style={{ transform: [{ scale: tapScale }] }}>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.85}
        disabled={busy}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <View
          style={[
            chipStyles.chip,
            {
              backgroundColor: inReel ? 'rgba(255,209,102,0.92)' : 'rgba(0,0,0,0.55)',
              borderColor: inReel ? 'rgba(255,209,102,1)' : 'rgba(255,255,255,0.25)',
            },
          ]}
        >
          <Text
            style={[
              chipStyles.chipText,
              { color: inReel ? '#3a2400' : '#fff' },
            ]}
            numberOfLines={1}
          >
            {inReel ? '✓ Added · tap to remove' : '+ Add to list'}
          </Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
});

// ── Single ranked card ─────────────────────────────────────────────────────
const MovieCard = React.memo(({
  movie,
  onPress,
  onZoom,
}: {
  movie: any;
  onPress: () => void;
  onZoom: (uri: string, title: string) => void;
}) => {
  const posterUri   = movie.poster_path
    ? `https://image.tmdb.org/t/p/w185${movie.poster_path}`
    : movie.poster_url || undefined;
  const backdropUri = movie.backdrop_path
    ? `https://image.tmdb.org/t/p/w780${movie.backdrop_path}`
    : null;
  const rating    = movie.vote_average > 0
    ? `★ ${Number(movie.vote_average).toFixed(1)}`
    : null;
  const cefr      = scoreToCefr(movie.difficulty_score);
  const level     = cefr && movie.difficulty_score != null
    ? `${cefr} ${movie.difficulty_score}%`
    : null;
  const wordCount = movie.unique_words > 0 ? `${movie.unique_words} words` : null;

  // Ref to the poster wrapper so the add chip can measure it and launch
  // the global poster-flight animation from this exact position.
  const posterRef = useRef<View | null>(null);

  return (
    <View style={s.cardSlot}>
      <TouchableOpacity
        style={s.card}
        onPress={onPress}
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
              {/* collapsable={false} keeps the wrapper in the native view
                  tree so measureInWindow always returns a real rect. */}
              <View ref={posterRef as any} collapsable={false}>
                <TouchableOpacity
                  onPress={(e) => {
                    e.stopPropagation();
                    if (posterUri) onZoom(posterUri, movie.title);
                  }}
                  activeOpacity={0.85}
                >
                  {posterUri ? (
                    <Image source={{ uri: posterUri }} style={s.poster} />
                  ) : movie.tmdb_id ? (
                    <TmdbPoster tmdbId={movie.tmdb_id} style={s.poster} />
                  ) : (
                    <View style={[s.poster, s.posterFallback]}>
                      <Text style={{ fontSize: 22 }}>🎬</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
              <View style={s.info}>
                <Text style={s.title} numberOfLines={2}>{movie.title}</Text>
                {(rating || level) && (
                  <Text style={s.subText}>{[rating, level].filter(Boolean).join('  •  ')}</Text>
                )}
                {wordCount && <Text style={s.wordText}>{wordCount}</Text>}
              </View>
            </View>
            <View style={s.addChipSlot} pointerEvents="box-none">
              <AddToReelChip movie={movie} flightSourceRef={posterRef} />
            </View>
          </ImageBackground>
        ) : (
          <View style={[s.backdrop, s.fallback]}>
            <View style={s.row}>
              <View
                ref={posterRef as any}
                collapsable={false}
                style={[s.poster, s.posterFallback]}
              >
                <Text>🎬</Text>
              </View>
              <View style={s.info}><Text style={s.title}>{movie.title}</Text></View>
            </View>
            <View style={s.addChipSlot} pointerEvents="box-none">
              <AddToReelChip movie={movie} flightSourceRef={posterRef} />
            </View>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
});

// ── Footer: bottom-of-list spinner / end marker ──────────────────────────────
const ListFooter = ({ loadingMore, hasMore, count }: { loadingMore?: boolean; hasMore?: boolean; count: number }) => {
  if (loadingMore) {
    return (
      <View style={s.footer}>
        <ActivityIndicator size="small" color={colors.textSecondary} />
      </View>
    );
  }
  if (!hasMore && count > 0) {
    return (
      <View style={s.footer}>
        <Text style={s.footerText}>That's everything at this level</Text>
      </View>
    );
  }
  return null;
};

// ── Main component ─────────────────────────────────────────────────────────────
export const RankedMovieList = ({ movies: data, onMoviePress, onEndReached, loadingMore, hasMore, onScrollOffset, fillHeight, refreshControl, onScrollBeginDrag }: Props) => {
  const [zoomed, setZoomed] = useState<{ uri: string; title: string } | null>(null);

  // Hydrate the reel store once so the chip can read membership state
  // without waiting for the user to open the Journey tab first.
  const reelHydrated = useReelStore((st) => st.hydrated);
  const hydrateReel = useReelStore((st) => st.hydrate);
  useEffect(() => {
    if (!reelHydrated) hydrateReel();
  }, [reelHydrated, hydrateReel]);

  if (!data.length) {
    return (
      <View style={fillHeight ? s.fill : undefined}>
        <Text style={{ textAlign: 'center', color: colors.textSecondary, fontSize: 13, paddingVertical: 16 }}>
          No classified movies found for this level yet.
        </Text>
      </View>
    );
  }

  return (
    <View style={fillHeight ? s.fill : undefined}>
      {/* Bounds FlashList's viewport. In fillHeight mode it takes the rest of
          the screen and is the page's sole scroller; otherwise it's the older
          fixed-height panel that scrolls inside a parent ScrollView. */}
      <View style={fillHeight ? s.fill : s.container}>
        <FlashList
          data={data}
          keyExtractor={(item) => String(item.id || item.movie_id)}
          renderItem={({ item }) => (
            <MovieCard
              movie={item}
              onPress={() => onMoviePress(item)}
              onZoom={(uri, title) => setZoomed({ uri, title })}
            />
          )}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={onScrollBeginDrag}
          refreshControl={refreshControl}
          onScroll={onScrollOffset ? (e) => onScrollOffset(e.nativeEvent.contentOffset.y) : undefined}
          scrollEventThrottle={16}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.6}
          ListFooterComponent={
            <ListFooter loadingMore={loadingMore} hasMore={hasMore} count={data.length} />
          }
        />
      </View>

      {/* Poster lightbox */}
      <Modal visible={!!zoomed} transparent animationType="fade" onRequestClose={() => setZoomed(null)}>
        <TouchableOpacity style={s.lightbox} activeOpacity={1} onPress={() => setZoomed(null)}>
          {zoomed && (
            <Image
              source={{ uri: zoomed.uri.replace('w185', 'w500') }}
              style={s.lightboxImg}
              resizeMode="contain"
            />
          )}
          <Text style={s.lightboxHint}>Tap to close</Text>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const POSTER_H = 84;

const s = StyleSheet.create({
  // Fills the parent so the list becomes the page's sole, full-height scroller.
  fill: {
    flex: 1,
  },

  // Bounds the virtualized list's viewport (fixed-height embedded panel).
  container: {
    height: CONTAINER_H,
  },

  // Each row = card + gap below it.
  cardSlot: {
    height: ITEM_H,
    paddingBottom: CARD_GAP,
  },

  card: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },

  backdrop:      { flex: 1, justifyContent: 'center' },
  backdropImage: { borderRadius: 14 },
  fallback:      { backgroundColor: colors.paper },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.52)',
  },

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
    alignSelf: 'center',
  },
  posterFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  info: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    paddingVertical: 6,
    gap: 4,
  },

  title:   { fontSize: 15, fontWeight: '700', color: '#fff' },
  subText: { fontSize: 11, color: 'rgba(255,255,255,0.85)', fontWeight: '600' },
  wordText:{ fontSize: 11, color: 'rgba(255,255,255,0.7)' },

  addChipSlot: {
    position: 'absolute',
    top: 8,
    right: 8,
  },

  footer: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerText: {
    fontSize: 12,
    color: colors.textSecondary,
  },

  lightbox: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxImg: { width: '85%', height: '80%' },
  lightboxHint: {
    position: 'absolute',
    bottom: 40,
    color: 'rgba(255,255,255,0.3)',
    fontSize: 12,
  },
});

const chipStyles = StyleSheet.create({
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  chipText: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
