/**
 * GlobalBottomBar — v0.8 5-tab persistent nav.
 *
 *   Home · Explore · Practice · Lists · Profile
 *
 * Lists joins the bar as the fourth tab: the one place a user finds
 * everything they have kept, films and words alike. It also gives the reel
 * back a home of its own — the reel had been demoted to the Profile sheet
 * when the Explore word feed took position 2, and `Saved from Home` inside
 * the Lists tab is now where it lives.
 *
 * Icons follow the SVG paths in `tabs/my-movies.jsx → NavIcon` translated to
 * `react-native-svg` (stroke 1.9, 22px, rounded caps).
 *
 * Light/dark: surface + active accent flip via tokens. Active = gold stroke
 * + full-contrast label; inactive = textFaint for both.
 *
 * The reel-flight landing target is live again on this tab. v0.7 dropped it
 * — nothing reported `reelTabRect`, so `PosterFlight` silently discarded
 * every flight — and it is restored here because the reel now has a visible
 * destination in the bar to fly to. Only the Lists cell reports its rect.
 *
 * Width: five cells in the same bar leaves ~66px each at 320pt (SE). Labels
 * are 10px/800 and must not wrap — `__tests__/globalBottomBar.test.ts`
 * pins the label lengths that fit.
 */

import { useCallback, useMemo, useRef } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, type View as RNView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../theme/tokens';
import { useFlightStore } from '../stores/flightStore';

export type BottomTab = 'home' | 'explore' | 'practice' | 'lists' | 'profile';

interface Props {
  /** Which tab to render as active; `null` when inside a sub-page that
      doesn't belong to a single tab (e.g. movie detail). */
  active: BottomTab | null;
  onTabPress: (tab: BottomTab) => void;
  onLayout?: (height: number) => void;
}

interface TabItem {
  id: BottomTab;
  /** Key under `common:nav`. */
  labelKey: 'home' | 'explore' | 'practice' | 'lists' | 'profile';
  icon: NavIconKind;
}

type NavIconKind = 'home' | 'explore' | 'spark' | 'list' | 'user';

// Labels live in `common:nav.*` and are resolved at render — this array is
// module-level, so a literal label here would freeze at the launch language.
export const TABS: TabItem[] = [
  { id: 'home',     labelKey: 'home',     icon: 'home' },
  { id: 'explore',  labelKey: 'explore',  icon: 'explore' },
  { id: 'practice', labelKey: 'practice', icon: 'spark' },
  { id: 'lists',    labelKey: 'lists',    icon: 'list' },
  { id: 'profile',  labelKey: 'profile',  icon: 'user' },
];

export function GlobalBottomBar({ active, onTabPress, onLayout }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const setReelTabRect = useFlightStore((st) => st.setReelTabRect);

  // The reel lives in Lists, so that cell is where a saved poster flies.
  // measureInWindow (not onLayout's local rect) because PosterFlight is an
  // absolute-fill overlay at the root and needs window coordinates.
  const listsRef = useRef<RNView | null>(null);
  const measureListsTab = useCallback(() => {
    listsRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) setReelTabRect({ x, y, width, height });
    });
  }, [setReelTabRect]);

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
      {TABS.map((tab) => (
        <TabBtn
          key={tab.id}
          icon={tab.icon}
          label={t(`nav.${tab.labelKey}`)}
          isActive={active === tab.id}
          onPress={() => onTabPress(tab.id)}
          tc={tc}
          s={s}
          viewRef={tab.id === 'lists' ? listsRef : undefined}
          onMeasure={tab.id === 'lists' ? measureListsTab : undefined}
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
  viewRef,
  onMeasure,
}: {
  icon: NavIconKind;
  label: string;
  isActive: boolean;
  onPress: () => void;
  tc: ThemeColors;
  s: ReturnType<typeof makeStyles>;
  viewRef?: React.MutableRefObject<RNView | null>;
  onMeasure?: () => void;
}) {
  const strokeColor = isActive ? tc.gold : tc.textFaint;
  const labelColor = isActive ? tc.text : tc.textFaint;
  return (
    <TouchableOpacity
      ref={viewRef}
      style={s.btn}
      onPress={onPress}
      activeOpacity={0.7}
      onLayout={onMeasure}
    >
      <NavIcon kind={icon} stroke={strokeColor} fillActive={isActive ? tc.gold : undefined} />
      <Text
        style={[s.label, { color: labelColor }]}
        numberOfLines={1}
        // Five cells leave ~66px each at 320pt. Shrink rather than wrap or
        // clip — a two-line label would break the bar's fixed height, and
        // the floor keeps it above the 9px legibility limit.
        adjustsFontSizeToFit
        minimumFontScale={0.9}
      >
        {label}
      </Text>
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
  if (kind === 'explore') {
    // Magnifier with a plus — "find new words", not "search the catalogue".
    return (
      <Svg {...props}>
        <Circle cx="11" cy="11" r="7" />
        <Path d="M21 21l-4.3-4.3M11 8v6M8 11h6" />
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
  if (kind === 'list') {
    // Three rules with leading dots — a list of kept things, distinct from
    // the magnifier (Explore) and the home roof.
    return (
      <Svg {...props}>
        <Circle cx="4.5" cy="7" r="1.15" fill={stroke} stroke="none" />
        <Circle cx="4.5" cy="12" r="1.15" fill={stroke} stroke="none" />
        <Circle cx="4.5" cy="17" r="1.15" fill={stroke} stroke="none" />
        <Path d="M9 7h11M9 12h11M9 17h11" />
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
