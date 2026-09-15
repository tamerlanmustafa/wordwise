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
 * It is a hub, not a settings screen: the four places account business
 * actually happens, then the appearance control just above Log out. Who is
 * signed in — picture, username, email — heads Settings instead, above the
 * username field it is edited in. Everything a row leads to used to
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
import { TopInsetView } from '../common/TopInsetView';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { useBottomBarInset } from '../../hooks/useBottomBarInset';
import { MenuIcon, type MenuIconName } from '../ui/icons/MenuIcons';
import { LinkRow, Rows, Section, Segmented } from './settings/SettingsUI';
import { showConfirm } from '../../stores/confirmStore';
import { useThemeStore, type ThemePreference } from '../../stores/themeStore';

/** In the order the control shows them. */
const THEME_OPTIONS: ThemePreference[] = ['light', 'system', 'dark'];

interface Props {
  isAdmin: boolean;
  onNavigateToSettings: () => void;
  onNavigateToNotifications: () => void;
  onNavigateToAccount: () => void;
  onNavigateToLegal: () => void;
  onNavigateToAdmin: () => void;
  onLogout: () => void;
}

export function ProfileScreen({
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
  const themePreference = useThemeStore((st) => st.preference);
  const setThemePreference = useThemeStore((st) => st.setPreference);

  const confirmLogout = () =>
    showConfirm({
      title: t('settings:menu.logOutTitle'),
      message: t('settings:menu.logOutBody'),
      confirmLabel: t('settings:menu.logOut'),
      tone: 'destructive',
      onConfirm: onLogout,
    });

  return (
    <TopInsetView style={s.container}>
      <View style={s.header}>
        <Text style={s.headerTitle}>{t('nav.profile')}</Text>
      </View>

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: barInset + 24 }]}
      >
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

        {/* Appearance, directly above Log out. It lived in Settings until
            2026-09-15, and this is still the app's only control over the
            theme preference. */}
        <Section title={t('settings:appearance')}>
          <Segmented
            value={themePreference}
            onChange={setThemePreference}
            options={THEME_OPTIONS.map((opt) => ({
              value: opt,
              label: t(`settings:theme.${opt}`),
            }))}
          />
        </Section>

        <Section>
          <LinkRow label={t('settings:menu.logout')} muted onPress={confirmLogout} />
        </Section>
      </ScrollView>
    </TopInsetView>
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
    // `TopInsetView` already clears the notch and the Dynamic
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
