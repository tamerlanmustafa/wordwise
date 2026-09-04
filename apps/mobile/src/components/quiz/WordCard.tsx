/**
 * WordCard — shared word display used by both quiz card types.
 *
 * Spec: `tabs2/quiz.jsx` word-card block. Radius 18, bg `tc.wordBoxBg`,
 * 1px `tc.border`, soft shadow, centered. The word renders in Source
 * Serif 4 36px (MCQ) or 34px (typing); we expose `size` so callers
 * can pass either. Subtitle is `${pos} · "${example}"` italic — both
 * fields are optional so the card degrades cleanly when the backend
 * payload only ships one of them.
 *
 * The CEFR chip sits here rather than in `QuizHeader` because the level is a
 * fact about *this word*, and the header is a fact about the session. In a
 * deck that mixes levels — which every Practice deck does, since the server
 * composes it from due recalls, saved words and fresh words at your level —
 * a single level in the top bar was describing whichever card happened to be
 * on screen, and it changed as you answered. Beside the word it is simply
 * true.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { cefrColors } from '../../theme/palette';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';

const SERIF_FAMILY = 'Source Serif 4';

export interface WordCardProps {
  word: string;
  /** Optional part-of-speech label (e.g. "verb"). Hidden when absent. */
  pos?: string | null;
  /** Optional in-movie example sentence — italicized in the subtitle. */
  example?: string | null;
  /** 36 for MCQ headlines, 34 for the longer translation words. Default 36. */
  size?: number;
  /** This word's CEFR band. Hidden when absent or unrecognised — the chip is
   *  only worth drawing when we can colour it from the real ramp. */
  level?: string | null;
}

export function WordCard({ word, pos, example, size = 36, level }: WordCardProps) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const band = level && level in cefrColors ? level : null;

  // Compose `${pos} · "${example}"` per §7. The separator only appears
  // when both halves are present so we don't emit a trailing " · ".
  const posLabel = pos ? `${pos.replace(/\.$/, '')}.` : '';
  const exampleQuoted = example ? `"${example}"` : '';
  const subtitle =
    posLabel && exampleQuoted ? `${posLabel} · ${exampleQuoted}`
    : posLabel || exampleQuoted;

  return (
    <View style={s.card}>
      {band ? (
        <View style={[s.levelChip, { backgroundColor: cefrColors[band] }]}>
          <Text style={s.levelChipText}>{band}</Text>
        </View>
      ) : null}
      <Text style={[s.word, { fontSize: size }]} allowFontScaling>
        {word}
      </Text>
      {subtitle ? (
        <Text style={s.subtitle} numberOfLines={3}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    // Solid CEFR fill with dark ink — the ramp's yellows and greens are far
    // too light to carry white text.
    levelChip: {
      paddingHorizontal: 9,
      paddingVertical: 3,
      borderRadius: 999,
      marginBottom: 10,
    },
    levelChipText: {
      fontSize: 10.5,
      fontWeight: '900',
      letterSpacing: 0.8,
      color: '#1A1206',
    },
    card: {
      marginVertical: 16,
      paddingHorizontal: 20,
      paddingVertical: 28,
      borderRadius: 18,
      backgroundColor: tc.wordBoxBg,
      borderWidth: 1,
      borderColor: tc.border,
      alignItems: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.15,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 3,
    },
    word: {
      fontFamily: SERIF_FAMILY,
      fontWeight: '600',
      color: tc.text,
      letterSpacing: -0.6,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: 12,
      color: tc.textFaint,
      fontStyle: 'italic',
      fontWeight: '600',
      marginTop: 8,
      textAlign: 'center',
      lineHeight: 17,
    },
  });
