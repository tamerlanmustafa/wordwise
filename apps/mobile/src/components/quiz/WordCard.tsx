/**
 * WordCard — the word under test, in a recessed panel.
 *
 * Recessed rather than raised: the answers are the things you press, so they
 * are the tiles that stand up. The word sits *into* the page with an accent
 * hairline along its top edge, which reads as a lit screen you are reading
 * from rather than another button.
 *
 * The chips carry the two facts about the word that are not the word: its CEFR
 * band (solid, from the real ramp) and its part of speech (outlined, quiet).
 * The level chip lives here rather than in the top bar because a Practice deck
 * mixes bands by construction — one level in the header described whichever
 * card happened to be on screen.
 *
 * ## The example sentence has no film
 *
 * It used to be labelled as coming from a movie. Practice words are drawn from
 * due recalls, saved words and fresh words at the reader's level — the deck has
 * no film behind it, so any "in the film" framing was decoration that happened
 * to be false. The sentence keeps its `EXAMPLE` micro-label and highlights the
 * target word inside it, which is the part that actually helps.
 *
 * Note the fonts come from `theme/fonts`. Eleven components in this app used to
 * declare `const SERIF_FAMILY = 'Source Serif 4'` locally — a family the app
 * has never loaded, so every one of them silently rendered in the platform
 * sans. This file was one of them.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { cefrColors } from '../../theme/palette';
import { useThemeColors, withAlpha, type ThemeColors } from '../../theme/tokens';
import { MONO_FAMILY, SERIF_FAMILY, SERIF_ITALIC_FAMILY } from '../../theme/fonts';
import { splitAroundWord } from './wordCardText';

export interface WordCardProps {
  word: string;
  /** Optional part-of-speech label (e.g. "verb"). Hidden when absent. */
  pos?: string | null;
  /** Optional example sentence. Not from a film — see the docblock. */
  example?: string | null;
  /** 42 by default; callers can shrink it for longer words. */
  size?: number;
  /** This word's CEFR band. Hidden when absent or off the ramp. */
  level?: string | null;
}

export function WordCard({ word, pos, example, size = 42, level }: WordCardProps) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const band = level && level in cefrColors ? level : null;
  const posLabel = pos ? pos.replace(/\.$/, '') : null;
  const parts = useMemo(
    () => (example ? splitAroundWord(example, word) : null),
    [example, word],
  );

  return (
    <LinearGradient
      colors={[tc.quizRecessedTop, tc.quizRecessedBottom]}
      style={s.card}
    >
      {/* The lit top edge. A border on the card would paint all four sides;
          this is one hairline, which is what makes it read as light falling on
          the panel rather than as a frame around it. */}
      <View style={[s.litEdge, { backgroundColor: withAlpha(tc.gold, 0.3) }]} />

      {band || posLabel ? (
        <View style={s.chips}>
          {band ? (
            <View style={[s.levelChip, { backgroundColor: cefrColors[band] }]}>
              <Text style={s.levelChipText}>{band}</Text>
            </View>
          ) : null}
          {posLabel ? (
            <View style={[s.posChip, { borderColor: tc.divider }]}>
              <Text style={s.posChipText}>{posLabel}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <Text style={[s.word, { fontSize: size }]} allowFontScaling numberOfLines={2}>
        {word}
      </Text>

      {example ? (
        <>
          <View style={[s.divider, { backgroundColor: tc.divider }]} />
          <Text style={[s.exampleLabel, { color: withAlpha(tc.gold, 0.6) }]}>EXAMPLE</Text>
          <Text style={s.example} numberOfLines={4}>
            {parts ? (
              <>
                {parts.before}
                <Text style={s.exampleTarget}>{parts.match}</Text>
                {parts.after}
              </>
            ) : (
              example
            )}
          </Text>
        </>
      ) : null}
    </LinearGradient>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    card: {
      marginVertical: 14,
      paddingHorizontal: 20,
      paddingVertical: 22,
      borderRadius: 20,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tc.divider,
      alignItems: 'center',
      overflow: 'hidden',
    },
    litEdge: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 1,
    },
    chips: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      marginBottom: 12,
    },
    // Solid CEFR fill with dark ink — the ramp's yellows are far too light to
    // carry white text.
    levelChip: {
      paddingHorizontal: 9,
      paddingVertical: 3,
      borderRadius: 999,
    },
    levelChipText: {
      fontFamily: MONO_FAMILY,
      fontSize: 10.5,
      fontWeight: '900',
      letterSpacing: 0.8,
      color: tc.cefrChipInk,
    },
    posChip: {
      paddingHorizontal: 9,
      paddingVertical: 3,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
    },
    posChipText: {
      fontFamily: MONO_FAMILY,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: tc.textSecondary,
    },
    word: {
      fontFamily: SERIF_FAMILY,
      fontWeight: '600',
      letterSpacing: -1,
      textAlign: 'center',
      color: tc.text,
    },
    divider: {
      alignSelf: 'stretch',
      height: StyleSheet.hairlineWidth,
      marginTop: 18,
      marginBottom: 14,
    },
    exampleLabel: {
      fontFamily: MONO_FAMILY,
      fontSize: 8.5,
      fontWeight: '800',
      letterSpacing: 2.2,
      marginBottom: 7,
    },
    example: {
      fontFamily: SERIF_ITALIC_FAMILY,
      fontStyle: 'italic',
      fontSize: 15,
      lineHeight: 22,
      textAlign: 'center',
      color: tc.textSecondary,
    },
    // A wash rather than a colour swap: the word stays readable prose and the
    // highlight sits behind it, so the sentence still reads as a sentence.
    exampleTarget: {
      color: tc.goldOnSurface,
      backgroundColor: withAlpha(tc.gold, 0.16),
      fontWeight: '700',
    },
  });
