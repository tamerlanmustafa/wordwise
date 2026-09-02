/**
 * MoviePreviewHub — the small hub that sits between a Journey Reel
 * tile tap and the two ways the user can engage with that movie:
 *
 *   1. "Study words →"  → MovieDetailScreen (browse, save, mark learned)
 *   2. "Quiz me (5)"    → start a journey session → SetIntro → quiz
 *
 * The hub also exposes "Remove from reel" as a tertiary action so the
 * user can curate their queue without leaving the reel surface.
 *
 * Visual language matches the reel: warm dark stock, gold accents,
 * CEFR-colored pill.
 */

import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
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
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { cefrColors } from '../theme/palette';
import { useThemeColors, type ThemeColors } from '../theme/tokens';
import type { NodeLevel } from './journey/JourneyNode';
import type { ReelTile } from '../services/api';
import { directionalIcon } from '../i18n/rtl';
import { FilmIcon } from './ui/icons';
import { useBottomBarInset } from '../hooks/useBottomBarInset';

export interface MoviePreviewHubProps {
  tile: ReelTile;
  level: NodeLevel;
  onBack: () => void;
  /** Open MovieDetailScreen for this movie. */
  onStudy: () => void;
  /** Start a 5-card journey quiz for this movie. The caller handles
   *  the async session start; we surface a loading state via
   *  `quizStarting`. */
  onQuiz: () => void;
  /** Remove this movie from the reel and return to the reel. */
  onRemove: () => void;
  /** When true, the Quiz CTA renders a spinner and disables further
   *  taps until the journey session has been created. */
  quizStarting?: boolean;
}

const STATUS_PAD    = 44;
const HERO_H        = 320;
const GOLD          = '#FFD166';  // bright gold over the dark poster hero
const FALLBACK_DARK = '#221710';  // hero fill when a poster is missing

const SERIF_FAMILY = Platform.select({
  ios: 'Georgia',
  android: 'serif',
  default: 'Georgia',
});

export function MoviePreviewHub({
  tile,
  level,
  onBack,
  onStudy,
  onQuiz,
  onRemove,
  quizStarting,
}: MoviePreviewHubProps) {
  // The tab bar is an absolute overlay, so every scroller reserves its height
  // itself or its last rows sit behind the floating capsule.
  const barInset = useBottomBarInset();
  const { t } = useTranslation();
  const tc = useThemeColors();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  const levelColor = cefrColors[level] ?? GOLD;
  const levelLabel = t(`cefr.${level}`, { defaultValue: level });

  const posterW500 = tile.poster_path
    ? `https://image.tmdb.org/t/p/w500${tile.poster_path}`
    : null;
  const posterW185 = tile.poster_path
    ? `https://image.tmdb.org/t/p/w185${tile.poster_path}`
    : null;

  // CTA press scale.
  const studyScale = useRef(new Animated.Value(1)).current;
  const quizScale  = useRef(new Animated.Value(1)).current;
  const pressIn = (v: Animated.Value) =>
    Animated.timing(v, { toValue: 0.97, duration: 120, useNativeDriver: true }).start();
  const pressOut = (v: Animated.Value) =>
    Animated.timing(v, { toValue: 1, duration: 120, useNativeDriver: true }).start();

  const [removing, setRemoving] = useState(false);
  const handleRemove = () => {
    Alert.alert(
      t('movies:preview.removeFromReelTitle'),
      t('movies:preview.removeFromReelBody', { title: tile.title }),
      [
        { text: t('action.cancel'), style: 'cancel' },
        {
          text: t('movies:preview.remove'),
          style: 'destructive',
          onPress: () => {
            setRemoving(true);
            onRemove();
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={[]}>
      {/* ── Hero backdrop (blurred poster) ──────────────────────────── */}
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

        {/* Film card — poster + title + CEFR pill */}
        <View style={styles.filmCard}>
          {posterW185 ? (
            <Image source={{ uri: posterW185 }} style={styles.filmPoster} />
          ) : (
            <View style={[styles.filmPoster, styles.filmPosterFallback]}>
              <FilmIcon size={30} />
            </View>
          )}
          <View style={styles.filmInfo}>
            <Text style={styles.eyebrowGold}>{t('movies:preview.inYourReel')}</Text>
            <Text style={styles.filmTitle} numberOfLines={2}>
              {tile.title}
            </Text>
            {tile.year ? (
              <Text style={styles.filmYear}>{tile.year}</Text>
            ) : null}
            <View style={[styles.cefrPill, { backgroundColor: levelColor }]}>
              <Text style={styles.cefrPillText}>
                {level} · {levelLabel}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* ── Top chrome ────────────────────────────────────────────── */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('action.back')}
        onPress={onBack}
        style={({ pressed }) => [
          styles.backBtn,
          { top: STATUS_PAD, opacity: pressed ? 0.7 : 1 },
        ]}
        hitSlop={8}
      >
        <Ionicons name={directionalIcon('chevron-back')} size={18} color="#fff" />
      </Pressable>

      {/* ── Middle: value strap + actions list ─────────────────────── */}
      <ScrollView
        style={{ flex: 1, marginTop: HERO_H }}
        contentContainerStyle={{ paddingBottom: barInset + 24 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.strap}>
          <Text style={styles.eyebrowGoldSurface}>{t('movies:preview.whatsNext')}</Text>
          <Text style={styles.strapHeadline}>
            {t('movies:preview.prepForFilm')}
          </Text>
          <Text style={styles.strapSubhead}>
            Quiz yourself on 5 key words for a quick win, or browse the
            full vocab list and study at your own pace.
          </Text>
        </View>

        {/* ── Action list ─────────────────────────────────────────── */}
        <View style={styles.actionList}>
          <ActionRow
            icon="library-outline"
            title={t('movies:preview.studyAllWords')}
            subtitle={t('movies:preview.studyAllWordsSub')}
            onPress={onStudy}
            styles={styles}
            tc={tc}
          />
          <ActionRow
            icon="trash-outline"
            title={t('movies:preview.removeFromReel')}
            subtitle={removing ? t('movies:preview.removing') : t('movies:preview.removeSubtitle')}
            destructive
            disabled={removing}
            onPress={handleRemove}
            styles={styles}
            tc={tc}
          />
        </View>
      </ScrollView>

      {/* ── Sticky bottom CTAs ─────────────────────────────────────── */}
      <View style={styles.ctaBar}>
        <Animated.View
          style={[
            styles.ctaSlot,
            { transform: [{ scale: studyScale }] },
          ]}
        >
          <Pressable
            onPressIn={() => pressIn(studyScale)}
            onPressOut={() => pressOut(studyScale)}
            onPress={onStudy}
            style={[styles.ctaBtn, styles.ctaBtnSecondary]}
            accessibilityRole="button"
            accessibilityLabel={t('movies:preview.studyWords')}
          >
            <Text style={[styles.ctaText, styles.ctaTextSecondary]}>
              {t('movies:preview.study')}
            </Text>
          </Pressable>
        </Animated.View>
        <Animated.View
          style={[
            styles.ctaSlot,
            { flex: 1.4, transform: [{ scale: quizScale }] },
          ]}
        >
          <Pressable
            disabled={quizStarting}
            onPressIn={() => pressIn(quizScale)}
            onPressOut={() => pressOut(quizScale)}
            onPress={onQuiz}
            style={[
              styles.ctaBtn,
              styles.ctaBtnPrimary,
              quizStarting && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={t('movies:preview.quizMeOn', { count: 5 })}
          >
            {quizStarting ? (
              <ActivityIndicator size="small" color={tc.goldDeep} />
            ) : (
              <Text style={[styles.ctaText, styles.ctaTextPrimary]}>
                {t('movies:preview.quizMe', { count: 5 })}
              </Text>
            )}
          </Pressable>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

function ActionRow({
  icon,
  title,
  subtitle,
  destructive,
  disabled,
  onPress,
  styles,
  tc,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
  styles: Styles;
  tc: ThemeColors;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.actionRow,
        pressed && !disabled && { backgroundColor: tc.divider },
        disabled && { opacity: 0.5 },
      ]}
      android_ripple={{ color: tc.divider }}
    >
      <View
        style={[
          styles.actionIconBox,
          destructive && { backgroundColor: tc.errorTint },
        ]}
      >
        <Ionicons
          name={icon}
          size={18}
          color={destructive ? tc.error : tc.goldOnSurface}
        />
      </View>
      <View style={styles.actionTextCol}>
        <Text
          style={[
            styles.actionTitle,
            destructive && { color: tc.error },
          ]}
        >
          {title}
        </Text>
        <Text style={styles.actionSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Ionicons
        name={directionalIcon('chevron-forward')}
        size={16}
        color={tc.textFaint}
      />
    </Pressable>
  );
}

type Styles = ReturnType<typeof makeStyles>;

const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tc.background,
  },

  // Hero
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

  // Top chrome
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

  // Film card
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
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.6,
    lineHeight: 24,
    marginTop: 4,
    fontFamily: SERIF_FAMILY,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  filmYear: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.6)',
    marginTop: 2,
    letterSpacing: 0.3,
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

  // Strap
  strap: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  strapHeadline: {
    fontSize: 18,
    fontWeight: '800',
    color: tc.text,
    letterSpacing: -0.3,
    marginTop: 4,
  },
  strapSubhead: {
    fontSize: 12.5,
    fontWeight: '400',
    color: tc.textSecondary,
    marginTop: 6,
    lineHeight: 17,
  },

  // Eyebrow — bright gold over the dark poster hero (filmCard)…
  eyebrowGold: {
    fontSize: 10,
    fontWeight: '900',
    color: GOLD,
    letterSpacing: 1.8,
  },
  // …and the readable gold-on-surface variant for the themed strap below it.
  eyebrowGoldSurface: {
    fontSize: 10,
    fontWeight: '900',
    color: tc.goldOnSurface,
    letterSpacing: 1.8,
  },

  // Action list
  actionList: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: tc.paper,
    borderWidth: 1,
    borderColor: tc.border,
  },
  actionIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: tc.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTextCol: {
    flex: 1,
    minWidth: 0,
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: tc.text,
    letterSpacing: -0.2,
  },
  actionSubtitle: {
    fontSize: 11,
    fontWeight: '500',
    color: tc.textSecondary,
    marginTop: 2,
  },

  // Bottom CTA bar
  ctaBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 14,
    flexDirection: 'row',
    gap: 10,
  },
  ctaSlot: {
    flex: 1,
  },
  ctaBtn: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  ctaBtnPrimary: {
    backgroundColor: tc.gold,
    shadowColor: tc.gold,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  ctaBtnSecondary: {
    backgroundColor: tc.paper,
    borderWidth: 1,
    borderColor: tc.border,
  },
  ctaText: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  ctaTextPrimary: {
    color: tc.goldDeep,
  },
  ctaTextSecondary: {
    color: tc.text,
  },
});
