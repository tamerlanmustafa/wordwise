/**
 * GlobalBottomBar — the persistent 4-tab nav rendered at the bottom of
 * every top-level screen (Home, Movie Detail, Journey, Rankings, etc.).
 *
 * Tabs are purely navigation, not view filters. View-scoped toggles (like
 * For You / All Levels inside a movie) belong in the screen's own content,
 * not here.
 */

import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/palette';

export type BottomTab = 'home' | 'words' | 'journey' | 'rankings' | 'profile';

interface Props {
  /** Which tab to render as active; `null` when inside a sub-page that
      doesn't belong to a single tab (e.g. movie detail). */
  active: BottomTab | null;
  onTabPress: (tab: BottomTab) => void;
}

export function GlobalBottomBar({ active, onTabPress }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(16, insets.bottom) }]}>
      <TabBtn icon="home" label="Home" isActive={active === 'home'} onPress={() => onTabPress('home')} />
      <TabBtn icon="list" label="My Lists" isActive={active === 'words'} onPress={() => onTabPress('words')} />
      <TabBtn icon="map" label="Journey" isActive={false} disabled onPress={() => onTabPress('journey')} />
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
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  isActive: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const color = disabled ? '#C5C5D0' : isActive ? colors.primary : colors.textSecondary;
  return (
    <TouchableOpacity
      style={[styles.btn, disabled && styles.btnDisabled]}
      onPress={disabled ? undefined : onPress}
      activeOpacity={disabled ? 1 : 0.7}
    >
      <Ionicons name={icon} size={18} color={color} />
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
  label: {
    fontSize: 11,
    fontWeight: '600',
  },
});
