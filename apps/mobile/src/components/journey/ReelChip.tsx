/**
 * ReelChip — small left-margin marker between CEFR groups on the
 * Journey Reel. Pinned to the left so it can't collide with the
 * zigzag tile bodies; appears 28px above the top tile of each level.
 */

import { StyleSheet, Text, View } from 'react-native';

import type { NodeLevel } from './JourneyNode';

const CEFR_COLOR: Record<NodeLevel, string> = {
  A1: '#4CAF50',
  A2: '#8BC34A',
  B1: '#FFC107',
  B2: '#FF9800',
  C1: '#F44336',
  C2: '#9C27B0',
};

interface Props {
  reelN: number;
  level: NodeLevel;
  /** Top y position within the parent (already includes the -28px offset). */
  top: number;
  /** All tiles in this level group are completed. */
  completed?: boolean;
  /** All tiles in this level group are locked. */
  locked?: boolean;
}

export function ReelChip({ reelN, level, top, completed, locked }: Props) {
  const accent = CEFR_COLOR[level] ?? CEFR_COLOR.A1;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.chip,
        {
          top,
          borderColor: accent + '66',
          opacity: locked ? 0.45 : 1,
        },
      ]}
    >
      <Text style={[styles.reelLabel, { color: accent }]}>{`REEL ${reelN}`}</Text>
      <Text style={styles.divider}>{` · ${level}`}</Text>
      {completed ? <Text style={styles.trophy}> 🏆</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    position: 'absolute',
    left: 4,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  reelLabel: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 2,
  },
  divider: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
  },
  trophy: {
    fontSize: 10,
  },
});
