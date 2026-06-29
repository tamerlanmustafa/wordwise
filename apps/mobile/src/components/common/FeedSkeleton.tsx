/**
 * FeedSkeleton — loading placeholder for the home ranked feed (Motion §E3).
 * Mirrors a RankedMovieList row (poster + title + meta line) with the sheen
 * Skeleton primitive and a small per-row stagger so it reads as "almost there"
 * rather than a dead spinner. Honors reduce-motion via the primitive.
 */

import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { Skeleton } from '../ui/Skeleton';

export interface FeedSkeletonProps {
  /** Number of placeholder rows. Defaults to 4. */
  rows?: number;
}

export function FeedSkeleton({ rows = 4 }: FeedSkeletonProps) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  return (
    <View style={s.container}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={s.row}>
          <Skeleton width={64} height={96} radius={10} sheen delay={i * 70} />
          <View style={s.info}>
            <Skeleton width="70%" height={16} radius={5} sheen delay={i * 70 + 40} />
            <Skeleton width="40%" height={12} radius={5} sheen delay={i * 70 + 80} style={{ marginTop: 10 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    container: { paddingHorizontal: 16, paddingTop: 8, gap: 16 },
    row: { flexDirection: 'row', gap: 14, alignItems: 'center' },
    info: { flex: 1, minWidth: 0, paddingVertical: 8, backgroundColor: tc.background },
  });
