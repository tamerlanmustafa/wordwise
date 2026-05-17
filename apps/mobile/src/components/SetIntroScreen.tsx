/**
 * SetIntroScreen — preview/preparation screen the user lands on after
 * tapping the active tile in the Journey Reel. The user reads, decides
 * "okay, I'm in," and taps Start. The actual quiz lives in
 * QuizLessonScreen; this screen has exactly two tap targets (Start +
 * back arrow) and never reveals translations, definitions, or scene
 * quotes — those are the reward of the quiz.
 *
 * The spec is web-CSS. Two properties have no faithful RN equivalent
 * without adding a dependency:
 *   - `backdropFilter: blur(10px)` on the chrome → approximated by the
 *     rgba background already in the spec (no native blur lib in tree).
 *   - `filter: saturate(1.2)` on the hero → dropped; `blurRadius` on the
 *     <Image> handles the blur portion.
 */

import { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { cefrColors, cefrLabels } from '../theme/palette';
import type { NodeLevel } from './journey/JourneyNode';

export interface SetIntroWord {
  /** Target word shown verbatim — never blurred or redacted. */
  word: string;
  /** Frequency rank; `null` hides the rank fragment from the meta line. */
  rank: number | null;
  /** When true, render `↻ Review` instead of `NEW`. */
  isReview?: boolean;
}

export interface SetIntroScreenProps {
  setNumber: number;
  reelNumber: number;
  movie: { title: string; poster_path: string | null };
  level: NodeLevel;
  /** Always 5 words — order is fixed by the backend. */
  words: SetIntroWord[];
  /** When true the screen renders in "Review" mode (eyebrow + CTA swap). */
  isReplay?: boolean;
  onBack: () => void;
  onStart: () => void;
}

const HERO_H        = 360;
const STATUS_PAD    = 44;
const GOLD          = '#FFD166';
const BG            = '#0e0d10';
const FALLBACK_DARK = '#221710';

const SERIF_FAMILY = Platform.select({
  ios: 'Georgia',
  android: 'serif',
  default: 'Georgia',
});

export function SetIntroScreen({
  setNumber,
  reelNumber,
  movie,
  level,
  words,
  isReplay = false,
  onBack,
  onStart,
}: SetIntroScreenProps) {
  const levelColor = cefrColors[level] ?? GOLD;
  const levelLabel = cefrLabels[level] ?? level;

  const posterW500 = movie.poster_path
    ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
    : null;
  const posterW185 = movie.poster_path
    ? `https://image.tmdb.org/t/p/w185${movie.poster_path}`
    : null;

  // ─── Row stagger fade-in ─────────────────────────────────────────────
  const rowAnims = useMemo(
    () => words.map(() => new Animated.Value(0)),
    [words],
  );
  useEffect(() => {
    Animated.stagger(
      50,
      rowAnims.map((v) =>
        Animated.timing(v, {
          toValue: 1,
          duration: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ),
    ).start();
  }, [rowAnims]);

  // ─── CTA pulse (2s loop, auto-disable after 10s) ─────────────────────
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (isReplay) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    const stopAt = setTimeout(() => loop.stop(), 10_000);
    return () => {
      clearTimeout(stopAt);
      loop.stop();
    };
  }, [pulse, isReplay]);

  const pulseRadius = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [20, 28],
  });

  // ─── CTA press scale ─────────────────────────────────────────────────
  const ctaScale = useRef(new Animated.Value(1)).current;
  const pressIn = () =>
    Animated.timing(ctaScale, {
      toValue: 0.97,
      duration: 120,
      useNativeDriver: true,
    }).start();
  const pressOut = () =>
    Animated.timing(ctaScale, {
      toValue: 1,
      duration: 120,
      useNativeDriver: true,
    }).start();

  return (
    <SafeAreaView style={styles.root} edges={[]}>
      {/* ── Layer 1: Hero backdrop ─────────────────────────────────── */}
      <View style={styles.hero}>
        {posterW500 ? (
          <Image
            source={{ uri: posterW500 }}
            style={styles.heroImage}
            blurRadius={28}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.heroImage, { backgroundColor: FALLBACK_DARK }]} />
        )}
        <LinearGradient
          colors={[
            'rgba(14,13,16,0.45)',
            'rgba(14,13,16,0.25)',
            'rgba(14,13,16,0.95)',
          ]}
          locations={[0, 0.4, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        {/* ── Layer 3: Source-film card ─────────────────────────────── */}
        <View style={styles.filmCard}>
          {posterW185 ? (
            <Image source={{ uri: posterW185 }} style={styles.filmPoster} />
          ) : (
            <View style={[styles.filmPoster, styles.filmPosterFallback]}>
              <Text style={styles.filmPosterGlyph}>🎬</Text>
            </View>
          )}
          <View style={styles.filmInfo}>
            <Text style={styles.eyebrowGold}>SOURCE FILM</Text>
            <Text style={styles.filmTitle} numberOfLines={2}>
              {movie.title}
            </Text>
            <View style={[styles.cefrPill, { backgroundColor: levelColor }]}>
              <Text style={styles.cefrPillText}>
                {level} · {levelLabel}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* ── Layer 2: Top chrome ────────────────────────────────────── */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={onBack}
        style={({ pressed }) => [
          styles.backBtn,
          { top: STATUS_PAD, opacity: pressed ? 0.7 : 1 },
        ]}
        hitSlop={8}
      >
        <Ionicons name="chevron-back" size={18} color="#fff" />
      </Pressable>
      <View style={[styles.setPill, { top: STATUS_PAD }]}>
        <Text style={styles.setPillText}>
          SET {setNumber} · REEL {reelNumber}
        </Text>
      </View>

      {/* ── Middle content (value-prop + word list) ─────────────────── */}
      <ScrollView
        style={{ flex: 1, marginTop: HERO_H }}
        contentContainerStyle={{ paddingBottom: 14 + 56 + 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Layer 4 — Value-prop strap */}
        <View style={styles.strap}>
          <View style={styles.strapText}>
            <Text style={styles.eyebrowGold}>
              {isReplay ? 'REVIEW SET' : 'PRE-WATCH VOCAB'}
            </Text>
            <Text style={styles.strapHeadline}>
              Learn 5 words from this film
            </Text>
            <Text style={styles.strapSubhead}>
              So when you watch it with subtitles later, you'll actually
              follow every line.
            </Text>
          </View>
          <View style={styles.timePill}>
            <Text style={styles.timePillText}>~2 min</Text>
          </View>
        </View>

        {/* Layer 5 — Word preview list */}
        <View style={styles.wordList}>
          {words.map((w, i) => (
            <Animated.View
              key={`${w.word}-${i}`}
              style={[
                styles.wordRow,
                {
                  opacity: rowAnims[i],
                  transform: [
                    {
                      translateY: rowAnims[i].interpolate({
                        inputRange: [0, 1],
                        outputRange: [6, 0],
                      }),
                    },
                  ],
                },
              ]}
            >
              <View style={styles.indexDisc}>
                <Text style={styles.indexDiscText}>{i + 1}</Text>
              </View>
              <View style={styles.wordCol}>
                <Text style={styles.wordText} numberOfLines={1}>
                  {w.word}
                </Text>
                <Text style={styles.wordMeta}>{formatMeta(w)}</Text>
              </View>
              {w.isReview ? (
                <Text style={styles.reviewChip}>↻ Review</Text>
              ) : (
                <Text style={styles.newChip}>NEW</Text>
              )}
            </Animated.View>
          ))}
        </View>
      </ScrollView>

      {/* ── Layer 6: CTA ────────────────────────────────────────────── */}
      {/* The global bottom bar is rendered by App.tsx outside this
          screen, so the screen's bottom edge already sits flush with the
          top of the nav — `bottom: 14` gives the spec'd gap. */}
      <Animated.View
        style={[
          styles.ctaWrap,
          {
            shadowRadius: isReplay ? 0 : pulseRadius,
            transform: [{ scale: ctaScale }],
          },
        ]}
      >
        <Pressable
          onPressIn={pressIn}
          onPressOut={pressOut}
          onPress={onStart}
          style={[
            styles.ctaBtn,
            isReplay ? styles.ctaBtnReview : styles.ctaBtnPrimary,
          ]}
          accessibilityRole="button"
          accessibilityLabel={isReplay ? 'Review set' : 'Start learning'}
        >
          <Text
            style={[
              styles.ctaText,
              isReplay ? styles.ctaTextReview : styles.ctaTextPrimary,
            ]}
          >
            {isReplay ? 'Review →' : 'Start learning →'}
          </Text>
        </Pressable>
      </Animated.View>

    </SafeAreaView>
  );
}

function formatMeta(w: SetIntroWord): string {
  const letters = `${w.word.length} letters`;
  if (w.rank == null) return letters;
  return `${letters} · rank ${w.rank.toLocaleString()}`;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },

  // Layer 1 — hero
  hero: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: HERO_H,
    overflow: 'hidden',
    backgroundColor: FALLBACK_DARK,
  },
  heroImage: {
    position: 'absolute',
    top: -40,
    left: -40,
    right: -40,
    bottom: -40,
    transform: [{ scale: 1.2 }],
  },

  // Layer 2 — top chrome
  backBtn: {
    position: 'absolute',
    left: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  setPill: {
    position: 'absolute',
    right: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    zIndex: 10,
  },
  setPillText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: '#fff',
  },

  // Layer 3 — source-film card
  filmCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 14,
  },
  filmPoster: {
    width: 92,
    height: 138,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.15)',
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  filmPosterFallback: {
    backgroundColor: FALLBACK_DARK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filmPosterGlyph: {
    fontSize: 32,
    opacity: 0.4,
  },
  filmInfo: {
    flex: 1,
    minWidth: 0,
    paddingBottom: 6,
  },
  filmTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.6,
    lineHeight: 25,
    marginTop: 4,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  cefrPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  cefrPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#fff',
  },

  // Layer 4 — value-prop strap
  strap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 4,
    gap: 12,
  },
  strapText: {
    flex: 1,
    minWidth: 0,
  },
  strapHeadline: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.2,
    marginTop: 2,
  },
  strapSubhead: {
    fontSize: 11,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.55)',
    marginTop: 4,
    lineHeight: 15,
  },
  timePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginTop: 14,
  },
  timePillText: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.6)',
  },

  // Shared eyebrow
  eyebrowGold: {
    fontSize: 10,
    fontWeight: '900',
    color: GOLD,
    letterSpacing: 1.8,
  },

  // Layer 5 — word list
  wordList: {
    paddingHorizontal: 16,
    paddingTop: 12,
    flexDirection: 'column',
    gap: 8,
  },
  wordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  indexDisc: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255,209,102,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  indexDiscText: {
    fontSize: 12,
    fontWeight: '900',
    color: GOLD,
  },
  wordCol: {
    flex: 1,
    minWidth: 0,
  },
  wordText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    fontFamily: SERIF_FAMILY,
    letterSpacing: -0.2,
  },
  wordMeta: {
    fontSize: 10.5,
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 0.3,
    marginTop: 2,
  },
  newChip: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.4)',
  },
  reviewChip: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.6)',
  },

  // Layer 6 — CTA
  ctaWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 14,
    shadowColor: GOLD,
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 8 },
  },
  ctaBtn: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaBtnPrimary: {
    backgroundColor: GOLD,
  },
  ctaBtnReview: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  ctaText: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  ctaTextPrimary: {
    color: '#3a2400',
  },
  ctaTextReview: {
    color: '#fff',
  },

});
