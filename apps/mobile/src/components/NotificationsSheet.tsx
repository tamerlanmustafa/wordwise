/**
 * NotificationsSheet — the Home-header bell's slide-up panel. Same
 * absolute-overlay pattern as UserMenuSheet (no Modal, so the
 * GlobalBottomBar behind it stays interactive; scrim and sheet stop at
 * `bottomOffset`) and the same cinema styling: paper surface, gold accents,
 * stroked icons in circular chips, no emoji.
 *
 * Content comes from notificationsStore (derived items — see the store's
 * header comment). Opening the sheet refreshes the list; tapping a row marks
 * it read and, when it has a target, closes the sheet and navigates.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useThemeColors, type ThemeColors } from '../theme/tokens';
import { useTranslation } from 'react-i18next';
import {
  useNotificationsStore,
  selectHasUnread,
  type AppNotification,
  type NotificationTarget,
} from '../stores/notificationsStore';
import { HomeIcon } from './home/HomeIcons';

const KIND_ICON: Record<AppNotification['kind'], 'play' | 'star' | 'bell'> = {
  reviews_due: 'play',
  streak_risk: 'star',
  welcome: 'bell',
};

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Navigate to the screen a tapped notification points at. */
  onNavigate: (target: NotificationTarget) => void;
  /** Height of GlobalBottomBar — sheet and scrim stop above it. */
  bottomOffset: number;
}

export function NotificationsSheet({ visible, onClose, onNavigate, bottomOffset }: Props) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  const items = useNotificationsStore((s) => s.items);
  const hasUnread = useNotificationsStore(selectHasUnread);

  const slideAnim = useRef(new Animated.Value(900)).current;
  const hiddenY = useRef(900);

  useEffect(() => {
    if (visible) void useNotificationsStore.getState().refresh();
    Animated.spring(slideAnim, {
      toValue: visible ? 0 : hiddenY.current,
      useNativeDriver: true,
      bounciness: 0,
      speed: 18,
    }).start();
  }, [visible, slideAnim]);

  const onSheetLayout = useCallback(
    (e: LayoutChangeEvent) => {
      hiddenY.current = e.nativeEvent.layout.height + bottomOffset + 24;
      if (!visible) slideAnim.setValue(hiddenY.current);
    },
    [visible, bottomOffset, slideAnim],
  );

  const handleItemPress = (item: AppNotification) => {
    void useNotificationsStore.getState().markRead(item.id);
    if (item.target) {
      const target = item.target;
      onClose();
      setTimeout(() => onNavigate(target), 200);
    }
  };

  return (
    <View
      style={[StyleSheet.absoluteFillObject, { bottom: bottomOffset }]}
      pointerEvents={visible ? 'box-none' : 'none'}
    >
      {visible && (
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.scrim} />
        </TouchableWithoutFeedback>
      )}

      <Animated.View
        onLayout={onSheetLayout}
        style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}
      >
        <View style={styles.handle} />

        <View style={styles.headerRow}>
          <Text style={styles.eyebrow}>{t('notifications:sheet.title')}</Text>
          {hasUnread ? (
            <TouchableOpacity
              onPress={() => void useNotificationsStore.getState().markAllRead()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('notifications:sheet.markAllReadA11y')}
            >
              <Text style={styles.markAll}>{t('notifications:sheet.markAllRead')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {items.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyChip}>
              <HomeIcon name="bell" size={20} color={tc.textFaint} />
            </View>
            <Text style={styles.emptyTitle}>{t('notifications:sheet.emptyTitle')}</Text>
            <Text style={styles.emptyBody}>
              {t('notifications:sheet.emptyBody')}
            </Text>
          </View>
        ) : (
          items.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={styles.row}
              onPress={() => handleItemPress(item)}
              activeOpacity={0.6}
              accessibilityRole="button"
              accessibilityLabel={item.title}
            >
              <View style={styles.iconChip}>
                <HomeIcon name={KIND_ICON[item.kind]} size={16} color={tc.textSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, !item.read && styles.rowTitleUnread]}>
                  {item.title}
                </Text>
                <Text style={styles.rowBody} numberOfLines={2}>
                  {item.body}
                </Text>
              </View>
              {!item.read ? <View style={styles.unreadDot} /> : null}
            </TouchableOpacity>
          ))
        )}
      </Animated.View>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
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
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      borderTopWidth: 1,
      borderColor: tc.border,
      paddingHorizontal: 20,
      paddingTop: 10,
      paddingBottom: 22,
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: tc.border,
      alignSelf: 'center',
      marginBottom: 14,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingBottom: 10,
    },
    eyebrow: {
      fontSize: 9.5,
      fontWeight: '900',
      letterSpacing: 2,
      color: tc.goldOnSurface,
      textTransform: 'uppercase',
    },
    markAll: {
      fontSize: 12.5,
      fontWeight: '800',
      letterSpacing: 0.3,
      color: tc.goldOnSurface,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 11,
    },
    iconChip: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: tc.chipBg,
      borderWidth: 1,
      borderColor: tc.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowTitle: {
      fontSize: 14.5,
      fontWeight: '600',
      color: tc.textSecondary,
    },
    rowTitleUnread: {
      color: tc.text,
      fontWeight: '700',
    },
    rowBody: {
      fontSize: 12.5,
      color: tc.textSecondary,
      marginTop: 2,
      lineHeight: 17,
    },
    unreadDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: tc.gold,
    },
    empty: {
      alignItems: 'center',
      paddingVertical: 26,
      gap: 6,
    },
    emptyChip: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: tc.chipBg,
      borderWidth: 1,
      borderColor: tc.border,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 4,
    },
    emptyTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: tc.text,
    },
    emptyBody: {
      fontSize: 12.5,
      color: tc.textSecondary,
      textAlign: 'center',
    },
  });
