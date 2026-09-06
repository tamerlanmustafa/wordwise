/**
 * QuizBackdrop — the quiz's ground.
 *
 * A flat fill, the same `background` the practice path is drawn on, and
 * nothing else.
 *
 * ## What was here
 *
 * A tinted vignette bleeding down from the top edge — accent while answering,
 * green when right, red when wrong — built from three superimposed linear
 * gradients because React Native has no radial one, plus a scanline texture at
 * ~2% for grain.
 *
 * It was a good effect answering the wrong question. The screen's top panel
 * (progress, question count) sits on the flat page colour, and the vignette
 * started immediately below it — so the two read as two surfaces with a seam
 * between them rather than as one screen. A gradient that ends is a line, and
 * on a screen whose whole job is one question that line was the most visible
 * edge on it.
 *
 * The answer states have not lost their voice: the option tiles and the CTA
 * both take the correct/wrong colours, and they are the things the eye is on.
 * The backdrop was saying it a third time, quietly, behind them.
 *
 * The `mood` prop stays. It costs nothing, every caller already passes it, and
 * the day this wants a flat tinted wash rather than a gradient one it is the
 * only thing that would need to exist.
 */

import { StyleSheet, View } from 'react-native';
import { useThemeColors } from '../../theme/tokens';

export type QuizMood = 'neutral' | 'correct' | 'wrong';

export function QuizBackdrop({ mood: _mood = 'neutral' }: { mood?: QuizMood }) {
  const tc = useThemeColors();
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, { backgroundColor: tc.background }]}
    />
  );
}
