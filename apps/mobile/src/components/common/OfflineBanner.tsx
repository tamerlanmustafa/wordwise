/**
 * OfflineBanner — the gold "you're offline" strip shown above still-usable
 * downloaded reels (States §D). Surfaces a "N changes waiting to sync" count
 * from syncQueueStore so the user knows their offline edits aren't lost.
 *
 * Connectivity comes from authStore's `offline_authenticated` status (the
 * app's existing offline signal — no NetInfo dependency). Renders nothing when
 * online with an empty queue.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { useAuthStore } from '../../stores/authStore';
import { useSyncQueueStore } from '../../stores/syncQueueStore';

export function OfflineBanner() {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const offline = useAuthStore((st) => st.status === 'offline_authenticated');
  const pending = useSyncQueueStore((st) => st.queue.length);

  if (!offline && pending === 0) return null;

  const sub =
    pending > 0
      ? t('offline.pending', { count: pending })
      : t('offline.downloadsWork');

  return (
    <View style={s.bar} accessibilityRole="alert">
      <Ionicons name="cloud-offline-outline" size={16} color={tc.goldDeep} />
      <View style={s.text}>
        <Text style={s.title}>{offline ? t('offline.title') : t('offline.syncing')}</Text>
        <Text style={s.sub}>{sub}</Text>
      </View>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginHorizontal: 16,
      marginBottom: 8,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 12,
      backgroundColor: tc.gold,
    },
    text: { flex: 1, minWidth: 0 },
    title: { fontSize: 13, fontWeight: '900', color: tc.goldDeep },
    sub: { fontSize: 11.5, fontWeight: '600', color: tc.goldDeep, opacity: 0.85, marginTop: 1 },
  });
