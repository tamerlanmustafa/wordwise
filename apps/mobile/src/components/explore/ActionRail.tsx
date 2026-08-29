/**
 * ActionRail — the Instagram-style vertical rail on the Explore feed.
 *
 * Bare glyphs on the feed surface: no chip, no border, no background. Each
 * is 56px wide with a small caps-ish label underneath. The rail always acts
 * on the currently snapped card, and it stays tappable while a panel is
 * open — the panel's right edge stops 76px short precisely so this column
 * is never covered.
 *
 * Four items: level mix, save, add-to-list, share. The list glyph was absent
 * in the first cut because user-created lists did not exist yet; it came back
 * with the Lists tab.
 *
 * Save and list are deliberately different actions. The heart writes the
 * global `user_words` row that the notebook and SRS read, and toggles
 * silently with no toast. Adding to a list is set membership — a word can sit
 * in several at once — and is independent of whether it is saved.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { RailIcon, type RailGlyph } from './ExploreIcons';
import { RAIL_ITEM_WIDTH } from './metrics';

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
  /** How many lists the current word is in — drives the label and fill. */
  listCount: number;
  listOpen: boolean;
  onToggleMix: () => void;
  onFavourite: () => void;
  onToggleList: () => void;
  onShare: () => void;
}

/** `List` → `In list` → `2 lists`. The singular case says where the word is,
 *  not how many — "1 list" reads like a counter rather than a state. */
export function listLabel(count: number): string {
  if (count <= 0) return 'List';
  if (count === 1) return 'In list';
  return `${count} lists`;
}

export function ActionRail({
  height,
  bottom,
  end,
  mixLabel,
  mixOpen,
  saved,
  listCount,
  listOpen,
  onToggleMix,
  onFavourite,
  onToggleList,
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
        glyph="bookmark"
        size={25}
        label={listLabel(listCount)}
        active={listCount > 0 || listOpen}
        onPress={onToggleList}
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
      // Shared with explore/metrics, which centres this column on the last
      // tab and sizes the card's lane around it.
      width: RAIL_ITEM_WIDTH,
      alignItems: 'center',
      gap: 5,
    },
    label: {
      fontSize: 9.5,
      fontWeight: '800',
      color: tc.textFaint,
    },
  });
