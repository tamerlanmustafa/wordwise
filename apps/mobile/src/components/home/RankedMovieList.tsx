/**
 * RankedMovieList — one card at a time, iOS notification-stack feel.
 *
 * A fixed-height container shows ONE full card. The top edge of the next
 * card peeks below (PEEK px) to hint there are more. Swiping up on the
 * deck reveals the next card — it grows from a slightly-smaller scale to
 * full size; the current card shrinks as it exits. The parent ScrollView
 * scrolls the rest of the page independently.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  ImageBackground,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors } from '../../theme/palette';
import { TmdbPoster } from '../movies/TmdbPoster';
import { scoreToCefr } from '../../utils/formatting';

// ── Geometry ─────────────────────────────────────────────────────────────────
const CARD_H        = 130;
const CARD_GAP      = 8;     // gap between cards
const VISIBLE_CARDS = 3;
const PEEK          = 72;    // ~half of CARD_H visible as the "incoming" card hint
const ITEM_H        = CARD_H + CARD_GAP;  // 148 — slot height including gap
const CONTAINER_H   = VISIBLE_CARDS * ITEM_H + PEEK;  // 516

// ── Scale / opacity for cards below the fold ─────────────────────────────────
// Cards 0-2 are always full size at rest.
// Card 3 onwards starts at PEEK_SCALE and grows to 1.0 as user scrolls it in.
const PEEK_SCALE   = 0.90;
const PEEK_OPACITY = 0.70;

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
}

// ── Single card with scroll-driven transforms ─────────────────────────────────
const StackCard = React.memo(({
  movie,
  index,
  scrollY,
  onPress,
  onZoom,
}: {
  movie: any;
  index: number;
  scrollY: Animated.Value;
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

  // scrollY = 0         → card 0 is active.  card 1 peeks (PEEK_SCALE)
  // scrollY = CARD_H    → card 1 is active.  card 2 peeks
  // scrollY = n*CARD_H  → card n is active
  // "foldsAt" = the scrollY at which this card becomes fully visible.
  // Cards 0..(VISIBLE_CARDS-1) have foldsAt ≤ 0 → full size at rest.
  // Card VISIBLE_CARDS has foldsAt = CARD_H → peek at rest, full after one scroll.
  // scrollY where this card finishes entering from below → full size.
  const foldsIn  = (index - VISIBLE_CARDS + 1) * ITEM_H;
  // scrollY where this card starts leaving out of the top → shrinks back.
  const foldsOut = index * ITEM_H;

  // Symmetric bell: small → full → full → small
  const scale = scrollY.interpolate({
    inputRange: [
      foldsIn  - ITEM_H,   // arriving from below  → peek scale
      foldsIn,             // fully in window       → full scale
      foldsOut,            // still at top          → full scale
      foldsOut + ITEM_H,   // exiting out of top    → peek scale (mirror)
    ],
    outputRange: [PEEK_SCALE, 1.0, 1.0, PEEK_SCALE],
    extrapolate: 'clamp',
  });

  const opacity = scrollY.interpolate({
    inputRange: [
      foldsIn  - ITEM_H,
      foldsIn,
      foldsOut,
      foldsOut + ITEM_H,
    ],
    outputRange: [PEEK_OPACITY, 1.0, 1.0, PEEK_OPACITY],
    extrapolate: 'clamp',
  });

  // Close the gap on entry. On exit the card is scrolling off-screen so
  // gap closure isn't needed visually.
  const translateY = scrollY.interpolate({
    inputRange: [foldsIn - ITEM_H, foldsIn],
    outputRange: [-(1 - PEEK_SCALE) * CARD_H / 2, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={s.cardSlot}>
      <Animated.View style={[s.cardWrapper, { transform: [{ translateY }, { scale }], opacity }]}>
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
                <View style={s.info}>
                  <Text style={s.title} numberOfLines={2}>{movie.title}</Text>
                  {(rating || level) && (
                    <Text style={s.subText}>{[rating, level].filter(Boolean).join('  •  ')}</Text>
                  )}
                  {wordCount && <Text style={s.wordText}>{wordCount}</Text>}
                </View>
              </View>
            </ImageBackground>
          ) : (
            <View style={[s.backdrop, s.fallback]}>
              <View style={s.row}>
                <View style={[s.poster, s.posterFallback]}><Text>🎬</Text></View>
                <View style={s.info}><Text style={s.title}>{movie.title}</Text></View>
              </View>
            </View>
          )}
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
});

// ── Main component ─────────────────────────────────────────────────────────────
export const RankedMovieList = ({ movies: data, onMoviePress }: Props) => {
  const scrollY  = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<any>(null);
  const [zoomed, setZoomed] = useState<{ uri: string; title: string } | null>(null);

  // Reset to the top whenever the movie list changes (filter/sort switch).
  // Without this, scrollY stays at whatever offset the previous sort left it,
  // making cards render at the wrong scale.
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    scrollY.setValue(0);
  }, [data]);

  if (!data.length) {
    return (
      <Text style={{ textAlign: 'center', color: colors.textSecondary, fontSize: 13, paddingVertical: 16 }}>
        No classified movies found for this level yet.
      </Text>
    );
  }

  const items = data.slice(0, 10);

  return (
    <View>
      {/* Fixed-height container: shows exactly 1 card + PEEK of the next.
          overflow:hidden clips everything else so only 1 card is visible. */}
      <View style={s.container}>
        <Animated.ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          // Snap: each swipe advances exactly one card.
          snapToInterval={ITEM_H}
          snapToAlignment="start"
          decelerationRate="fast"
          // Allow scroll inside the parent HomeScreen ScrollView.
          nestedScrollEnabled
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollY } } }],
            { useNativeDriver: true },
          )}
          // Extra bottom padding so the last card can snap fully to top.
          contentContainerStyle={{ paddingBottom: PEEK }}
        >
          {items.map((item, index) => (
            <StackCard
              key={String(item.id || item.movie_id)}
              movie={item}
              index={index}
              scrollY={scrollY}
              onPress={() => onMoviePress(item)}
              onZoom={(uri, title) => setZoomed({ uri, title })}
            />
          ))}
        </Animated.ScrollView>
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

const POSTER_H = 100;

const s = StyleSheet.create({
  // Clips to exactly one card + the peek strip.
  container: {
    height: CONTAINER_H,
    overflow: 'hidden',
  },

  // Each row = card + gap below it.
  cardSlot: {
    height: ITEM_H,
    paddingBottom: CARD_GAP,
  },

  // The animated wrapper: scale + opacity animate here.
  cardWrapper: {
    flex: 1,
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
