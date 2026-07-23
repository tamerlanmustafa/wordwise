/**
 * ReelReady — the success state after a film's script is analyzed (Add-a-film
 * §B, step 4). Poster with a green success badge, the comprehension promise,
 * and a primary "Start first lesson" CTA plus a secondary "Back to my reel".
 */

import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { SERIF_FAMILY, MONO_FAMILY } from '../../theme/fonts';
import { TmdbPoster } from './TmdbPoster';
import { PressableScale } from '../ui/PressableScale';

export interface ReelReadyProps {
  tmdbId: number;
  title: string;
  /** Optional word count for the promise line. */
  wordCount?: number | null;
  /** Optional comprehension % the user reaches by learning the list. */
  comprehensionPct?: number | null;
  primaryLabel?: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}

export function ReelReady({
  tmdbId,
  title,
  wordCount,
  comprehensionPct,
  primaryLabel = 'Start first lesson →',
  onPrimary,
  secondaryLabel = 'Back to my reel',
  onSecondary,
}: ReelReadyProps) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  const promise =
    wordCount != null && comprehensionPct != null
      ? `${wordCount} words across short lessons. Learn them all and you'll understand ${comprehensionPct}% of the dialogue.`
      : wordCount != null
        ? `${wordCount} words across short lessons — learn them before you watch.`
        : "We've built your word list. Learn it before you watch and you'll follow every line.";

  return (
    <SafeAreaView style={s.root}>
      <View style={s.body}>
        <View style={s.posterWrap}>
          <TmdbPoster tmdbId={tmdbId} style={s.poster} />
          <View style={s.badge}>
            <Ionicons name="checkmark" size={22} color="#fff" />
          </View>
        </View>
        <Text style={s.eyebrow}>{t('movies:analyzing.reelReady')}</Text>
        <Text style={s.title}>{title} is on your reel</Text>
        <Text style={s.promise}>{promise}</Text>
      </View>
      <View style={s.ctaWrap}>
        <PressableScale style={s.primary} onPress={onPrimary} accessibilityRole="button" accessibilityLabel={primaryLabel}>
          <Text style={s.primaryText}>{primaryLabel}</Text>
        </PressableScale>
        {onSecondary ? (
          <PressableScale style={s.secondary} onPress={onSecondary} accessibilityRole="button" accessibilityLabel={secondaryLabel}>
            <Text style={s.secondaryText}>{secondaryLabel}</Text>
          </PressableScale>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: tc.background },
    body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
    posterWrap: { position: 'relative' },
    poster: { width: 120, height: 176, borderRadius: 12, backgroundColor: tc.reelStockDeep },
    badge: {
      position: 'absolute',
      bottom: -10,
      right: -10,
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: tc.success,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 3,
      borderColor: tc.background,
    },
    eyebrow: {
      marginTop: 26,
      fontFamily: MONO_FAMILY,
      fontSize: 10.5,
      fontWeight: '800',
      letterSpacing: 2,
      color: tc.goldOnSurface,
      textTransform: 'uppercase',
    },
    title: { marginTop: 8, fontFamily: SERIF_FAMILY, fontSize: 27, fontWeight: '700', letterSpacing: -0.5, color: tc.text, textAlign: 'center' },
    promise: { marginTop: 10, fontSize: 14, lineHeight: 21, color: tc.textSecondary, textAlign: 'center', maxWidth: 280 },
    ctaWrap: { paddingHorizontal: 24, paddingBottom: 14, gap: 14 },
    primary: {
      backgroundColor: tc.gold,
      paddingVertical: 15,
      borderRadius: 14,
      alignItems: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 10 },
      elevation: 6,
    },
    primaryText: { color: tc.goldDeep, fontWeight: '900', fontSize: 14, letterSpacing: 0.6, textTransform: 'uppercase' },
    secondary: { alignItems: 'center', paddingVertical: 6 },
    secondaryText: { color: tc.textSecondary, fontSize: 13, fontWeight: '700' },
  });
