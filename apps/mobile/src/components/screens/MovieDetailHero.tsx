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
import { withTap } from '../../utils/feedback';
import { SERIF_FAMILY, MONO_FAMILY } from '../../theme/fonts';
import { directionalIcon } from '../../i18n/rtl';
import { movieTitleTier } from '../vocabulary/cardLayout';
import { cefrColorFor, cefrRampFor } from '../../theme/cefrRamp';
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
 * only tints the top of the screen, and the title is ink on paper like the
 * flashcards.
 *
 * There is no poster. It was the single full-colour object on the screen and
 * that was the problem: a piece of film artwork out-shouts every word on a
 * page whose subject is one word, so the eye landed on it first on every
 * open. The backdrop wash says which film this is without competing — it is
 * behind the type rather than beside it — and the title says it in words. The
 * 24pt the poster's block was taller than the title needs went to the deck.
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

export interface MovieDetailHeroProps {
  backdropPath?: string | null;
  title: string;
  /** CEFR band for the film, e.g. 'B2'. Null drops the whole meta line — it is
   *  the only thing on it, the star rating and the dialogue-word count having
   *  been cut: this screen grades a film for a learner, and a crowd's 0–10 and
   *  a raw token count are neither that grade nor anything to act on. */
  level?: string | null;
  /** 0–100 match. Rendered only alongside `level`. */
  matchPct?: number | null;
  onBack: () => void;
  style?: StyleProp<ViewStyle>;
}

export const MovieDetailHero = ({
  backdropPath,
  title,
  level,
  matchPct,
  onBack,
  style,
}: MovieDetailHeroProps) => {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const scheme = useColorScheme();
  const s = useMemo(() => makeStyles(tc, scheme), [tc, scheme]);

  const tier = movieTitleTier(title);
  const bandColor = cefrColorFor(level ?? '', cefrRampFor(tc));

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
            onPress={withTap(onBack)}
            hitSlop={{ top: 5, bottom: 5, left: 5, right: 5 }}
            style={({ pressed }) => [s.backBtn, pressed && s.backBtnPressed]}
          >
            <Ionicons name={directionalIcon('chevron-back')} size={18} color={s.chevron.color} />
          </Pressable>
        </View>

        {/* c · the film, on the backdrop: its band, then its name.
            Band mark above the subject is how every card in this app is laid
            out — the word feed's card, the deck's card — so the screen's own
            header now reads the same way as the things inside it. It used to
            be one mono line under the title spelling "C1 72%", which made a
            level and a match rate look like a single value. */}
        <View style={s.plate}>
          <View style={s.titleCol}>
            {level ? (
              <View style={s.metaRow}>
                {/* The band's own colour, from the shared ramp — the same
                    chip the deck's card wears below, so a level is one colour
                    everywhere on the screen and not just within one block. */}
                <View style={[s.levelChip, { backgroundColor: `${bandColor}22` }]}>
                  <Text style={[s.levelChipText, { color: bandColor }]}>{level}</Text>
                </View>
                {matchPct != null ? (
                  // Deliberately not in the band's colour: it is a fact about
                  // the reader, not about the film, and colouring it the same
                  // would fold two different measurements into one mark.
                  <Text style={s.matchPct}>{`${Math.round(matchPct)}%`}</Text>
                ) : null}
              </View>
            ) : null}
            <Text
              style={[s.title, { fontSize: tier.fontSize, lineHeight: tier.lineHeight }]}
              numberOfLines={tier.lines}
              ellipsizeMode="tail"
            >
              {title}
            </Text>
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
    // A block, not a row: the poster that sat beside the title is gone, so
    // there is nothing to lay out against. Bottom-aligned as before, so a
    // one-line title sits on the same baseline a two-line one ends on and
    // the meta line never moves between films.
    plate: {
      justifyContent: 'flex-end',
      marginTop: HERO_PLATE.gap,
      height: HERO_PLATE.height,
    },
    titleCol: {
      paddingBottom: 4,
    },
    title: {
      fontFamily: SERIF_FAMILY,
      fontWeight: '700',
      letterSpacing: -0.4,
      color: tc.text,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 7,
    },
    // The deck card's chip, at the deck card's proportions — same fill rule
    // (the band at 22 hex alpha), same mono code on top.
    levelChip: {
      paddingVertical: 2,
      paddingHorizontal: 7,
      borderRadius: 5,
    },
    levelChipText: {
      fontFamily: MONO_FAMILY,
      fontSize: 10.5,
      fontWeight: '900',
      letterSpacing: 1,
    },
    matchPct: {
      fontFamily: MONO_FAMILY,
      fontSize: 10.5,
      fontWeight: '700',
      letterSpacing: 0.6,
      color: tc.textSecondary,
    },
  });
};
