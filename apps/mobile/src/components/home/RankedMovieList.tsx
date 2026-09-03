/**
 * RankedMovieList — a virtualized, infinitely-scrolling ranked feed.
 *
 * Backed by FlashList: only a small window of cards is mounted at a time no
 * matter how long the list grows, so memory and render cost stay flat. The
 * list lives in a fixed-height panel inside the HomeScreen page; scrolling it
 * to the bottom calls onEndReached to fetch the next page, and a footer
 * spinner shows while that page is in flight (visible on slow connections).
 *
 * ## The card
 *
 * The card is *part of the page*, not a dark photo slab: a single stock colour
 * one step off the page background, identical on every row. The backdrop is
 * shown whole (never cropped), anchored to the trailing edge at reduced
 * opacity, with its own leading edge fading in. Readability comes from a
 * horizontal gradient scrim in the card's own stock colour — near-opaque
 * behind the type, easing to nothing by the trailing edge where the still
 * reads at full strength. Text is ink on paper, which is what lets one set of
 * colours survive both themes. The leading margin carries the one thing the
 * row is actually judged by: its comprehension ring.
 *
 * That ring reads `<pct>% / KNOWN` — the share of the film's dialogue
 * vocabulary at or below the reader's level (`./comprehension`). It used to
 * draw `difficulty_score` with `scoreToCefr()` of the *same number* stacked
 * inside it, which said one thing twice and said nothing about the reader; on
 * a B1 shelf every card read `B1` with a percentage inside the 10-point-wide
 * B1 band. The film's own band still appears — on the meta line, beside the
 * year, where it is plainly a fact about the film.
 *
 * The maths (gradient stops, ring geometry, plus-ink contrast) lives in
 * ./cardVisuals so it is testable and can be hoisted out of the row.
 *
 * Each card carries a single add-to-list glyph in the trailing top corner —
 * the one-tap pipeline from the home feed into the user's Journey Reel. Tap
 * stops propagation so the card's main onPress (→ MovieDetail) is not
 * triggered.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { RefreshControlProps } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FlashList } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/palette';
import { useColorScheme, useThemeColors, themes, type ThemeColors } from '../../theme/tokens';
import { MONO_FAMILY, SERIF_FAMILY } from '../../theme/fonts';
import { isRTL } from '../../i18n/rtl';
import { scoreToCefr } from '../../utils/formatting';
import { useReelStore } from '../../stores/reelStore';
import { useFlightStore } from '../../stores/flightStore';
import { useReelBadgeStore } from '../../stores/reelBadgeStore';
import { SwipeableRow } from './SwipeableRow';
import { knownShare, type KnownShare } from './comprehension';
import {
  BACKDROP_OPACITY,
  BACKDROP_W,
  CARD_GAP,
  CARD_H,
  CARD_RADIUS,
  EDGE_FADE_W,
  ITEM_H,
  RING_C,
  RING_HOLE,
  RING_R,
  RING_SIZE,
  RING_STROKE,
  buildEdgeFade,
  buildScrim,
  cornerForGlyph,
  hexToRgb,
  pickPlusInk,
  plusHalo,
  ringDashOffset,
} from './cardVisuals';
import type { SwipeAction } from '../../utils/swipeDecision';

// ── Geometry ─────────────────────────────────────────────────────────────────
// Now imported from `cardVisuals` rather than declared here, so `FeedSkeleton`
// can draw a placeholder that is genuinely this card's size and the two cannot
// drift apart again.

// NOTE — do not widen FlashList's `drawDistance` here without re-measuring.
// Tried and reverted 2026-08-30. The knob works exactly as advertised: the
// default 250 keeps 11 cards mounted, 500 keeps ~15 and 1000 keeps 20 (counted
// in the AX tree on an iPhone 17 Pro sim). The problem is the cost curve. Peak
// phys_footprint, 3 alternating runs each with TMDB backdrops actually loading:
//
//     250  → ~283 MB      (11 cards, FlashList default)
//     500  → ~347 MB      (~15 cards, +64 MB)
//     1000 → ~454 MB      (20 cards, +171 MB)
//
// ~19 MB per extra mounted card, because every live card pins a decoded w780
// backdrop bitmap. A 60% jump in peak memory is not worth a deeper pre-render
// bank. Measure with images loading if you revisit this: an earlier run with
// the TMDB proxy 401ing showed only +11 MB and was badly misleading.
//
// The runway is also only a *burst* budget — it covers a flick from rest, not
// sustained scrolling, where cards enter the window at whatever rate you scroll
// regardless of its size. If blanks need fixing, make the cell cheaper (the
// renderItem `key` below defeats FlashList's recycling, so every cell that
// scrolls in is a full remount) rather than mounting more of them.

// How many cards the fixed-height panel shows at rest. The list scrolls
// (and virtualizes) within this window; the rest of the page scrolls around it.
const VISIBLE_CARDS = 4;
const CONTAINER_H   = VISIBLE_CARDS * ITEM_H;

// ── Per-theme card visuals, built once ──────────────────────────────────────
// These never depend on the movie, so building them per card per render would
// be pure waste under FlashList recycling. The card background, the scrim and
// the ring hole all resolve to the same RGB — that identity is what keeps the
// gradient from showing a seam where it meets the card.
const CARD_STOCK_RGB = {
  light: hexToRgb(themes.light.cardStock),
  dark:  hexToRgb(themes.dark.cardStock),
} as const;

const SCRIMS = {
  light: buildScrim(CARD_STOCK_RGB.light),
  dark:  buildScrim(CARD_STOCK_RGB.dark),
} as const;

const EDGE_FADES = {
  light: buildEdgeFade(CARD_STOCK_RGB.light),
  dark:  buildEdgeFade(CARD_STOCK_RGB.dark),
} as const;

// A barely-there gold cast off the trailing top corner, matching the app's
// accent lighting. The mockup uses a radial gradient; RN has none, and a
// corner-anchored linear at these alphas is indistinguishable.
const GOLD_CAST = {
  light: ['rgba(197,139,27,0.18)', 'transparent'] as readonly [string, string],
  dark:  ['rgba(255,209,102,0.13)', 'transparent'] as readonly [string, string],
} as const;

// Yoga mirrors `start`/`end` and `flexDirection: 'row'` for us, but gradient
// vectors are ours to flip — read the native direction once, as rtl.ts does.
const RTL = isRTL();
const LEAD  = { x: RTL ? 1 : 0, y: 0.5 };
const TRAIL = { x: RTL ? 0 : 1, y: 0.5 };
const CAST_START = { x: RTL ? 0 : 1, y: 0 };
const CAST_END   = { x: RTL ? 0.75 : 0.25, y: 1 };

const RING_MID = RING_SIZE / 2;

function prefetchMovieImages(movie: any) {
  if (movie.poster_path)
    Image.prefetch(`https://image.tmdb.org/t/p/w500${movie.poster_path}`).catch(() => {});
  if (movie.backdrop_path)
    Image.prefetch(`https://image.tmdb.org/t/p/w780${movie.backdrop_path}`).catch(() => {});
}

interface Props {
  movies: any[];
  onMoviePress: (movie: any) => void;
  /** The reader's CEFR level — what each ring's percentage is measured
   *  against. Passed down rather than read from a store inside the cell: these
   *  cells are recycled, and a store subscription per row is a subscription
   *  per *recycled* row. */
  level: string;
  /** Tapping a ring opens the "what does 86% mean" sheet. The sheet is the
   *  parent's to render — an absolute overlay inside a 116pt cell would be
   *  clipped to it. Rings on films with no distribution don't fire. */
  onRingPress?: (movie: any, share: KnownShare) => void;
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
  /** Space to leave below the last card so it clears the floating bottom bar
   *  the feed now scrolls underneath. */
  bottomInset?: number;
  /** Home-feed swipe: right → "Seen it" (Watched), left → "Not interested".
   *  When omitted, cards aren't swipeable. */
  onSwipeAction?: (action: SwipeAction, movie: any) => void;
  /** Overrides the empty-state copy. The default blames the level, which is
   *  wrong once a filter is on: there are no animated films above B1 at all
   *  (prod, 2026-08-23), so "none at this level yet" would read as a data gap
   *  rather than as the filter the user just applied. */
  emptyMessage?: string;
}

// ── Add-to-reel glyph ───────────────────────────────────────────────────────
// A single glyph in the trailing top corner — no background, no border, no
// label. Reads the live reelStore membership for this tmdb_id so it swaps
// between "+" and "✓". Tapping toggles: tap once adds (and triggers the
// poster-flight animation toward the Reel tab); tap again removes.
const AddToReelPlus = React.memo(({
  movie,
  flightSourceRef,
  ink,
}: {
  movie: any;
  /** Ref to the node we want the flight animation to launch from
   *  (the card's level ring). Optional — if absent, the flight skips. */
  flightSourceRef?: React.RefObject<View | null>;
  /** Glyph colour, picked per movie against what sits behind it. */
  ink: string;
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
  // in the global poster-flight overlay, not this glyph.
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
        // The visual target is now ~19pt, so the touch target has to be
        // padded back past 44pt or the redesign regresses usability.
        hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
      >
        <Text style={[plusStyles.plus, { color: ink }, plusHalo(ink)]}>
          {inReel ? '✓' : '+'}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
});

// ── Comprehension ring ──────────────────────────────────────────────────────
// A gold arc drawn to the share of this film's dialogue vocabulary at or below
// the reader's level, with that percent and the word KNOWN stacked inside. The
// hole is filled with card stock, not left transparent, so the backdrop can't
// show through it. The percent is deliberately ink rather than gold — two
// golds at that size failed contrast.
//
// KNOWN is one word of caption and it is the whole point: without it the
// number reads as "how B1 this film is", which is what the ring used to mean
// and is precisely the confusion this change exists to end.
//
// Geometry, RING_*, and the stock-filled hole are unchanged; only what feeds
// the arc changed.
const LevelRing = React.memo(({
  share,
  caption,
  tc,
  s,
}: {
  share: KnownShare | null;
  /** The word under the percent, already translated. Passed in rather than
   *  looked up here so a cell that FlashList recycles doesn't take an i18n
   *  context subscription per row. */
  caption: string;
  tc: ThemeColors;
  s: ReturnType<typeof makeStyles>;
}) => (
  <View style={s.ring}>
    <Svg width={RING_SIZE} height={RING_SIZE}>
      <Circle
        cx={RING_MID}
        cy={RING_MID}
        r={RING_R}
        strokeWidth={RING_STROKE}
        stroke={tc.cardRingTrack}
        fill="none"
      />
      {share ? (
        <Circle
          cx={RING_MID}
          cy={RING_MID}
          r={RING_R}
          strokeWidth={RING_STROKE}
          stroke={tc.cardMeta}
          fill="none"
          strokeDasharray={RING_C}
          strokeDashoffset={ringDashOffset(share.pct)}
          strokeLinecap="butt"
          transform={`rotate(-90 ${RING_MID} ${RING_MID})`}
        />
      ) : null}
    </Svg>
    <View style={s.ringHoleWrap} pointerEvents="none">
      <View style={s.ringHole}>
        {/* No distribution → bare track and an em dash. 0% would read as
            "you know none of this film", which is a claim; the dash is not. */}
        <Text style={s.ringPct}>{share ? `${share.pct}%` : '—'}</Text>
        {share ? (
          <Text style={s.ringCaption} numberOfLines={1}>{caption}</Text>
        ) : null}
      </View>
    </View>
  </View>
));

// ── Single ranked card ─────────────────────────────────────────────────────
const MovieCard = React.memo(({
  movie,
  onPress,
  level,
  onRingPress,
  knownCaption,
  bandLabel,
}: {
  movie: any;
  onPress: () => void;
  level: string;
  onRingPress?: (movie: any, share: KnownShare) => void;
  knownCaption: string;
  /** `LEVEL {{band}}`, already translated — see `knownCaption`. */
  bandLabel: (band: string) => string;
}) => {
  const tc = useThemeColors();
  const scheme = useColorScheme();
  const s = useMemo(() => makeStyles(tc, scheme), [tc, scheme]);

  const backdropUri = movie.backdrop_path
    ? `https://image.tmdb.org/t/p/w780${movie.backdrop_path}`
    : null;
  const rating = movie.vote_average > 0 ? Number(movie.vote_average).toFixed(1) : null;
  const year   = movie.release_date ? String(movie.release_date).slice(0, 4) : null;
  // The film's own band, from `difficulty_score`. Still shown — it just is not
  // the ring any more, because it says nothing about the reader.
  const band   = scoreToCefr(movie.difficulty_score ?? null);
  // A pure function of the payload and the reader's level, so it is computed
  // per render rather than stored: a cached copy is exactly the staleness
  // `services/movie_cefr.py` exists to prevent.
  const share = useMemo(
    () => knownShare(movie.cefr_distribution ?? movie.cefrDistribution, level),
    [movie.cefr_distribution, movie.cefrDistribution, level],
  );
  // Same single meta line as before — the year gains a suffix, it does not
  // gain a row, so the card is still exactly CARD_H tall.
  const meta = year && band ? `${year} · ${bandLabel(band)}` : year ?? (band ? bandLabel(band) : null);

  // Ref to the ring so the add glyph can measure it and launch the global
  // poster-flight animation from this exact position — it's the row's
  // leading identity mark now that the poster is gone.
  const ringRef = useRef<View | null>(null);

  // The glyph sits over the trailing top of the backdrop, which is exactly
  // where the image is least covered by the scrim, so a fixed gold vanishes on
  // roughly a third of real backdrops. The corner average comes from ingest
  // (#115); where it is absent — no backdrop, or a mirrored RTL layout the
  // sample does not describe — the halo alone carries it.
  const plusInk = useMemo(() => {
    const corner = cornerForGlyph(movie.backdrop_corner_rgb ?? movie.backdropCornerRgb, isRTL());
    if (!backdropUri || !corner) return tc.cardMeta;
    return pickPlusInk(corner, CARD_STOCK_RGB[scheme]);
  }, [movie.backdrop_corner_rgb, movie.backdropCornerRgb, backdropUri, tc.cardMeta, scheme]);

  return (
    <TouchableOpacity
      style={s.card}
      onPress={onPress}
      onPressIn={() => prefetchMovieImages(movie)}
      activeOpacity={0.9}
    >
      {backdropUri ? (
        <>
          {/* The whole 16:9 frame at card height, trailing-anchored. The
              filter lives on the wrapper because RN's ImageStyle has no
              `filter`; ViewStyle does, and it inherits to children. */}
          <View style={s.backdropWrap} pointerEvents="none">
            <Image source={{ uri: backdropUri }} style={s.backdrop} resizeMode="contain" />
          </View>
          <LinearGradient
            colors={EDGE_FADES[scheme].colors}
            locations={EDGE_FADES[scheme].locations}
            start={LEAD}
            end={TRAIL}
            style={s.edgeFade}
            pointerEvents="none"
          />
          <LinearGradient
            colors={SCRIMS[scheme].colors}
            locations={SCRIMS[scheme].locations}
            start={LEAD}
            end={TRAIL}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <LinearGradient
            colors={GOLD_CAST[scheme]}
            start={CAST_START}
            end={CAST_END}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </>
      ) : null}

      <View style={s.row}>
        {/* collapsable={false} keeps the wrapper in the native view tree so
            measureInWindow always returns a real rect — the add-to-reel glyph
            launches its poster flight from this exact node. */}
        <View ref={ringRef as any} collapsable={false}>
          {/* Tappable, with stopPropagation, so the ring explains itself
              without navigating — the pattern AddToReelPlus already uses to
              keep the card's own onPress → MovieDetail everywhere else. A ring
              with no distribution has nothing to explain, so it isn't a
              button at all rather than a button that does nothing. */}
          <TouchableOpacity
            onPress={(e: any) => {
              e?.stopPropagation?.();
              if (share) onRingPress?.(movie, share);
            }}
            disabled={!share || !onRingPress}
            activeOpacity={0.75}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            accessibilityRole={share && onRingPress ? 'button' : undefined}
          >
            <LevelRing share={share} caption={knownCaption} tc={tc} s={s} />
          </TouchableOpacity>
        </View>

        <View style={s.info}>
          <Text style={s.title} numberOfLines={2}>{movie.title}</Text>
          {meta ? <Text style={s.year}>{meta}</Text> : null}
          {rating ? (
            <View style={s.ratingRow}>
              <Text style={s.rating}>{rating}</Text>
              {/* A drawn icon, not the ★ glyph — the glyph falls back to a
                  different font from the digits and sits off the baseline. */}
              <Ionicons name="star" size={9} color={tc.cardMeta} />
            </View>
          ) : null}
        </View>
      </View>

      <View style={s.plusSlot} pointerEvents="box-none">
        <AddToReelPlus movie={movie} flightSourceRef={ringRef} ink={plusInk} />
      </View>
    </TouchableOpacity>
  );
});

// ── Footer: bottom-of-list spinner / end marker ──────────────────────────────
const ListFooter = ({ loadingMore, hasMore, count }: { loadingMore?: boolean; hasMore?: boolean; count: number }) => {
  const { t } = useTranslation();
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
        <Text style={s.footerText}>{t('home:rankedList.endOfLevel')}</Text>
      </View>
    );
  }
  return null;
};

// ── Main component ─────────────────────────────────────────────────────────────
export const RankedMovieList = ({ movies: data, onMoviePress, level, onRingPress, onEndReached, loadingMore, hasMore, onScrollOffset, fillHeight, refreshControl, onScrollBeginDrag, onSwipeAction, emptyMessage, bottomInset = 0 }: Props) => {
  const { t } = useTranslation();
  // Resolved once here, not per cell — see LevelRing's `caption`.
  const knownCaption = t('home:rankedList.knownCaption');
  const bandLabel = useMemo(
    () => (band: string) => t('home:rankedList.filmBand', { band }),
    [t],
  );
  // The lightbox machinery is intact but currently has no trigger: the card
  // that used to open it no longer carries a poster. Kept rather than removed
  // so a future entry point (long-press, detail hand-off) can wire straight
  // back into it.
  const [zoomed, setZoomed] = useState<{ uri: string; title: string } | null>(null);

  // Hydrate the reel store once so the glyph can read membership state
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
          {emptyMessage ?? t('home:rankedList.empty')}
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
          renderItem={({ item }) => {
            const card = (
              <MovieCard
                movie={item}
                onPress={() => onMoviePress(item)}
                level={level}
                onRingPress={onRingPress}
                knownCaption={knownCaption}
                bandLabel={bandLabel}
              />
            );
            const rowId = String(item.id ?? item.movie_id);
            return (
              // No `key` here on purpose. Keying by movie id made every recycled
              // cell a full unmount/remount — ~10 native views, a PanResponder
              // and the animated nodes rebuilt for each card that scrolled in —
              // which is most of what FlashList's recycling exists to avoid.
              // SwipeableRow now takes the identity as `resetKey` and snaps its
              // own drag offset back to 0, so the row is reused and a swiped-off
              // card's backdrop still can't show under the next movie.
              <View style={s.cardSlot}>
                {onSwipeAction ? (
                  <SwipeableRow
                    height={CARD_H}
                    resetKey={rowId}
                    onSwipe={(action) => onSwipeAction(action, item)}
                  >
                    {card}
                  </SwipeableRow>
                ) : (
                  card
                )}
              </View>
            );
          }}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
          contentContainerStyle={{ paddingBottom: bottomInset }}
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
          <Text style={s.lightboxHint}>{t('home:rankedList.tapToClose')}</Text>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

// Theme-independent list chrome. The card itself is themed, so it lives in
// makeStyles below.
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

const plusStyles = StyleSheet.create({
  plus: {
    fontSize: 19,
    lineHeight: 19,
    fontWeight: '400',
  },
});

const makeStyles = (tc: ThemeColors, scheme: 'light' | 'dark') => {
  const isDark = scheme === 'dark';
  return StyleSheet.create({
    card: {
      flex: 1,
      borderRadius: CARD_RADIUS,
      overflow: 'hidden',
      backgroundColor: tc.cardStock,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255,255,255,0.10)' : '#E5DCC4',
      shadowColor: '#000',
      shadowOpacity: isDark ? 0.45 : 0.10,
      shadowRadius: isDark ? 16 : 12,
      shadowOffset: { width: 0, height: isDark ? 6 : 4 },
      elevation: isDark ? 4 : 3,
    },

    backdropWrap: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      end: 0,
      width: BACKDROP_W,
      opacity: BACKDROP_OPACITY,
      // Sepia stays at 0 — the still is neutral, never warm-graded.
      filter: [
        { saturate: 0.7 },
        { contrast: 0.95 },
        { brightness: isDark ? 0.92 : 1.04 },
      ],
    },
    backdrop: { width: '100%', height: '100%' },

    // Fades the image's leading half into the stock, so no hard vertical edge
    // shows where the still begins.
    edgeFade: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      end: EDGE_FADE_W,
      width: EDGE_FADE_W,
    },

    row: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      paddingStart: 14,
      paddingEnd: 12,
      gap: 13,
    },

    ring: {
      width: RING_SIZE,
      height: RING_SIZE,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ringHoleWrap: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ringHole: {
      width: RING_HOLE,
      height: RING_HOLE,
      borderRadius: RING_HOLE / 2,
      backgroundColor: tc.cardStock,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },
    // The percent is the headline now (it was the 9.5pt understudy to the
    // band), so it takes the size the band used to have.
    ringPct: {
      fontFamily: MONO_FAMILY,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: -0.36,
      lineHeight: 12,
      color: tc.cardInk,
    },
    // Small enough to read as a unit label rather than as a second value —
    // it has to fit the 36pt hole in every locale, hence numberOfLines={1}.
    ringCaption: {
      fontFamily: MONO_FAMILY,
      fontSize: 6.5,
      fontWeight: '700',
      letterSpacing: 0.65,
      lineHeight: 8,
      color: tc.cardMeta,
    },

    // paddingEnd clears the add glyph in the trailing corner.
    info: {
      flex: 1,
      paddingEnd: 30,
    },

    title: {
      fontFamily: SERIF_FAMILY,
      fontSize: 16,
      fontWeight: '700',
      letterSpacing: -0.16,
      lineHeight: 18,
      color: tc.cardInk,
    },
    year: {
      fontFamily: MONO_FAMILY,
      fontSize: 8.5,
      fontWeight: '700',
      letterSpacing: 0.85,
      marginTop: 7,
      color: tc.cardMeta,
    },
    ratingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 3,
    },
    rating: {
      fontFamily: MONO_FAMILY,
      fontSize: 8.5,
      fontWeight: '700',
      letterSpacing: 0.85,
      color: tc.cardMeta,
    },

    plusSlot: {
      position: 'absolute',
      top: 6,
      end: 11,
    },
  });
};
