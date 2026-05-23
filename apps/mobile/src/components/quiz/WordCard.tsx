/**
 * WordCard — shared word display used by both quiz card types.
 *
 * Spec: `tabs2/quiz.jsx` word-card block. Radius 18, bg `tc.wordBoxBg`,
 * 1px `tc.border`, soft shadow, centered. The word renders in Source
 * Serif 4 36px (MCQ) or 34px (typing); we expose `size` so callers
 * can pass either. Subtitle is `${pos} · "${example}"` italic — both
 * fields are optional so the card degrades cleanly when the backend
 * payload only ships one of them.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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
}

export function WordCard({ word, pos, example, size = 36 }: WordCardProps) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  // Compose subtitle. We accept either pos or example or both; the
  // separator dot only renders when both are present so we don't
  // emit awkward " · " trailing punctuation.
  const subtitleParts: string[] = [];
  if (pos) subtitleParts.push(`${pos.replace(/\.$/, '')}.`);
  const subtitle = subtitleParts.join('');
  const exampleQuoted = example ? `"${example}"` : '';

  return (
    <View style={s.card}>
      <Text style={[s.word, { fontSize: size }]} allowFontScaling>
        {word}
      </Text>
      {(subtitle || exampleQuoted) ? (
        <Text style={s.subtitle} numberOfLines={3}>
          {subtitle && exampleQuoted ? `${subtitle} ${exampleQuoted}` : subtitle || exampleQuoted}
        </Text>
      ) : null}
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
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
      lineHeight: 0,         // overridden by Text's intrinsic line height
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
