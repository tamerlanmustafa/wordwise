/**
 * UserMenuSheet — slides up from the bottom when the profile tab is pressed.
 * Contains everything that was previously split between the header's user
 * avatar menu, the language dropdown, and the admin gear icon.
 */

import { useEffect, useRef } from 'react';
import {
  Animated,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/palette';
import { AVAILABLE_LANGUAGES } from '../types';

interface Props {
  visible: boolean;
  onClose: () => void;
  user: any;
  targetLanguage: string;
  setTargetLanguage: (lang: string) => void;
  onNavigateToSettings: () => void;
  onNavigateToAdmin: () => void;
  onNavigateToLists: () => void;
  onNavigateToVocabulary: () => void;
  onNavigateToStats: () => void;
  onNavigateToAchievements: () => void;
  onLogout: () => void;
  isAdmin?: boolean;
}

export function UserMenuSheet({
  visible,
  onClose,
  user,
  targetLanguage,
  setTargetLanguage,
  onNavigateToSettings,
  onNavigateToAdmin,
  onNavigateToLists,
  onNavigateToVocabulary,
  onNavigateToStats,
  onNavigateToAchievements,
  onLogout,
  isAdmin,
}: Props) {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(400)).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: visible ? 0 : 400,
      useNativeDriver: true,
      bounciness: 0,
      speed: 18,
    }).start();
  }, [visible, slideAnim]);

  const wrap = (fn: () => void) => () => { onClose(); setTimeout(fn, 200); };

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      {/* Scrim */}
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.scrim} />
      </TouchableWithoutFeedback>

      {/* Sheet */}
      <Animated.View
        style={[
          styles.sheet,
          { paddingBottom: Math.max(insets.bottom, 16), transform: [{ translateY: slideAnim }] },
        ]}
      >
        {/* Handle */}
        <View style={styles.handle} />

        {/* User identity */}
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

        <ScrollView bounces={false}>
          {/* Language selector */}
          <Text style={styles.sectionLabel}>Translation language</Text>
          <View style={styles.langRow}>
            {AVAILABLE_LANGUAGES.slice(0, 8).map((lang) => (
              <TouchableOpacity
                key={lang.code}
                style={[
                  styles.langChip,
                  lang.code === targetLanguage && styles.langChipActive,
                ]}
                onPress={() => setTargetLanguage(lang.code)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.langChipText,
                    lang.code === targetLanguage && styles.langChipTextActive,
                  ]}
                >
                  {lang.code}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.divider} />

          {/* Navigation items */}
          {[
            { icon: '📊', label: 'My Progress', action: wrap(onNavigateToStats) },
            { icon: '🏅', label: 'Badges', action: wrap(onNavigateToAchievements) },
            { icon: '📚', label: 'My Lists', action: wrap(onNavigateToLists) },
            { icon: '📖', label: 'Vocabulary', action: wrap(onNavigateToVocabulary) },
            { icon: '⚙️', label: 'Settings', action: wrap(onNavigateToSettings) },
            ...(isAdmin
              ? [{ icon: '🛠', label: 'Admin Panel', action: wrap(onNavigateToAdmin) }]
              : []),
          ].map(({ icon, label, action }) => (
            <TouchableOpacity key={label} style={styles.row} onPress={action} activeOpacity={0.7}>
              <Text style={styles.rowIcon}>{icon}</Text>
              <Text style={styles.rowLabel}>{label}</Text>
              <Text style={styles.rowArrow}>›</Text>
            </TouchableOpacity>
          ))}

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.row}
            onPress={() => { onClose(); setTimeout(onLogout, 200); }}
            activeOpacity={0.7}
          >
            <Text style={styles.rowIcon}>🚪</Text>
            <Text style={[styles.rowLabel, { color: colors.error }]}>Logout</Text>
          </TouchableOpacity>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.paper,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    maxHeight: '80%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: 16,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 16,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  userName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  userEmail: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.5,
    marginTop: 4,
    marginBottom: 10,
  },
  langRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  langChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  langChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  langChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  langChipTextActive: {
    color: '#FFFFFF',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
  },
  rowIcon: { fontSize: 18, width: 28, textAlign: 'center' },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: '500', color: colors.text },
  rowArrow: { fontSize: 18, color: colors.textSecondary },
});
