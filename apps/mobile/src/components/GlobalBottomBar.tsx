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
 */

import { useEffect, useRef } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/palette';
import { useThemeColors } from '../theme/tokens';
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
  const reelTabRef = useRef<View | null>(null);
  const setReelTabRect = useFlightStore((s) => s.setReelTabRect);
  const reelBadge = useReelBadgeStore((s) => s.count);

  // measureInWindow returns absolute window coords, which is what the
  // PosterFlight overlay expects. We re-measure on every layout pass in
  // case the bar reflows (orientation, safe-area changes, etc.).
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
      style={[styles.bar, { paddingBottom: Math.max(6, insets.bottom), backgroundColor: tc.bottomBarBg, borderTopColor: tc.bottomBarBorder }]}
      onLayout={(e) => onLayout?.(e.nativeEvent.layout.height)}
    >
      <TabBtn icon="home" label="Home" isActive={active === 'home'} onPress={() => onTabPress('home')} />
      <TabBtn icon="list" label="My Lists" isActive={active === 'words'} onPress={() => onTabPress('words')} />
      <TabBtn
        icon="film"
        label="Reel"
        isActive={active === 'journey'}
        onPress={() => onTabPress('journey')}
        innerRef={reelTabRef}
        onInnerLayout={measureReelTab}
        badge={reelBadge}
      />
      <TabBtn icon="trophy" label="Rankings" isActive={active === 'rankings'} onPress={() => onTabPress('rankings')} />
      <TabBtn icon="person-circle" label="Profile" isActive={active === 'profile'} onPress={() => onTabPress('profile')} />
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
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  isActive: boolean;
  disabled?: boolean;
  onPress: () => void;
  /** Forwarded ref to the icon container so callers can measureInWindow. */
  innerRef?: React.RefObject<View | null>;
  onInnerLayout?: () => void;
  /** When > 0, renders a small red badge over the icon. */
  badge?: number;
}) {
  const color = disabled ? '#C5C5D0' : isActive ? colors.primary : colors.textSecondary;
  return (
    <TouchableOpacity
      style={[styles.btn, disabled && styles.btnDisabled]}
      onPress={disabled ? undefined : onPress}
      activeOpacity={disabled ? 1 : 0.7}
    >
      <View
        ref={innerRef as any}
        onLayout={onInnerLayout}
        style={styles.iconWrap}
      >
        <Ionicons name={icon} size={18} color={color} />
        {badge && badge > 0 ? (
          <View style={styles.badge} pointerEvents="none">
            <Text style={styles.badgeText} numberOfLines={1}>
              {badge > 9 ? '9+' : String(badge)}
            </Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.label, { color }]}>{label}</Text>
      {disabled && <Text style={styles.comingSoon}>Soon</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: '#F3EEFF',
    borderTopWidth: 1,
    borderTopColor: '#E0D4F7',
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
    color: '#A0A0B0',
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
    backgroundColor: '#F44336',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#fff',
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
