/**
 * MilestoneUnlockModal — celebrates a newly-unlocked cinema-named
 * streak milestone (v0.6 W10). Fires once per milestone, ever, after
 * ReviewScreen confirms the unlock via the post-session response.
 *
 * The cosmetic itself is deferred to v1.1 — for now the modal IS the
 * celebration. Each slug has its own display name, eyebrow, and emoji
 * accent so the user feels the cinematic theme.
 *
 * Multi-unlock handling: if the user crossed two milestones in one bump
 * (rare, possible during a repair backfill), the parent should queue
 * them and present one at a time.
 */

import { useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { ConfettiIcon } from '../ui/icons';

/** Display copy per slug. Keys MUST match the backend
 *  `milestone_service.MILESTONES` table. */
// Only the non-linguistic bits live here; `name` and `flavor` are looked up
// per-slug in `movies:journey.milestone.*` so they follow the app language.
const MILESTONE_META: Record<string, { days: number; glyph: string }> = {
  opening_weekend: { days: 7, glyph: '\u{1F3AC}' },
  box_office: { days: 30, glyph: '\u{1F39E}\u{FE0F}' },
  cult_classic: { days: 100, glyph: '\u{1F4FD}\u{FE0F}' },
  criterion_collection: { days: 365, glyph: '\u{1F3C6}' },
};

export interface MilestoneUnlockModalProps {
  /** The slug to celebrate. Pass null/undefined to hide. */
  slug: string | null;
  onDismiss: () => void;
}

export function MilestoneUnlockModal({ slug, onDismiss }: MilestoneUnlockModalProps) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = makeStyles(tc);

  // Spring in on mount. Re-fires when slug changes (caller queues).
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!slug) return;
    scale.setValue(0);
    opacity.setValue(0);
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        friction: 5,
        tension: 100,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 240,
        useNativeDriver: true,
      }),
    ]).start();
  }, [slug, scale, opacity]);

  if (!slug) return null;
  const copy = MILESTONE_META[slug];
  if (!copy) {
    // Defensive: unknown slug from the server (e.g. new release). Render
    // a generic celebration rather than swallowing the moment.
    return (
      <View style={s.overlay}>
        <Animated.View style={[s.card, { opacity, transform: [{ scale }] }]}>
          <View style={[s.glyphDisc, { backgroundColor: tc.gold }]}>
            <ConfettiIcon size={40} style={s.glyph} />
          </View>
          <Text style={s.eyebrow}>{t('movies:journey.newUnlock')}</Text>
          <Text style={s.name}>{slug}</Text>
          <TouchableOpacity onPress={onDismiss} style={s.cta} activeOpacity={0.85}>
            <Text style={s.ctaText}>{t('movies:journey.takeABow')}</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    );
  }

  return (
    <View style={s.overlay}>
      <Animated.View style={[s.card, { opacity, transform: [{ scale }] }]}>
        <View style={[s.glyphDisc, { backgroundColor: tc.gold }]}>
          <Text style={s.glyph}>{copy.glyph}</Text>
        </View>
        <Text style={s.eyebrow}>{t('movies:journey.milestone.dayMilestone', { days: copy.days })}</Text>
        <Text style={s.name}>{t(`movies:journey.milestone.${slug}_name`)}</Text>
        <Text style={s.flavor}>{t(`movies:journey.milestone.${slug}_flavor`)}</Text>
        <TouchableOpacity onPress={onDismiss} style={s.cta} activeOpacity={0.85}>
          <Text style={s.ctaText}>{t('movies:journey.takeABow')}</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.62)',
      padding: 24,
    },
    card: {
      width: '100%',
      maxWidth: 340,
      borderRadius: 18,
      borderWidth: 2,
      borderColor: tc.gold,
      backgroundColor: tc.paper,
      paddingHorizontal: 22,
      paddingVertical: 28,
      alignItems: 'center',
      gap: 10,
      shadowColor: '#000',
      shadowOpacity: 0.35,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 10 },
      elevation: 12,
    },
    glyphDisc: {
      width: 72,
      height: 72,
      borderRadius: 36,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 6,
    },
    glyph: { alignSelf: 'center' },
    eyebrow: {
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 1.6,
      textTransform: 'uppercase',
      color: tc.goldOnSurface,
    },
    name: {
      fontSize: 26,
      fontWeight: '900',
      color: tc.text,
      textAlign: 'center',
      letterSpacing: 0.2,
    },
    flavor: {
      fontSize: 13,
      lineHeight: 19,
      color: tc.textSecondary,
      textAlign: 'center',
      fontStyle: 'italic',
      marginTop: 2,
    },
    cta: {
      marginTop: 16,
      paddingHorizontal: 32,
      paddingVertical: 12,
      borderRadius: 999,
      backgroundColor: tc.gold,
    },
    ctaText: {
      fontSize: 15,
      fontWeight: '900',
      color: tc.goldDeep,
      letterSpacing: 0.3,
    },
  });
