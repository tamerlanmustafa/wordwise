/**
 * QuizHeader — shared top chrome for both quiz card types.
 *
 * Spec: `tabs2/quiz.jsx → QuizHeader`.
 *
 * Layout (top → bottom):
 *   Total 62px from device top to first row (clears dynamic island).
 *   Parents wrap in `SafeAreaView edges={['top']}` so `insets.top` is
 *   already applied above us; we add `max(12, 62 - insets.top)` to
 *   reach the canvas value on every device.
 *   ─ Row: 36×36 round back · centered movie chip (CEFR badge +
 *      title in serif) · 36×36 round N/total counter (monospace).
 *   ─ 4px gold progress bar at `index/total` fill.
 */

import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { cefrColors } from '../../theme/palette';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';

// Spec §7: 62px total clearance from the device top to the first row.
// Parents wrap in `SafeAreaView edges={['top']}`, which already pushes
// content down by `insets.top`. We add whatever's needed to reach 62.
const HEADER_TOP_TARGET = 62;

const SERIF_FAMILY = 'Source Serif 4';
const MONO_FAMILY = 'JetBrains Mono';

export interface QuizHeaderProps {
  /** Movie title for the center chip. */
  movie: string;
  /** CEFR level for the mini-badge inside the chip. */
  level?: keyof typeof cefrColors | null;
  /** 1-indexed position in the card stack. */
  index: number;
  /** Total card count. */
  total: number;
  onBack: () => void;
}

export function QuizHeader({ movie, level, index, total, onBack }: QuizHeaderProps) {
  const tc = useThemeColors();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const pct = Math.max(0, Math.min(100, total > 0 ? (index / total) * 100 : 0));
  const cefrColor = level ? cefrColors[level] : tc.gold;
  // Clears the dynamic island on every device. Floor at 12 so non-notch
  // devices (where insets.top can be 20) still get breathing room.
  const extraTop = Math.max(12, HEADER_TOP_TARGET - insets.top);

  return (
    <View>
      {/* Top row: back · movie chip · counter */}
      <View style={[s.row, { paddingTop: extraTop }]}>
        <Pressable
          onPress={onBack}
          style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.85 }]}
          hitSlop={6}
        >
          <Svg
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke={tc.textSecondary}
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <Path d="M15 6l-6 6 6 6" />
          </Svg>
        </Pressable>

        <View style={s.movieChip}>
          {level ? (
            <View style={[s.cefrMini, { backgroundColor: cefrColor }]}>
              <Text style={s.cefrMiniText}>{level}</Text>
            </View>
          ) : null}
          <Text style={s.movieTitle} numberOfLines={1}>
            {movie}
          </Text>
        </View>

        <View style={s.counter}>
          <Text style={s.counterText}>
            {index}/{total}
          </Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={s.progressWrap}>
        <View style={[s.progressTrack, { backgroundColor: tc.divider }]}>
          <View style={[s.progressFill, { width: `${pct}%`, backgroundColor: tc.gold }]} />
        </View>
      </View>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 18,
      paddingBottom: 12,
      gap: 10,
    },
    iconBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: tc.chipBg,
      borderWidth: 1,
      borderColor: tc.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    movieChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: tc.paper,
      borderWidth: 1.5,
      borderColor: tc.gold,
      maxWidth: 240,
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 2,
    },
    cefrMini: {
      width: 16,
      height: 16,
      borderRadius: 3,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cefrMiniText: {
      color: '#fff',
      fontSize: 8,
      fontWeight: '900',
      letterSpacing: 0.3,
    },
    movieTitle: {
      flexShrink: 1,
      fontFamily: SERIF_FAMILY,
      fontSize: 17,
      fontWeight: '600',
      color: tc.text,
      letterSpacing: -0.3,
    },
    counter: {
      minWidth: 36,
      height: 36,
      paddingHorizontal: 8,
      borderRadius: 18,
      backgroundColor: tc.chipBg,
      borderWidth: 1,
      borderColor: tc.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    counterText: {
      fontFamily: MONO_FAMILY,
      fontSize: 11,
      fontWeight: '900',
      color: tc.textSecondary,
    },
    progressWrap: {
      paddingHorizontal: 18,
      paddingBottom: 14,
    },
    progressTrack: {
      height: 4,
      borderRadius: 999,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      borderRadius: 999,
    },
  });
