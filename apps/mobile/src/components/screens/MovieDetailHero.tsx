import React, { useMemo } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { useThemeColors, useColorScheme, type ThemeColors } from '../../theme/tokens';
import { SERIF_FAMILY, MONO_FAMILY } from '../../theme/fonts';
import { directionalIcon } from '../../i18n/rtl';
import { movieTitleTier } from '../vocabulary/cardLayout';
import { BACK_ROW, HERO_PLATE } from '../vocabulary/deckMetrics';

/**
 * MovieDetailHero — the movie stated once, in a block that never moves.
 *
 * The title used to live in a header that collapsed on scroll, so the film's
 * identity disappeared after ~40pt of scrolling; that is the whole reason the
 * screen stopped scrolling. It also replaces the 104pt explainer band, which
 * was marketing copy occupying a third of a screen whose real content is one
 * card.
 *
 * No dark photo slab — that clashed with the reading-room cream. The backdrop
 * only tints the top of the screen, the poster is the single full-colour
 * object, and the title is ink on paper like the flashcards.
 *
 * The poster is the artwork and nothing else: it used to sit inside a "physical
 * print" — a cream paper margin, a cut edge, a 1.1° tilt and a drop shadow —
 * which put a second frame around an image that already ships with its own
 * border, and cost 19pt of the fixed column (see HERO_PLATE) for decoration.
 *
 * Three layers, and the wash is a SIBLING of the content rather than its
 * child: it bleeds 232pt down the screen, past the end of this block, and on
 * Android a child is clipped to its parent's bounds. Render this component as
 * a direct child of the screen's root view.
 */

/** How far the backdrop haze reaches down the screen. */
const WASH_HEIGHT = 232;
/** The plain image sits this faint under the gold; RN has no CSS `filter`, so
 *  the mockup's `sepia(.85) saturate(.7)` is approximated by holding the photo
 *  well back and letting a gold overlay do the grading. */
const WASH_IMAGE_OPACITY = 0.24;

const POSTER_W = 68;
const POSTER_H = 100;

export interface MovieDetailHeroProps {
  backdropPath?: string | null;
  posterPath?: string | null;
  title: string;
  /** CEFR band for the film, e.g. 'B2'. Null drops the whole meta line — it is
   *  the only thing on it, the star rating and the dialogue-word count having
   *  been cut: this screen grades a film for a learner, and a crowd's 0–10 and
   *  a raw token count are neither that grade nor anything to act on. */
  level?: string | null;
  /** 0–100 match. Rendered only alongside `level`. */
  matchPct?: number | null;
  onBack: () => void;
  onPosterPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export const MovieDetailHero = ({
  backdropPath,
  posterPath,
  title,
  level,
  matchPct,
  onBack,
  onPosterPress,
  style,
}: MovieDetailHeroProps) => {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const scheme = useColorScheme();
  const s = useMemo(() => makeStyles(tc, scheme), [tc, scheme]);

  const tier = movieTitleTier(title);

  // The film's CEFR band, with the match percentage when we have one. Null
  // until `difficulty` lands, and the line is hidden rather than reserved.
  const metaLine = level
    ? matchPct != null
      ? `${level} ${Math.round(matchPct)}%`
      : level
    : null;

  return (
    <>
      {/* a · the wash — absolute, behind everything, never interactive */}
      {backdropPath ? (
        <View style={s.wash} pointerEvents="none">
          <Image
            source={{ uri: `https://image.tmdb.org/t/p/w780${backdropPath}` }}
            style={s.washImage}
            resizeMode="cover"
          />
          <View style={s.washTint} />
          {/* Fades the haze to nothing in the screen's own background colour.
              An overlay gradient is the cross-platform stand-in for the
              mockup's `mask-image`, which RN does not have. */}
          <LinearGradient
            colors={['transparent', `${tc.background}80`, tc.background]}
            locations={[0, 0.46, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>
      ) : null}

      <View style={[s.content, style]}>
        {/* b · back button — a normal row now, never faded, never disabled */}
        <View style={s.backRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('action.back')}
            onPress={onBack}
            hitSlop={{ top: 5, bottom: 5, left: 5, right: 5 }}
            style={({ pressed }) => [s.backBtn, pressed && s.backBtnPressed]}
          >
            <Ionicons name={directionalIcon('chevron-back')} size={18} color={s.chevron.color} />
          </Pressable>
        </View>

        {/* c · poster + title */}
        <View style={s.plate}>
          <Pressable
            onPress={onPosterPress}
            disabled={!onPosterPress || !posterPath}
            accessibilityRole={onPosterPress && posterPath ? 'button' : undefined}
            accessibilityLabel={onPosterPress && posterPath ? t('movies:detail.viewPoster') : undefined}
          >
            {posterPath ? (
              <Image
                source={{ uri: `https://image.tmdb.org/t/p/w185${posterPath}` }}
                style={s.poster}
                resizeMode="cover"
              />
            ) : (
              <View style={[s.poster, s.posterFallback]}>
                <Text style={s.posterFallbackLetter}>{title.slice(0, 1).toUpperCase()}</Text>
              </View>
            )}
          </Pressable>

          <View style={s.titleCol}>
            <Text
              style={[s.title, { fontSize: tier.fontSize, lineHeight: tier.lineHeight }]}
              numberOfLines={tier.lines}
              ellipsizeMode="tail"
            >
              {title}
            </Text>
            {metaLine ? (
              <Text style={s.metaGold} numberOfLines={1}>
                {metaLine}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </>
  );
};

const makeStyles = (tc: ThemeColors, scheme: 'light' | 'dark') => {
  const light = scheme === 'light';
  return StyleSheet.create({
    wash: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: WASH_HEIGHT,
    },
    washImage: {
      ...StyleSheet.absoluteFillObject,
      opacity: WASH_IMAGE_OPACITY,
    },
    washTint: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: tc.washTint,
    },
    content: {
      paddingHorizontal: 18,
    },
    backRow: {
      height: BACK_ROW.height,
      marginTop: BACK_ROW.gap,
      justifyContent: 'center',
      // Leading edge under RTL, which `alignItems` resolves for us.
      alignItems: 'flex-start',
    },
    backBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: light ? 'rgba(247,240,224,0.78)' : 'rgba(32,28,22,0.66)',
      borderWidth: 1,
      borderColor: light ? '#E0D5BB' : tc.border,
    },
    backBtnPressed: {
      opacity: 0.7,
    },
    // Not a style — a colour the Ionicon reads off, so the palette stays in
    // one place instead of a hex inline in the JSX.
    chevron: {
      color: light ? '#6E5F47' : tc.textSecondary,
    },
    plate: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 14,
      marginTop: HERO_PLATE.gap,
      height: HERO_PLATE.height,
    },
    // The artwork on its own — no paper margin, no cut edge, no tilt, no
    // shadow. HERO_PLATE.height is exactly this, so the frame's 19pt went to
    // the card rather than staying in the column as empty space.
    poster: {
      width: POSTER_W,
      height: POSTER_H,
    },
    posterFallback: {
      backgroundColor: tc.chipBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    posterFallbackLetter: {
      fontFamily: SERIF_FAMILY,
      fontSize: 34,
      fontWeight: '700',
      color: tc.text,
      opacity: 0.18,
    },
    titleCol: {
      flex: 1,
      paddingBottom: 4,
    },
    title: {
      fontFamily: SERIF_FAMILY,
      fontWeight: '700',
      letterSpacing: -0.4,
      color: tc.text,
    },
    metaGold: {
      fontFamily: MONO_FAMILY,
      fontSize: 9.5,
      lineHeight: 13,
      fontWeight: '700',
      letterSpacing: 1.05,
      // 10, not the old 7: it used to hang off a gold rule that carried 9pt of
      // its own space above it, and inheriting only the 7 pulled the band up
      // under the title's descenders.
      marginTop: 10,
      color: tc.goldOnSurface,
    },
  });
};
