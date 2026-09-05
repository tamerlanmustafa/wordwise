/**
 * ProfileScreen — the account area's front door.
 *
 * This was a bottom sheet that slid up over whatever tab you were on. That
 * made it the only destination in the app that was not a screen, and it cost
 * more than it looked: Back from Settings had to re-open an overlay rather
 * than pop a screen (the `PROFILE_SHEET` sentinel in navParents), the tab bar
 * had to special-case it so switching tabs collapsed it, and it remembered
 * which tab it had opened over so it could put you back there. A page needs
 * none of that — it is a tab root like Home or Lists, and Back is ordinary.
 *
 * It is a hub, not a settings screen: identity at the top, then the four
 * places account business actually happens. Everything a row leads to used to
 * be one long scroll inside Settings, which meant "change my language" and
 * "delete my account" sat in the same list a swipe apart.
 *
 * No back arrow — it is a tab root, and tab roots in this app don't have one.
 *
 * **Dormant destinations.** Stats, Achievements, Leaderboard, Vocabulary,
 * Watched and the saved reel were rows on the old sheet, but every one of them
 * was in its `HIDDEN_MENU_ROWS` set — so they have been unreachable from the UI
 * for a while, and this change did not take anything away. The screens are
 * still routed in App.tsx and still name `profile` as their parent in
 * navParents, so restoring one means adding a row here and a `navigateTo…`
 * one-liner in App; nothing has to be rebuilt.
 */

import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { useBottomBarInset } from '../../hooks/useBottomBarInset';
import { MenuIcon, type MenuIconName } from '../ui/icons/MenuIcons';
import { Avatar, LinkRow, Rows, Section } from './settings/SettingsUI';
import { showConfirm } from '../../stores/confirmStore';

interface Props {
  user: any;
  isAdmin: boolean;
  onNavigateToSettings: () => void;
  onNavigateToNotifications: () => void;
  onNavigateToAccount: () => void;
  onNavigateToLegal: () => void;
  onNavigateToAdmin: () => void;
  onLogout: () => void;
}

export function ProfileScreen({
  user,
  isAdmin,
  onNavigateToSettings,
  onNavigateToNotifications,
  onNavigateToAccount,
  onNavigateToLegal,
  onNavigateToAdmin,
  onLogout,
}: Props) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const barInset = useBottomBarInset();

  const confirmLogout = () =>
    showConfirm({
      title: t('settings:menu.logOutTitle'),
      message: t('settings:menu.logOutBody'),
      confirmLabel: t('settings:menu.logOut'),
      tone: 'destructive',
      onConfirm: onLogout,
    });

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}>
        <Text style={s.headerTitle}>{t('nav.profile')}</Text>
      </View>

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: barInset + 24 }]}
      >
        {/* Identity. Read-only here — the editable username lives in Settings,
            next to the other things you change rather than the things you are. */}
        <View style={s.identity}>
          <Avatar uri={user?.profile_picture_url} name={user?.username || user?.email} size={72} />
          <Text style={s.name} numberOfLines={1}>
            {user?.username || t('settings:usernamePlaceholder')}
          </Text>
          {user?.email ? (
            <Text style={s.email} numberOfLines={1}>
              {user.email}
            </Text>
          ) : null}
        </View>

        <Section>
          <Rows>
            <IconRow icon="settings" label={t('settings:title')} onPress={onNavigateToSettings} />
            <IconRow
              icon="bell"
              label={t('settings:notifications')}
              onPress={onNavigateToNotifications}
            />
            <IconRow icon="badge" label={t('settings:account')} onPress={onNavigateToAccount} />
            <IconRow icon="book" label={t('settings:legal')} onPress={onNavigateToLegal} />
          </Rows>
        </Section>

        {isAdmin ? (
          <Section>
            <IconRow icon="admin" label={t('settings:menu.adminPanel')} onPress={onNavigateToAdmin} />
          </Section>
        ) : null}

        <Section>
          <LinkRow label={t('settings:menu.logout')} muted onPress={confirmLogout} />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

/** A hub row with its icon in the same circular chip the sheet used. */
function IconRow({
  icon,
  label,
  onPress,
}: {
  icon: MenuIconName;
  label: string;
  onPress: () => void;
}) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  return (
    <View style={s.iconRowWrap}>
      <View style={s.iconChip}>
        <MenuIcon name={icon} size={17} color={tc.goldOnSurface} />
      </View>
      <View style={s.iconRowBody}>
        <LinkRow label={label} onPress={onPress} />
      </View>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: tc.background,
    },
    // No fill and no rule. A paper-coloured bar across the top read as a
    // banner sitting on the page rather than as the page's own title, and it
    // was the only header in the account area with nothing in it but text.
    // `SafeAreaView edges={['top']}` already clears the notch and the Dynamic
    // Island; the padding here is breathing room below that, not the inset.
    header: {
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 6,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: tc.text,
      textAlign: 'center',
    },
    scroll: {
      paddingHorizontal: 16,
      paddingTop: 20,
    },
    identity: {
      alignItems: 'center',
      marginBottom: 26,
    },
    name: {
      fontSize: 20,
      fontWeight: '700',
      color: tc.text,
      marginTop: 12,
    },
    email: {
      fontSize: 13.5,
      color: tc.textSecondary,
      marginTop: 3,
    },
    iconRowWrap: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    iconChip: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: tc.chipBg,
      marginStart: 14,
    },
    iconRowBody: {
      flex: 1,
      // The row keeps its own 16pt start padding, which sits the label a
      // comfortable distance from the chip without a second constant.
      marginStart: -2,
    },
  });
