/**
 * UserMenuSheet — slides up from the bottom, rendered as an absolute-position
 * overlay (no Modal) so the GlobalBottomBar rendered after it in the tree
 * stays fully interactive. The scrim and sheet both stop at `bottomOffset`
 * so the bar is never covered.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useThemeStore, type ThemePreference } from '../stores/themeStore';
import {
  Animated,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useThemeColors, type ThemeColors } from '../theme/tokens';

interface Props {
  visible: boolean;
  onClose: () => void;
  user: any;
  onNavigateToSettings: () => void;
  onNavigateToAdmin: () => void;
  onNavigateToLists: () => void;
  onNavigateToVocabulary: () => void;
  onNavigateToStats: () => void;
  onNavigateToAchievements: () => void;
  onLogout: () => void;
  isAdmin?: boolean;
  /** Height of GlobalBottomBar — sheet and scrim stop above it. */
  bottomOffset: number;
}

export function UserMenuSheet({
  visible,
  onClose,
  user,
  onNavigateToSettings,
  onNavigateToAdmin,
  onNavigateToLists,
  onNavigateToVocabulary,
  onNavigateToStats,
  onNavigateToAchievements,
  onLogout,
  isAdmin,
  bottomOffset,
}: Props) {
  const tc = useThemeColors();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  const slideAnim = useRef(new Animated.Value(600)).current;

  const pref = useThemeStore((s) => s.preference);

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: visible ? 0 : 600,
      useNativeDriver: true,
      bounciness: 0,
      speed: 18,
    }).start();
  }, [visible, slideAnim]);

  const wrap = (fn: () => void) => () => { onClose(); setTimeout(fn, 200); };

  const navItems = [
    { icon: '📊', label: 'My Progress', action: wrap(onNavigateToStats) },
    { icon: '🏅', label: 'Badges', action: wrap(onNavigateToAchievements) },
    { icon: '📚', label: 'My Lists', action: wrap(onNavigateToLists) },
    { icon: '📖', label: 'Vocabulary', action: wrap(onNavigateToVocabulary) },
    { icon: '⚙️', label: 'Settings', action: wrap(onNavigateToSettings) },
    ...(isAdmin ? [{ icon: '🛠', label: 'Admin Panel', action: wrap(onNavigateToAdmin) }] : []),
  ];

  const themeOpts: { key: ThemePreference; label: string; icon: string }[] = [
    { key: 'light',  label: 'Light',  icon: '☀️' },
    { key: 'system', label: 'Auto',   icon: '📱' },
    { key: 'dark',   label: 'Dark',   icon: '🌙' },
  ];

  return (
    // Covers everything above the bar; pointer events pass through to bar below
    <View
      style={[StyleSheet.absoluteFillObject, { bottom: bottomOffset }]}
      pointerEvents={visible ? 'box-none' : 'none'}
    >
      {/* Scrim — only present when open so it never blocks touches when closed */}
      {visible && (
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.scrim} />
        </TouchableWithoutFeedback>
      )}

      {/* Sheet */}
      <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}>
        <View style={styles.handle} />

        <View style={styles.identity}>
          {user?.profile_picture_url ? (
            <Image source={{ uri: user.profile_picture_url }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitial}>
                {user?.username?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'U'}
              </Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{user?.username || 'User'}</Text>
            <Text style={styles.userEmail} numberOfLines={1}>{user?.email}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        {navItems.map(({ icon, label, action }) => (
          <TouchableOpacity key={label} style={styles.row} onPress={action} activeOpacity={0.7}>
            <Text style={styles.rowIcon}>{icon}</Text>
            <Text style={styles.rowLabel}>{label}</Text>
            <Text style={styles.rowArrow}>›</Text>
          </TouchableOpacity>
        ))}

        <View style={styles.divider} />

        <View style={styles.themeRow}>
          <View style={styles.themeChips}>
            {themeOpts.map((o) => (
              <TouchableOpacity
                key={o.key}
                style={[styles.themeChip, pref === o.key && styles.themeChipActive]}
                onPress={() => useThemeStore.getState().setPreference(o.key)}
                activeOpacity={0.7}
              >
                <Text style={styles.themeChipIcon}>{o.icon}</Text>
                <Text style={[styles.themeChipLabel, pref === o.key && styles.themeChipLabelActive]}>
                  {o.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.divider} />

        <TouchableOpacity
          style={styles.row}
          onPress={() => { onClose(); setTimeout(onLogout, 200); }}
          activeOpacity={0.7}
        >
          <Text style={styles.rowIcon}>🚪</Text>
          <Text style={[styles.rowLabel, { color: tc.error }]}>Logout</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: tc.scrim,
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: tc.paper,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 16,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: tc.border,
    alignSelf: 'center',
    marginBottom: 12,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 10,
  },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: tc.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  userName: { fontSize: 15, fontWeight: '700', color: tc.text },
  userEmail: { fontSize: 12, color: tc.textSecondary, marginTop: 1 },
  divider: { height: 1, backgroundColor: tc.divider, marginVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 },
  rowIcon: { fontSize: 16, width: 26, textAlign: 'center' },
  rowLabel: { flex: 1, fontSize: 14, fontWeight: '500', color: tc.text },
  rowArrow: { fontSize: 16, color: tc.textSecondary },
  themeRow: { paddingVertical: 4 },
  themeChips: { flexDirection: 'row', gap: 8 },
  themeChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: tc.border,
    backgroundColor: tc.background,
    gap: 4,
  },
  themeChipActive: {
    borderColor: tc.primary,
    backgroundColor: tc.primary + '22',
  },
  themeChipIcon: { fontSize: 14 },
  themeChipLabel: { fontSize: 12, fontWeight: '600', color: tc.textSecondary },
  themeChipLabelActive: { color: tc.primary, fontWeight: '700' },
});
