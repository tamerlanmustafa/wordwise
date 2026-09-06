/**
 * GlobalBottomBar — v0.9 5-tab persistent nav, Liquid Glass on iOS 26.
 *
 *   Home · Explore · Practice · Lists · Profile
 *
 * On iOS 26 this is a floating Liquid Glass capsule: inset from all three
 * edges, refracting the content that scrolls underneath it, with a gold lens
 * sliding between cells to mark the active tab. Everywhere else — Android, and
 * every iOS below 26 — it is exactly the bar it has always been: full width,
 * pinned, opaque, content stopping above it. That split is deliberate; see
 * `useGlassAvailable` for the three separate conditions and `navBarMetrics`
 * for the two geometries.
 *
 * The bar has a **fixed size** and never retracts or shrinks. It briefly
 * minimized on a downward scroll (iOS 26's `tabBarMinimizeBehavior`); that was
 * removed by request — navigation that changes size while you read is noise,
 * and it cost a scroll listener on every tab to drive.
 *
 * The bar is an absolute overlay now, not a flex child, so it no longer takes
 * space from its siblings. It reports `reservedHeight` via `onHeightChange`
 * and every scroller underneath pads by that instead. The reported number is
 * computed, not measured — the two agree now that the bar is fixed, but the
 * screens depend on it being stable, so keep it arithmetic.
 *
 * Icons follow the SVG paths in `tabs/my-movies.jsx → NavIcon` translated to
 * `react-native-svg` (stroke 1.9, 22px, rounded caps).
 *
 * The reel-flight landing target is reported from the Lists cell, measured
 * from that cell's own layout.
 *
 * Width: five cells in the same bar leaves ~66px each at 320pt (SE). Labels
 * are 10px/800 and must not wrap — `__tests__/globalBottomBar.test.ts`
 * pins the label lengths that fit.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type View as RNView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle } from 'react-native-svg';
import { GlassView } from 'expo-glass-effect';
import { useTranslation } from 'react-i18next';
import { useThemeColors, useColorScheme, type ThemeColors } from '../theme/tokens';
import { useFlightStore } from '../stores/flightStore';
import { useGlassAvailable } from '../hooks/useGlassAvailable';
import {
  lensGeometry,
  navBarMetrics,
  LENS_INSET_V,
  type CellFrame,
  type NavBarMetrics,
} from './navBarMetrics';

export type BottomTab = 'films' | 'words' | 'practice' | 'lists' | 'profile';

interface Props {
  /** Which tab to render as active; `null` when inside a sub-page that
      doesn't belong to a single tab (e.g. movie detail). */
  active: BottomTab | null;
  onTabPress: (tab: BottomTab) => void;
  /** Reports the vertical space scrollers must reserve. Fires on mount and
   *  whenever the safe-area inset or the glass/pinned shape changes — not on
   *  every layout pass, and never while retracting. */
  onHeightChange?: (height: number) => void;
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
//
// ## Ids say what a screen shows; labels say what we call it
//
// The first tab shows the **word feed** and is called Home; the second shows
// the **film feed** and is called Explore. The labels were swapped at some
// point and the route ids were not, which left a screen called `home`
// rendering under a tab labelled "Explore" — two positional words pointing
// opposite ways, and a standing tax on every conversation about either tab.
//
// The ids are named for their content now (`words`, `films`), so they cannot
// be swapped by a future reshuffle: a tab can move or be renamed, but the film
// feed is always the film feed.
//
// This array is the ONE place content, label and position meet, and the three
// are allowed to disagree here because they are three different things: `id`
// is which feed, `labelKey` is what we call it, `icon` is what it wears.
//
// A reshuffle is therefore a one-line edit here, and nothing downstream has to
// know it happened.
export const TABS: TabItem[] = [
  { id: 'words',  labelKey: 'home',     icon: 'home' },
  { id: 'films',  labelKey: 'explore',  icon: 'explore' },
  { id: 'practice', labelKey: 'practice', icon: 'spark' },
  { id: 'lists',    labelKey: 'lists',    icon: 'list' },
  { id: 'profile',  labelKey: 'profile',  icon: 'user' },
];

export function GlobalBottomBar({ active, onTabPress, onHeightChange }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const tc = useThemeColors();
  const scheme = useColorScheme();
  const glass = useGlassAvailable();
  const m = useMemo(() => navBarMetrics(insets.bottom, glass), [insets.bottom, glass]);
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

  useEffect(() => {
    onHeightChange?.(m.reservedHeight);
  }, [m.reservedHeight, onHeightChange]);

  // ── Active-tab lens ──────────────────────────────────────────────────────
  // Cell frames come from each button's own onLayout rather than from
  // `index * cellWidth`. RTL reverses the row for us, so index arithmetic
  // would light up the mirrored tab; measurement is correct either way.
  const [cells, setCells] = useState<Record<string, CellFrame>>({});
  const handleCellLayout = useCallback((id: BottomTab, frame: CellFrame) => {
    setCells((prev) => {
      const seen = prev[id];
      if (seen && seen.x === frame.x && seen.width === frame.width) return prev;
      return { ...prev, [id]: frame };
    });
  }, []);
  const lens = lensGeometry(active ? cells[active] : null);
  const lensX = useRef(new Animated.Value(0)).current;
  // First placement must be a jump, not a slide — otherwise the lens flies in
  // from the left edge on cold start.
  const lensPlaced = useRef(false);
  useEffect(() => {
    if (!lens) return;
    if (!lensPlaced.current) {
      lensPlaced.current = true;
      lensX.setValue(lens.x);
      return;
    }
    Animated.spring(lensX, {
      toValue: lens.x,
      useNativeDriver: true,
      damping: 20,
      stiffness: 260,
      mass: 0.8,
    }).start();
  }, [lens, lensX]);

  return (
    <View
      // box-none so the inset margins around the capsule stay tappable by the
      // content underneath rather than swallowing touches into dead space.
      pointerEvents="box-none"
      style={[
        s.host,
        {
          paddingHorizontal: m.sideMargin,
          paddingBottom: m.bottomMargin,
        },
      ]}
    >
      <View
        style={[
          s.body,
          {
            height: m.barHeight,
            borderRadius: m.radius,
            paddingTop: m.padTop,
            paddingBottom: m.padBottom,
          },
        ]}
      >
        {m.floating ? (
          <GlassView
            style={[StyleSheet.absoluteFill, { borderRadius: m.radius }]}
            glassEffectStyle="regular"
            // The app has its own light/dark toggle that can disagree with the
            // system's, so 'auto' would give dark glass under a light UI.
            colorScheme={scheme}
            isInteractive
          />
        ) : (
          <View
            style={[
              StyleSheet.absoluteFill,
              s.pinnedFill,
              { backgroundColor: tc.tabBg, borderTopColor: tc.tabBorder },
            ]}
          />
        )}

        {m.floating && lens ? (
          <Animated.View
            pointerEvents="none"
            style={[
              s.lens,
              {
                width: lens.width,
                top: LENS_INSET_V,
                bottom: LENS_INSET_V,
                borderRadius: (m.barHeight - LENS_INSET_V * 2) / 2,
                backgroundColor: tc.goldWash,
                borderColor: tc.goldLine,
                transform: [{ translateX: lensX }],
              },
            ]}
          />
        ) : null}

        <View style={s.row}>
          {TABS.map((tab) => (
            <TabBtn
              key={tab.id}
              id={tab.id}
              icon={tab.icon}
              label={t(`nav.${tab.labelKey}`)}
              isActive={active === tab.id}
              onPress={() => onTabPress(tab.id)}
              onCellLayout={handleCellLayout}
              tc={tc}
              s={s}
              viewRef={tab.id === 'lists' ? listsRef : undefined}
              onMeasure={tab.id === 'lists' ? measureListsTab : undefined}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

function TabBtn({
  id,
  icon,
  label,
  isActive,
  onPress,
  onCellLayout,
  tc,
  s,
  viewRef,
  onMeasure,
}: {
  id: BottomTab;
  icon: NavIconKind;
  label: string;
  isActive: boolean;
  onPress: () => void;
  onCellLayout: (id: BottomTab, frame: CellFrame) => void;
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
      onLayout={(e) => {
        const { x, width } = e.nativeEvent.layout;
        onCellLayout(id, { x, width });
        onMeasure?.();
      }}
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
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  body: {
    // `hidden` clips the glass to the pill; without it the effect paints
    // square corners behind the rounded content.
    overflow: 'hidden',
    justifyContent: 'center',
  },
  pinnedFill: {
    borderTopWidth: 1,
  },
  lens: {
    position: 'absolute',
    left: 0,
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
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

export type { NavBarMetrics };
