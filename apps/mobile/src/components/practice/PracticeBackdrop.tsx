/**
 * PracticeBackdrop — static decorative layer behind the Practice tab.
 *
 * Two large faint dashed rings (echoing the active tile's spinning
 * ring motif) bleed in from the corners, plus a sparse scatter of tiny
 * dots that picks up the path's connector-trail language. Everything
 * is a plain static View — no animation, no SVG, ~10 views total — so
 * the layer costs nothing after first layout.
 *
 * Positioned absolutely behind the header + scroll content and marked
 * pointerEvents="none"; it never intercepts touches and doesn't scroll
 * with the path (a fixed, subtle ambience).
 */

import { StyleSheet, View, type DimensionValue } from 'react-native';
import { useThemeColors } from '../../theme/tokens';

/** Sparse speck field — percent-positioned so it scales across screen
 *  sizes. `gold: true` specks tint gold, the rest stay neutral. */
const SPECKS: Array<{
  left: DimensionValue;
  top: DimensionValue;
  size: number;
  opacity: number;
  gold?: boolean;
}> = [
  { left: '8%',  top: '24%', size: 4, opacity: 0.20, gold: true },
  { left: '88%', top: '30%', size: 3, opacity: 0.22 },
  { left: '13%', top: '43%', size: 3, opacity: 0.16 },
  { left: '90%', top: '52%', size: 4, opacity: 0.16, gold: true },
  { left: '6%',  top: '63%', size: 3, opacity: 0.20 },
  { left: '85%', top: '72%', size: 4, opacity: 0.14 },
  { left: '11%', top: '84%', size: 3, opacity: 0.16, gold: true },
  { left: '92%', top: '90%', size: 3, opacity: 0.18 },
];

export function PracticeBackdrop() {
  const tc = useThemeColors();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[styles.ring, styles.ringTopRight, { borderColor: tc.lessonRing }]} />
      <View style={[styles.ring, styles.ringBottomLeft, { borderColor: tc.lessonRing }]} />
      {SPECKS.map((sp, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: sp.left,
            top: sp.top,
            width: sp.size,
            height: sp.size,
            borderRadius: sp.size / 2,
            backgroundColor: sp.gold ? tc.goldOnSurface : tc.textFaint,
            opacity: sp.opacity,
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    position: 'absolute',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: 999,
  },
  ringTopRight: {
    width: 210,
    height: 210,
    top: 96,
    right: -90,
    opacity: 0.30,
  },
  ringBottomLeft: {
    width: 280,
    height: 280,
    bottom: -70,
    left: -120,
    opacity: 0.22,
  },
});
