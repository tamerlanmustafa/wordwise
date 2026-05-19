/**
 * GlobalBottomBar — the persistent 4-tab nav rendered at the bottom of
 * every top-level screen (Home, Movie Detail, Journey, Rankings, etc.).
 *
 * Tabs are purely navigation, not view filters. View-scoped toggles (like
 * For You / All Levels inside a movie) belong in the screen's own content,
 * not here.
 *
 * The Reel tab also acts as the landing target for the "added to reel"
 * poster-flight animation — its window-space rect is reported to
 * flightStore on layout, and a small count badge surfaces newly added
 * movies the user hasn't visited the reel for yet.
 *
 * Light/dark: surface + active-tab colour flip via tokens. The active
 * accent intentionally inverts — gold on dark, purple on light — to
 * match the Reel/Set Intro/Result CTA rule.
 */

import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, useColorScheme, type ThemeColors } from '../theme/tokens';
import { useFlightStore } from '../stores/flightStore';
import { useReelBadgeStore } from '../stores/reelBadgeStore';

export type BottomTab = 'home' | 'words' | 'journey' | 'rankings' | 'profile';

interface Props {
  /** Which tab to render as active; `null` when inside a sub-page that
      doesn't belong to a single tab (e.g. movie detail). */
  active: BottomTab | null;
  onTabPress: (tab: BottomTab) => void;
  onLayout?: (height: number) => void;
}

export function GlobalBottomBar({ active, onTabPress, onLayout }: Props) {
  const insets = useSafeAreaInsets();
  const tc = useThemeColors();
  const scheme = useColorScheme();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const reelTabRef = useRef<View | null>(null);
  const setReelTabRect = useFlightStore((s) => s.setReelTabRect);
  const reelBadge = useReelBadgeStore((s) => s.count);

  const activeColor = scheme === 'dark' ? tc.gold : tc.primary;
  const inactiveColor = tc.textSecondary;

  const measureReelTab = () => {
    reelTabRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) {
        setReelTabRect({ x, y, width, height });
      }
    });
  };

  useEffect(() => {
    return () => setReelTabRect(null);
  }, [setReelTabRect]);

  return (
    <View
      style={[
        s.bar,
        {
          paddingBottom: Math.max(6, insets.bottom),
          backgroundColor: tc.bottomBarBg,
          borderTopColor: tc.bottomBarBorder,
        },
      ]}
      onLayout={(e) => onLayout?.(e.nativeEvent.layout.height)}
    >
      <TabBtn icon="home" label="Home" isActive={active === 'home'} onPress={() => onTabPress('home')} activeColor={activeColor} inactiveColor={inactiveColor} s={s} />
      <TabBtn icon="list" label="My Lists" isActive={active === 'words'} onPress={() => onTabPress('words')} activeColor={activeColor} inactiveColor={inactiveColor} s={s} />
      <TabBtn
        icon="film"
        label="Reel"
        isActive={active === 'journey'}
        onPress={() => onTabPress('journey')}
        innerRef={reelTabRef}
        onInnerLayout={measureReelTab}
        badge={reelBadge}
        activeColor={activeColor}
        inactiveColor={inactiveColor}
        s={s}
      />
      <TabBtn icon="trophy" label="Rankings" isActive={active === 'rankings'} onPress={() => onTabPress('rankings')} activeColor={activeColor} inactiveColor={inactiveColor} s={s} />
      <TabBtn icon="person-circle" label="Profile" isActive={active === 'profile'} onPress={() => onTabPress('profile')} activeColor={activeColor} inactiveColor={inactiveColor} s={s} />
    </View>
  );
}

function TabBtn({
  icon,
  label,
  isActive,
  disabled,
  onPress,
  innerRef,
  onInnerLayout,
  badge,
  activeColor,
  inactiveColor,
  s,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  isActive: boolean;
  disabled?: boolean;
  onPress: () => void;
  innerRef?: React.RefObject<View | null>;
  onInnerLayout?: () => void;
  badge?: number;
  activeColor: string;
  inactiveColor: string;
  s: ReturnType<typeof makeStyles>;
}) {
  const color = disabled ? inactiveColor : isActive ? activeColor : inactiveColor;
  return (
    <TouchableOpacity
      style={[s.btn, disabled && s.btnDisabled]}
      onPress={disabled ? undefined : onPress}
      activeOpacity={disabled ? 1 : 0.7}
    >
      <View
        ref={innerRef as any}
        onLayout={onInnerLayout}
        style={s.iconWrap}
      >
        <Ionicons name={icon} size={18} color={color} />
        {badge && badge > 0 ? (
          <View style={s.badge} pointerEvents="none">
            <Text style={s.badgeText} numberOfLines={1}>
              {badge > 9 ? '9+' : String(badge)}
            </Text>
          </View>
        ) : null}
      </View>
      <Text style={[s.label, { color }]}>{label}</Text>
      {disabled && <Text style={s.comingSoon}>Soon</Text>}
    </TouchableOpacity>
  );
}

const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingTop: 7,
    paddingHorizontal: 16,
    gap: 6,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  comingSoon: {
    fontSize: 9,
    fontWeight: '700',
    color: tc.textFaint,
    letterSpacing: 0.3,
    marginTop: 1,
  },
  btn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  iconWrap: {
    position: 'relative',
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -10,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: tc.error,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: tc.paper,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 0,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
  },
});
