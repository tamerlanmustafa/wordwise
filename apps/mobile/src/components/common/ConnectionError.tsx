/**
 * ConnectionError — the screen could not load, in the two shapes that need.
 *
 * `ConnectionError` takes over an empty screen. `ConnectionStrip` is the same
 * failure reported quietly above content that is already there, because a
 * refresh failing behind a list the reader is halfway through is not worth
 * their place in it.
 *
 * Both read their copy from `connectionFailure`, so the two never disagree
 * about what happened, and both render through `EmptyState`/the app's own
 * surfaces rather than inventing a third error look.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { withTap } from '../../utils/feedback';
import { EmptyState } from './EmptyState';
import { connectionFailureCopy } from './connectionFailure';
import type { ConnectionFailure } from '../../services/connection';

interface Props {
  failure: ConnectionFailure;
  /** Omit to render without a button — see `retryable` in the copy map. */
  onRetry?: () => void;
}

/** Full-screen: use when there is nothing else on the screen to keep. */
export function ConnectionError({ failure, onRetry }: Props) {
  const { t } = useTranslation();
  const copy = connectionFailureCopy(failure);
  return (
    <EmptyState
      icon={copy.icon}
      tone={copy.tone}
      title={t(copy.titleKey)}
      body={t(copy.bodyKey)}
      ctaLabel={copy.retryable && onRetry ? t('action.retry') : undefined}
      onCta={copy.retryable && onRetry ? onRetry : undefined}
    />
  );
}

/**
 * Inline: use above content that survived the failure.
 *
 * One line, tappable, no icon ring and no vertical centring — everything that
 * makes the full-screen version an event is exactly what makes it wrong here.
 */
export function ConnectionStrip({ failure, onRetry }: Props) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const copy = connectionFailureCopy(failure);
  const tappable = copy.retryable && !!onRetry;

  return (
    <TouchableOpacity
      style={s.strip}
      onPress={tappable && onRetry ? withTap(onRetry) : undefined}
      disabled={!tappable}
      activeOpacity={0.7}
      accessibilityRole={tappable ? 'button' : 'alert'}
      accessibilityLabel={`${t(copy.titleKey)}. ${tappable ? t('action.retry') : ''}`.trim()}
    >
      <Ionicons name={copy.icon} size={15} color={tc.textSecondary} />
      <Text style={s.text} numberOfLines={1}>
        {t(copy.titleKey)}
      </Text>
      {tappable ? <Text style={s.action}>{t('action.retry')}</Text> : null}
    </TouchableOpacity>
  );
}

/**
 * The poor-connection notice: still loading, just slowly.
 *
 * Deliberately NOT a failure view. The request has not failed and may well
 * succeed, so this offers no Retry — a button that abandons a response already
 * on its way is a way to make a slow connection slower. It says what is
 * happening and nothing more.
 */
export function SlowConnectionStrip() {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  return (
    <View style={s.strip} accessibilityRole="alert">
      <Ionicons name="cellular-outline" size={15} color={tc.textSecondary} />
      <Text style={s.text} numberOfLines={1}>
        {t('common:connection.slowTitle')}
      </Text>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    strip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 16,
      marginBottom: 10,
      paddingVertical: 9,
      paddingHorizontal: 12,
      borderRadius: 10,
      backgroundColor: tc.paper,
      borderWidth: 1,
      borderColor: tc.border,
    },
    text: { flex: 1, fontSize: 12.5, color: tc.textSecondary },
    action: { fontSize: 12.5, fontWeight: '700', color: tc.goldOnSurface },
  });
