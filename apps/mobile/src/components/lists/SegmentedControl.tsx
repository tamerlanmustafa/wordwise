/**
 * SegmentedControl — the Films / Words switch at the top of the Lists index.
 *
 * Each segment carries its own count in the mono voice, which is the whole
 * point of the control: it answers "how much do I have of each" before the
 * user taps anything. Selection is persisted by the store, so the tab
 * reopens where the user left it.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { METRICS, listName, metaText } from './listStyles';

export interface Segment<T extends string> {
  key: T;
  label: string;
  count: number;
}

interface Props<T extends string> {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({ segments, value, onChange }: Props<T>) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  return (
    <View style={s.track}>
      {segments.map((segment) => {
        const selected = segment.key === value;
        return (
          <TouchableOpacity
            key={segment.key}
            style={[s.segment, selected && s.segmentSelected]}
            onPress={() => onChange(segment.key)}
            activeOpacity={0.8}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
          >
            <Text
              style={[s.label, { color: selected ? tc.text : tc.textFaint }]}
              numberOfLines={1}
            >
              {segment.label}
            </Text>
            <Text style={[s.count, { color: selected ? tc.textSecondary : tc.textFaint }]}>
              {segment.count}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  track: {
    flexDirection: 'row',
    height: METRICS.segmentH,
    borderRadius: METRICS.segmentRadius,
    backgroundColor: tc.chipBg,
    padding: METRICS.segmentPad,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: METRICS.segmentThumbRadius,
  },
  segmentSelected: {
    backgroundColor: tc.segmentThumb,
  },
  label: {
    ...listName,
    fontSize: 14.5,
  },
  count: {
    ...metaText,
  },
});
