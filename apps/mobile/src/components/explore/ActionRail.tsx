/**
 * ActionRail — the Instagram-style vertical rail on the Explore feed.
 *
 * Bare glyphs on the feed surface: no chip, no border, no background. Each
 * is 56px wide with a small caps-ish label underneath. The rail always acts
 * on the currently snapped card, and it stays tappable while a panel is
 * open — the panel's right edge stops 76px short precisely so this column
 * is never covered.
 *
 * Three items, not four: the design's "Add to list" glyph is absent because
 * the product has no user-created lists to add to (no table, no API). The
 * heart is the real save — it writes the same global `user_words` row the
 * notebook and SRS read, and toggles silently with no toast.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { RailIcon, type RailGlyph } from './ExploreIcons';

interface Props {
  /** Geometry from `exploreMetrics` — the rail scales with the card area
   *  so it never crowds the word on a small phone. */
  height: number;
  bottom: number;
  end: number;
  /** Dominant level from the mix, e.g. "B1" — the mix glyph's label. */
  mixLabel: string;
  mixOpen: boolean;
  saved: boolean;
  onToggleMix: () => void;
  onFavourite: () => void;
  onShare: () => void;
}

export function ActionRail({
  height,
  bottom,
  end,
  mixLabel,
  mixOpen,
  saved,
  onToggleMix,
  onFavourite,
  onShare,
}: Props) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  return (
    <View style={[s.rail, { height, bottom, end }]} pointerEvents="box-none">
      <RailButton
        glyph="sliders"
        size={26}
        label={mixLabel}
        active={mixOpen}
        onPress={onToggleMix}
        tc={tc}
        s={s}
      />
      <RailButton
        glyph="heart"
        size={27}
        label={saved ? 'Saved' : 'Save'}
        active={saved}
        onPress={onFavourite}
        tc={tc}
        s={s}
      />
      <RailButton
        glyph="send"
        size={25}
        label="Share"
        active={false}
        onPress={onShare}
        tc={tc}
        s={s}
      />
    </View>
  );
}

function RailButton({
  glyph,
  size,
  label,
  active,
  onPress,
  tc,
  s,
}: {
  glyph: RailGlyph;
  size: number;
  label: string;
  active: boolean;
  onPress: () => void;
  tc: ThemeColors;
  s: ReturnType<typeof makeStyles>;
}) {
  return (
    <TouchableOpacity
      style={s.item}
      onPress={onPress}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
    >
      <RailIcon
        kind={glyph}
        size={size}
        stroke={active ? tc.gold : tc.text}
        fill={active ? tc.gold : undefined}
      />
      <Text style={s.label} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    rail: {
      position: 'absolute',
      flexDirection: 'column',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    item: {
      width: 56,
      alignItems: 'center',
      gap: 5,
    },
    label: {
      fontSize: 9.5,
      fontWeight: '800',
      color: tc.textFaint,
    },
  });
