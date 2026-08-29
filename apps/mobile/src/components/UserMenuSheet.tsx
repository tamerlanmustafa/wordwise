/**
 * UserMenuSheet — slides up from the bottom, rendered as an absolute-position
 * overlay (no Modal) so the GlobalBottomBar rendered after it in the tree
 * stays fully interactive. The scrim and sheet both stop at `bottomOffset`
 * so the bar is never covered.
 *
 * Styled to the v0.7 cinema / reading-room system (theme/tokens): warm
 * surfaces, gold accents, serif identity name, and stroked SVG icons in
 * circular chips — matching HomeHeader / My Movies / the bottom bar (which
 * uses gold for its active tab). No emoji.
 *
 * Most navigation rows are hidden for now — see `userMenuRows.ts`. They are
 * hidden, not removed: the props, handlers and screens behind them are all
 * still wired, so restoring one means editing that list, nothing here.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useThemeStore, type ThemePreference } from '../stores/themeStore';
import { useAuthStore } from '../stores/authStore';
import { useNotificationsStore, selectHasUnread } from '../stores/notificationsStore';
import { showConfirm } from '../stores/confirmStore';
import {
  Alert,
  Animated,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useThemeColors, type ThemeColors } from '../theme/tokens';
import { useTranslation } from 'react-i18next';
import { visibleMenuRows, type MenuRowKey } from './userMenuRows';

const SERIF_FAMILY = 'Source Serif 4';

interface Props {
  visible: boolean;
  onClose: () => void;
  user: any;
  onNavigateToSettings: () => void;
  onNavigateToAdmin: () => void;
  onNavigateToNotebook: () => void;
  onNavigateToWatched: () => void;
  onNavigateToSavedMovies: () => void;
  onNavigateToVocabulary: () => void;
  onNavigateToStats: () => void;
  onNavigateToAchievements: () => void;
  onNavigateToLeaderboard: () => void;
  /** Opens NotificationsSheet. Wired but currently unreachable — the row is
   *  in HIDDEN_MENU_ROWS, and the Home header's bell is already gone. */
  onNavigateToNotifications: () => void;
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
  onNavigateToNotebook,
  onNavigateToWatched,
  onNavigateToSavedMovies,
  onNavigateToVocabulary,
  onNavigateToStats,
  onNavigateToAchievements,
  onNavigateToLeaderboard,
  onNavigateToNotifications,
  onLogout,
  isAdmin,
  bottomOffset,
}: Props) {
  const { t } = useTranslation();
  const hasUnread = useNotificationsStore(selectHasUnread);
  const tc = useThemeColors();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  // Start hidden well off-screen; the real distance is set once we measure the
  // sheet's height (below) so it always fully clears the bar, however tall the
  // menu grows (admin row, etc.).
  const slideAnim = useRef(new Animated.Value(900)).current;
  // Distance to translate the sheet down so it sits fully below the bottom bar.
  const hiddenY = useRef(900);

  const pref = useThemeStore((s) => s.preference);

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: visible ? 0 : hiddenY.current,
      useNativeDriver: true,
      bounciness: 0,
      speed: 18,
    }).start();
  }, [visible, slideAnim]);

  // Measure the sheet so the hidden position is exactly its own height plus the
  // bar offset — enough to slide the whole thing off-screen. Snap immediately
  // when closed so it never peeks before the first open.
  const onSheetLayout = useCallback(
    (e: LayoutChangeEvent) => {
      hiddenY.current = e.nativeEvent.layout.height + bottomOffset + 24;
      if (!visible) slideAnim.setValue(hiddenY.current);
    },
    [visible, bottomOffset, slideAnim],
  );

  const wrap = (fn: () => void) => () => { onClose(); setTimeout(fn, 200); };

  // Every row this sheet knows how to draw, whether or not it is currently
  // shown. `visibleMenuRows` (userMenuRows.ts) decides what actually renders —
  // most of these are hidden for now, and stay defined here so that restoring
  // one is a change to that list alone.
  const rows: Record<MenuRowKey, {
    icon: MenuIconName;
    label: string;
    action: () => void;
    /** Gold dot on the icon chip — currently only unread notifications. */
    dot?: boolean;
  }> = {
    // The bell left the Home header, so this row is notifications' only entry
    // point — it carries the unread dot the bell used to.
    notifications: {
      icon: 'bell',
      label: t('home:notifications'),
      action: wrap(onNavigateToNotifications),
      dot: hasUnread,
    },
    progress: { icon: 'progress', label: t('settings:menu.myProgress'), action: wrap(onNavigateToStats) },
    badges: { icon: 'badge', label: 'Badges', action: wrap(onNavigateToAchievements) },
    leaderboard: { icon: 'leaderboard', label: 'Leaderboard', action: wrap(onNavigateToLeaderboard) },
    // "My Lists" was a hub screen whose job the Lists *tab* now does. Its two
    // genuinely distinct children are linked directly instead: Saved Words
    // groups per-movie saves by film, which is a different view from the
    // tab's flat Favourites set, and Watched is a films-seen log rather than
    // a study list.
    savedWords: { icon: 'lists', label: t('vocabulary:savedWords'), action: wrap(onNavigateToNotebook) },
    watchedFilms: { icon: 'film', label: t('vocabulary:lists.watchedFilms'), action: wrap(onNavigateToWatched) },
    // The saved reel's home since Explore took its place in the tab bar.
    myMovies: { icon: 'film', label: t('movies:myMovies.title'), action: wrap(onNavigateToSavedMovies) },
    vocabulary: { icon: 'book', label: 'Vocabulary', action: wrap(onNavigateToVocabulary) },
    settings: { icon: 'settings', label: 'Settings', action: wrap(onNavigateToSettings) },
    admin: { icon: 'admin', label: t('settings:menu.adminPanel'), action: wrap(onNavigateToAdmin) },
  };

  const navItems = visibleMenuRows(!!isAdmin).map((key) => ({ key, ...rows[key] }));

  const themeOpts: { key: ThemePreference; label: string; icon: MenuIconName }[] = [
    { key: 'light',  label: 'Light',  icon: 'sun' },
    { key: 'system', label: 'Auto',   icon: 'phone' },
    { key: 'dark',   label: 'Dark',   icon: 'moon' },
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
      <Animated.View
        onLayout={onSheetLayout}
        style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}
      >
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
            <Text style={styles.eyebrow}>{t('settings:menu.yourAccount')}</Text>
            <Text style={styles.userName} numberOfLines={1}>{user?.username || 'User'}</Text>
            <Text style={styles.userEmail} numberOfLines={1}>{user?.email}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        {navItems.map(({ key, icon, label, action, dot }) => (
          <TouchableOpacity key={key} style={styles.row} onPress={action} activeOpacity={0.6}>
            <View style={styles.iconChip}>
              <MenuIcon name={icon} size={18} color={tc.textSecondary} />
              {dot ? <View style={styles.unreadDot} /> : null}
            </View>
            <Text style={styles.rowLabel}>{label}</Text>
            <MenuIcon name="chevron" size={16} color={tc.textFaint} />
          </TouchableOpacity>
        ))}

        <View style={styles.divider} />

        <Text style={styles.sectionLabel}>{t('settings:menu.appearance')}</Text>
        <View style={styles.themeChips}>
          {themeOpts.map((o) => {
            const on = pref === o.key;
            return (
              <TouchableOpacity
                key={o.key}
                style={[styles.themeChip, on && styles.themeChipActive]}
                onPress={() => useThemeStore.getState().setPreference(o.key)}
                activeOpacity={0.7}
              >
                <MenuIcon name={o.icon} size={16} color={on ? tc.primary : tc.textSecondary} />
                <Text style={[styles.themeChipLabel, on && styles.themeChipLabelActive]}>
                  {o.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.divider} />

        <TouchableOpacity
          style={styles.row}
          onPress={() => {
            // Confirm first — an accidental tap shouldn't drop the session.
            // Themed dialog (not native Alert) so it matches the in-app theme.
            onClose();
            showConfirm({
              title: t('settings:menu.logOutTitle'),
              message: t('settings:menu.logOutBody'),
              confirmLabel: t('settings:menu.logOut'),
              tone: 'destructive',
              onConfirm: onLogout,
            });
          }}
          activeOpacity={0.6}
        >
          <View style={[styles.iconChip, styles.iconChipDanger]}>
            <MenuIcon name="logout" size={18} color={tc.error} />
          </View>
          <Text style={[styles.rowLabel, { color: tc.error }]}>{t('settings:menu.logout')}</Text>
        </TouchableOpacity>

        {/* App Store 5.1.1(v): account deletion must be reachable in-app.
            Double-confirm, then the store deletes server-side and signs out
            (auth status flips → app returns to the login screen). */}
        <TouchableOpacity
          style={styles.row}
          onPress={() => {
            onClose();
            showConfirm({
              title: t('settings:menu.deleteAccountTitle'),
              message: t('settings:menu.deleteAccountBody'),
              confirmLabel: t('settings:menu.delete'),
              tone: 'destructive',
              onConfirm: () => {
                useAuthStore.getState().deleteAccount().catch(() => {
                  // Rare error path — native Alert so it stays until the user
                  // acknowledges (it carries a support email to copy).
                  Alert.alert(
                    t('settings:menu.deleteFailedTitle'),
                    t('settings:menu.deleteFailedBody'),
                  );
                });
              },
            });
          }}
          activeOpacity={0.6}
        >
          <View style={[styles.iconChip, styles.iconChipDanger]}>
            <MenuIcon name="trash" size={18} color={tc.error} />
          </View>
          <Text style={[styles.rowLabel, { color: tc.error }]}>{t('settings:menu.deleteAccount')}</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

// ── Stroked icon set (no emoji) — mirrors the cinema system used across
//    Home / My Movies / the bottom bar. ─────────────────────────────────
type MenuIconName =
  | 'bell'
  | 'progress'
  | 'badge'
  | 'leaderboard'
  | 'lists'
  | 'film'
  | 'book'
  | 'settings'
  | 'admin'
  | 'logout'
  | 'trash'
  | 'sun'
  | 'moon'
  | 'phone'
  | 'chevron';

function MenuIcon({ name, size = 18, color = '#000' }: { name: MenuIconName; size?: number; color?: string }) {
  const p = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (name) {
    // Same glyph the Home header used, so the bell is recognisable in its
    // new home rather than reading as a different feature.
    case 'bell':
      return (
        <Svg {...p}>
          <Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0" />
        </Svg>
      );
    case 'progress':
      return (
        <Svg {...p}>
          <Path d="M4 20h16" />
          <Path d="M6 20v-6M11 20V6M16 20v-9" />
        </Svg>
      );
    case 'badge':
      return (
        <Svg {...p}>
          <Circle cx={12} cy={9} r={5} />
          <Path d="M8.5 13L7 21l5-2.6L17 21l-1.5-8" />
        </Svg>
      );
    case 'leaderboard':
      return (
        <Svg {...p}>
          <Path d="M8 21h8M12 17v4" />
          <Path d="M7 4h10v4a5 5 0 0 1-10 0z" />
          <Path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3" />
        </Svg>
      );
    case 'lists':
      return (
        <Svg {...p}>
          <Path d="M9 6h11M9 12h11M9 18h11" />
          <Path d="M4 6h.01M4 12h.01M4 18h.01" />
        </Svg>
      );
    case 'film':
      return (
        <Svg {...p}>
          <Rect x={3} y={4} width={18} height={16} rx={2} />
          <Path d="M3 8h18M3 16h18M8 4v16M16 4v16" />
        </Svg>
      );
    case 'book':
      return (
        <Svg {...p}>
          <Path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6.5A1.5 1.5 0 0 0 5 20.5z" />
          <Path d="M5 17.5A1.5 1.5 0 0 1 6.5 16H19" />
        </Svg>
      );
    case 'settings':
      return (
        <Svg {...p}>
          <Path d="M4 7h9M17 7h3" />
          <Path d="M4 17h3M11 17h9" />
          <Circle cx={15} cy={7} r={2.2} />
          <Circle cx={9} cy={17} r={2.2} />
        </Svg>
      );
    case 'admin':
      return (
        <Svg {...p}>
          <Path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" />
          <Path d="M9 12l2 2 4-4" />
        </Svg>
      );
    case 'logout':
      return (
        <Svg {...p}>
          <Path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
          <Path d="M16 17l5-5-5-5M21 12H9" />
        </Svg>
      );
    case 'trash':
      return (
        <Svg {...p}>
          <Path d="M4 7h16" />
          <Path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          <Path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
          <Path d="M10 11v6M14 11v6" />
        </Svg>
      );
    case 'sun':
      return (
        <Svg {...p}>
          <Circle cx={12} cy={12} r={4} />
          <Path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </Svg>
      );
    case 'moon':
      return (
        <Svg {...p}>
          <Path d="M21 12.8A8 8 0 1 1 11.2 3a6 6 0 0 0 9.8 9.8z" />
        </Svg>
      );
    case 'phone':
      return (
        <Svg {...p}>
          <Rect x={7} y={3} width={10} height={18} rx={2.5} />
          <Path d="M11 18h2" />
        </Svg>
      );
    case 'chevron':
    default:
      return (
        <Svg {...p}>
          <Path d="M9 6l6 6-6 6" />
        </Svg>
      );
  }
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
    borderTopStartRadius: 22,
    borderTopEndRadius: 22,
    borderTopWidth: 1,
    borderColor: tc.border,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 18,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: tc.border,
    alignSelf: 'center',
    marginBottom: 14,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingBottom: 12,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: tc.gold,
  },
  avatarPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: tc.primary,
    borderWidth: 2,
    borderColor: tc.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 21, fontWeight: '700', color: '#FFFFFF', fontFamily: SERIF_FAMILY },
  eyebrow: {
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 2,
    color: tc.goldOnSurface,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  userName: {
    fontSize: 20,
    fontWeight: '600',
    letterSpacing: -0.4,
    color: tc.text,
    fontFamily: SERIF_FAMILY,
  },
  userEmail: { fontSize: 12.5, color: tc.textSecondary, marginTop: 2 },
  divider: { height: 1, backgroundColor: tc.divider, marginVertical: 8 },
  sectionLabel: {
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 1.8,
    color: tc.textFaint,
    textTransform: 'uppercase',
    marginTop: 2,
    marginBottom: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 14 },
  iconChip: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: tc.chipBg,
    borderWidth: 1,
    borderColor: tc.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconChipDanger: {
    backgroundColor: tc.errorTint,
    borderColor: tc.errorBorder,
  },
  // Carried over from the Home bell, sized to the 38pt chip it now sits on.
  unreadDot: {
    position: 'absolute',
    top: 6,
    end: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: tc.gold,
    borderWidth: 1.5,
    borderColor: tc.paper,
  },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: tc.text },
  themeChips: { flexDirection: 'row', gap: 8 },
  themeChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: tc.border,
    backgroundColor: tc.background,
    gap: 6,
  },
  themeChipActive: {
    borderColor: tc.primary,
    backgroundColor: tc.primaryTint,
  },
  themeChipLabel: { fontSize: 12.5, fontWeight: '600', color: tc.textSecondary },
  themeChipLabelActive: { color: tc.primary, fontWeight: '800' },
});
