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
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { getFormattingLocale } from '../i18n';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { cefrColors } from '../theme/palette';
import { useThemeColors, useColorScheme, type ThemeColors } from '../theme/tokens';
import type { NodeLevel } from './journey/JourneyNode';
import { directionalIcon } from '../i18n/rtl';
import { FilmIcon } from './ui/icons';
import { useBottomBarInset } from '../hooks/useBottomBarInset';

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

const SERIF_FAMILY = Platform.select({
  ios: 'Georgia',
  android: 'serif',
  default: 'Georgia',
});

// Hero overlay gradient — flips per mode.
const HERO_GRADIENT_DARK = [
  'rgba(14,13,16,0.45)',
  'rgba(14,13,16,0.25)',
  'rgba(14,13,16,0.95)',
] as const;
const HERO_GRADIENT_LIGHT = [
  'rgba(237,232,245,0.35)',
  'rgba(237,232,245,0.20)',
  'rgba(237,232,245,0.92)',
] as const;

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
  // The tab bar is an absolute overlay, so every scroller reserves its height
  // itself or its last rows sit behind the floating capsule.
  const barInset = useBottomBarInset();
  const { t } = useTranslation();
  const tc = useThemeColors();
  const scheme = useColorScheme();
  const s = useMemo(() => makeStyles(tc, scheme), [tc, scheme]);
  const levelColor = cefrColors[level] ?? tc.gold;
  const levelLabel = t(`cefr.${level}`, { defaultValue: level });

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
    <SafeAreaView style={s.root} edges={[]}>
      {/* ── Layer 1: Hero backdrop ─────────────────────────────────── */}
      <View style={s.hero}>
        {posterW500 ? (
          <Image
            source={{ uri: posterW500 }}
            style={s.heroImage}
            blurRadius={28}
            resizeMode="cover"
          />
        ) : (
          <View style={[s.heroImage, { backgroundColor: tc.reelStockDeep }]} />
        )}
        <LinearGradient
          colors={scheme === 'dark' ? [...HERO_GRADIENT_DARK] : [...HERO_GRADIENT_LIGHT]}
          locations={[0, 0.4, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        {/* ── Layer 3: Source-film card ─────────────────────────────── */}
        <View style={s.filmCard}>
          {posterW185 ? (
            <Image source={{ uri: posterW185 }} style={s.filmPoster} />
          ) : (
            <View style={[s.filmPoster, s.filmPosterFallback]}>
              <FilmIcon size={30} />
            </View>
          )}
          <View style={s.filmInfo}>
            <Text style={s.eyebrowGold}>{t('onboarding:setIntro.sourceFilm')}</Text>
            <Text style={s.filmTitle} numberOfLines={2}>
              {movie.title}
            </Text>
            <View style={[s.cefrPill, { backgroundColor: levelColor }]}>
              <Text style={s.cefrPillText}>
                {level} · {levelLabel}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* ── Layer 2: Top chrome ────────────────────────────────────── */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('action.back')}
        onPress={onBack}
        style={({ pressed }) => [
          s.backBtn,
          { top: STATUS_PAD, opacity: pressed ? 0.7 : 1 },
        ]}
        hitSlop={8}
      >
        <Ionicons name={directionalIcon('chevron-back')} size={18} color="#fff" />
      </Pressable>
      <View style={[s.setPill, { top: STATUS_PAD }]}>
        <Text style={s.setPillText}>
          {t('onboarding:setIntro.setReel', { set: setNumber, reel: reelNumber })}
        </Text>
      </View>

      {/* ── Middle content (value-prop + word list) ─────────────────── */}
      <ScrollView
        style={{ flex: 1, marginTop: HERO_H }}
        contentContainerStyle={{ paddingBottom: barInset + 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Layer 4 — Value-prop strap */}
        <View style={s.strap}>
          <View style={s.strapText}>
            <Text style={s.eyebrowGold}>
              {isReplay ? t('onboarding:setIntro.eyebrowReview') : t('onboarding:setIntro.eyebrowPreWatch')}
            </Text>
            <Text style={s.strapHeadline}>{t('onboarding:setIntro.headline')}</Text>
            <Text style={s.strapSubhead}>{t('onboarding:setIntro.subhead')}</Text>
          </View>
          <View style={s.timePill}>
            <Text style={s.timePillText}>{t('onboarding:setIntro.duration')}</Text>
          </View>
        </View>

        {/* Layer 5 — Word preview list */}
        <View style={s.wordList}>
          {words.map((w, i) => (
            <Animated.View
              key={`${w.word}-${i}`}
              style={[
                s.wordRow,
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
              <View style={s.indexDisc}>
                <Text style={s.indexDiscText}>{i + 1}</Text>
              </View>
              <View style={s.wordCol}>
                <Text style={s.wordText} numberOfLines={1}>
                  {w.word}
                </Text>
                <Text style={s.wordMeta}>{formatMeta(w, t)}</Text>
              </View>
              {w.isReview ? (
                <Text style={s.reviewChip}>↻ Review</Text>
              ) : (
                <Text style={s.newChip}>NEW</Text>
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
          s.ctaWrap,
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
            s.ctaBtn,
            isReplay ? s.ctaBtnReview : s.ctaBtnPrimary,
          ]}
          accessibilityRole="button"
          accessibilityLabel={isReplay ? t('onboarding:setIntro.a11yReview') : t('onboarding:setIntro.a11yStart')}
        >
          <Text
            style={[
              s.ctaText,
              isReplay ? s.ctaTextReview : s.ctaTextPrimary,
            ]}
          >
            {isReplay ? t('onboarding:setIntro.ctaReview') : t('onboarding:setIntro.ctaStart')}
          </Text>
        </Pressable>
      </Animated.View>

    </SafeAreaView>
  );
}

function formatMeta(w: SetIntroWord, t: TFunction): string {
  const letters = t('onboarding:setIntro.letters', { count: w.word.length });
  if (w.rank == null) return letters;
  return t('onboarding:setIntro.lettersWithRank', {
    letters,
    rank: w.rank.toLocaleString(getFormattingLocale()),
  });
}

const makeStyles = (tc: ThemeColors, scheme: 'light' | 'dark') => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tc.background,
  },

  // Layer 1 — hero
  hero: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: HERO_H,
    overflow: 'hidden',
    backgroundColor: tc.reelStockDeep,
  },
  heroImage: {
    position: 'absolute',
    top: -40,
    left: -40,
    right: -40,
    bottom: -40,
    transform: [{ scale: 1.2 }],
  },

  // Layer 2 — top chrome. The blurred-poster hero is dark-ish in both
  // modes thanks to the overlay; keep the chrome dark-translucent so
  // the white icons remain readable.
  backBtn: {
    position: 'absolute',
    start: 16,
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
    end: 16,
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
    backgroundColor: tc.reelStockDeep,
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

  // Layer 4 — value-prop strap (over `tc.background`, post-hero)
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
    color: tc.text,
    letterSpacing: -0.2,
    marginTop: 2,
  },
  strapSubhead: {
    fontSize: 11,
    fontWeight: '400',
    color: tc.textSecondary,
    marginTop: 4,
    lineHeight: 15,
  },
  timePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: tc.paper,
    borderWidth: 1,
    borderColor: tc.border,
    marginTop: 14,
  },
  timePillText: {
    fontSize: 11,
    fontWeight: '700',
    color: tc.textSecondary,
  },

  // Shared eyebrow — gold over the dark hero (filmCard) AND over the
  // post-hero light surface (strap). goldOnSurface stays legible on both.
  eyebrowGold: {
    fontSize: 10,
    fontWeight: '900',
    color: tc.goldOnSurface,
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
    backgroundColor: tc.paper,
    borderWidth: 1,
    borderColor: tc.border,
  },
  indexDisc: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: tc.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indexDiscText: {
    fontSize: 12,
    fontWeight: '900',
    color: tc.goldOnSurface,
  },
  wordCol: {
    flex: 1,
    minWidth: 0,
  },
  wordText: {
    fontSize: 16,
    fontWeight: '700',
    color: tc.text,
    fontFamily: SERIF_FAMILY,
    letterSpacing: -0.2,
  },
  wordMeta: {
    fontSize: 10.5,
    color: tc.textFaint,
    letterSpacing: 0.3,
    marginTop: 2,
  },
  newChip: {
    fontSize: 10,
    fontWeight: '700',
    color: tc.textFaint,
  },
  reviewChip: {
    fontSize: 10,
    fontWeight: '700',
    color: tc.textSecondary,
  },

  // Layer 6 — CTA. Gold on dark / purple on light per the spec.
  ctaWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 14,
    shadowColor: tc.gold,
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
    backgroundColor: scheme === 'dark' ? tc.gold : tc.primary,
  },
  ctaBtnReview: {
    backgroundColor: tc.paper,
    borderWidth: 1,
    borderColor: tc.border,
  },
  ctaText: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  ctaTextPrimary: {
    color: scheme === 'dark' ? tc.goldDeep : tc.textInverse,
  },
  ctaTextReview: {
    color: tc.text,
  },
});
