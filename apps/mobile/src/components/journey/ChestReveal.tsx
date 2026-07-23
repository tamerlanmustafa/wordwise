/**
 * ChestReveal — the variable-reward animation that fires once per daily
 * SRS session (server-picked via POST /srs/session/complete).
 *
 * Renders as a centered card with a spring-scale entrance. The icon and
 * accent color vary by reward kind:
 *   • xp_small   ⭐  gold     "+25 XP"
 *   • xp_large   🌟  gold     "+100 XP"
 *   • freeze     🛡️  blue-ish "Streak freeze"
 *   • cosmetic   🎬  purple   "Director's Cut Frame"
 *
 * v1 keeps it deliberately simple — placeholder shapes/emoji rather than
 * custom art, per the v0.6 decision in SRS_HABIT_ENGINE_PLAN.md. The
 * cosmetic reward is display-only (no persistent collection yet — W10
 * milestones will own that).
 */

import { useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { useTranslation } from 'react-i18next';
import type { ChestKind, ChestPayload } from '../../services/api';

export interface ChestRevealProps {
  chest: ChestPayload;
  /** Called when the user taps "Collect". The reveal stays mounted
   *  until this is invoked so the user can dwell on the reward. */
  onCollect: () => void;
}

interface KindStyle {
  glyph: string;
  accent: keyof ThemeColors;
  fg: keyof ThemeColors;
}

const KIND_STYLES: Record<ChestKind, KindStyle> = {
  xp_small: { glyph: '⭐', accent: 'gold', fg: 'goldDeep' },
  xp_large: { glyph: '🌟', accent: 'gold', fg: 'goldDeep' },
  freeze:   { glyph: '🛡️', accent: 'primary', fg: 'textInverse' },
  cosmetic: { glyph: '🎬', accent: 'primary', fg: 'textInverse' },
};

export function ChestReveal({ chest, onCollect }: ChestRevealProps) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const ks = KIND_STYLES[chest.kind] ?? KIND_STYLES.xp_small;
  const accent = tc[ks.accent];
  const fg = tc[ks.fg];

  // Spring in on mount.
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        friction: 5,
        tension: 110,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [scale, opacity]);

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <Animated.View
        style={[
          styles.card,
          {
            backgroundColor: tc.paper,
            borderColor: accent,
            opacity,
            transform: [{ scale }],
          },
        ]}
      >
        <View style={[styles.iconDisc, { backgroundColor: accent }]}>
          <Text style={styles.iconGlyph}>{ks.glyph}</Text>
        </View>
        <Text style={[styles.eyebrow, { color: tc.textSecondary }]}>
          {t('movies:journey.dailyChest')}
        </Text>
        <Text style={[styles.label, { color: tc.text }]} numberOfLines={2}>
          {chest.label}
        </Text>
        {chest.kind === 'cosmetic' ? (
          <Text style={[styles.subLabel, { color: tc.textSecondary }]}>
            {t('movies:journey.chestAdded')}
          </Text>
        ) : null}
        <TouchableOpacity
          onPress={onCollect}
          activeOpacity={0.85}
          style={[styles.cta, { backgroundColor: accent }]}
        >
          <Text style={[styles.ctaText, { color: fg }]}>{t('movies:journey.collect')}</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 320,
    borderWidth: 2,
    borderRadius: 18,
    paddingHorizontal: 24,
    paddingVertical: 28,
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  iconDisc: {
    width: 64, height: 64, borderRadius: 32,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 6,
  },
  iconGlyph: { fontSize: 32 },
  eyebrow: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  label: {
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.1,
  },
  subLabel: {
    fontSize: 13,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  cta: {
    marginTop: 14,
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 999,
  },
  ctaText: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
});
