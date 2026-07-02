/**
 * GlobalBottomBar — v0.7 4-tab persistent nav.
 *
 *   Home · My Movies · Practice · Profile
 *
 * Replaces the v0.6 5-tab bar (Home / My Lists / Reel / Rankings /
 * Profile). The Journey/Reel surface is gone; My Lists, Rankings
 * (Leaderboard), Progress, Badges, etc. are reachable from the Profile
 * sheet (UserMenuSheet) — the old HomeScreen menu was removed in this
 * refactor. Icons follow the SVG paths in `tabs/my-movies.jsx → NavIcon`
 * translated to `react-native-svg` (stroke 1.9, 22px, rounded caps).
 *
 * Light/dark: surface + active accent flip via tokens. Active = gold
 * stroke + full-contrast label; inactive = textFaint for both. The
 * Reel-flight landing target (legacy v0.6 add-to-reel animation) is
 * intentionally dropped — the new "+ Add" flows live inside My Movies
 * and the Ready-to-Watch shelf, neither of which fly into the bar.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect, Circle } from 'react-native-svg';
import { useThemeColors, type ThemeColors } from '../theme/tokens';

export type BottomTab = 'home' | 'movies' | 'practice' | 'profile';

interface Props {
  /** Which tab to render as active; `null` when inside a sub-page that
      doesn't belong to a single tab (e.g. movie detail). */
  active: BottomTab | null;
  onTabPress: (tab: BottomTab) => void;
  onLayout?: (height: number) => void;
}

interface TabItem {
  id: BottomTab;
  label: string;
  icon: NavIconKind;
}

type NavIconKind = 'home' | 'film' | 'spark' | 'user';

const TABS: TabItem[] = [
  { id: 'home',     label: 'Home',      icon: 'home' },
  { id: 'movies',   label: 'My Movies', icon: 'film' },
  { id: 'practice', label: 'Practice',  icon: 'spark' },
  { id: 'profile',  label: 'Profile',   icon: 'user' },
];

export function GlobalBottomBar({ active, onTabPress, onLayout }: Props) {
  const insets = useSafeAreaInsets();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  return (
    <View
      style={[
        s.bar,
        {
          // Per CLAUDE_PROMPT.md §1: height 78, paddingBottom 18. Honor
          // the safe-area inset when larger (notched devices).
          paddingBottom: Math.max(18, insets.bottom),
          backgroundColor: tc.tabBg,
          borderTopColor: tc.tabBorder,
        },
      ]}
      onLayout={(e) => onLayout?.(e.nativeEvent.layout.height)}
    >
      {TABS.map((t) => (
        <TabBtn
          key={t.id}
          icon={t.icon}
          label={t.label}
          isActive={active === t.id}
          onPress={() => onTabPress(t.id)}
          tc={tc}
          s={s}
        />
      ))}
    </View>
  );
}

function TabBtn({
  icon,
  label,
  isActive,
  onPress,
  tc,
  s,
}: {
  icon: NavIconKind;
  label: string;
  isActive: boolean;
  onPress: () => void;
  tc: ThemeColors;
  s: ReturnType<typeof makeStyles>;
}) {
  const strokeColor = isActive ? tc.gold : tc.textFaint;
  const labelColor = isActive ? tc.text : tc.textFaint;
  return (
    <TouchableOpacity style={s.btn} onPress={onPress} activeOpacity={0.7}>
      <NavIcon kind={icon} stroke={strokeColor} fillActive={isActive ? tc.gold : undefined} />
      <Text style={[s.label, { color: labelColor }]}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Stroked nav icons — paths copied 1:1 from `tabs/my-movies.jsx →
 *  NavIcon` (the design canvas's source of truth). */
function NavIcon({
  kind,
  stroke,
  fillActive,
}: {
  kind: NavIconKind;
  stroke: string;
  fillActive?: string;
}) {
  const props = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke,
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (kind === 'home') {
    return (
      <Svg {...props}>
        <Path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
      </Svg>
    );
  }
  if (kind === 'film') {
    return (
      <Svg {...props}>
        <Rect x="3" y="4" width="18" height="16" rx="2" />
        <Path d="M3 8h18M3 12h18M3 16h18M8 4v16M16 4v16" />
      </Svg>
    );
  }
  if (kind === 'spark') {
    return (
      <Svg {...props}>
        <Path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
        <Circle cx="12" cy="12" r="3" fill={fillActive ?? 'none'} />
      </Svg>
    );
  }
  // user
  return (
    <Svg {...props}>
      <Circle cx="12" cy="8" r="4" />
      <Path d="M4 21c1.5-4 4.6-6 8-6s6.5 2 8 6" />
    </Svg>
  );
}

const makeStyles = (_tc: ThemeColors) => StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingTop: 8,
    // height is implicit (content + paddingTop + paddingBottom).
    // Per spec: 8 + 22 (icon) + 4 (gap) + ~12 (label) + 18 ≈ 64,
    // bumped to 78 effective on devices with home-bar inset.
    alignItems: 'flex-start',
    justifyContent: 'space-around',
  },
  btn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 4,
  },
  label: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
});
