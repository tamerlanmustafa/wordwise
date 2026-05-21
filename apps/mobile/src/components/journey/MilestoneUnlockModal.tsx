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
import { useThemeColors, type ThemeColors } from '../../theme/tokens';

/** Display copy per slug. Keys MUST match the backend
 *  `milestone_service.MILESTONES` table. */
const MILESTONE_COPY: Record<
  string,
  { name: string; days: number; flavor: string; glyph: string }
> = {
  opening_weekend: {
    name: 'Opening Weekend',
    days: 7,
    flavor: 'A full week, every day. The hardest cliff is behind you.',
    glyph: '🎬',
  },
  box_office: {
    name: 'Box Office',
    days: 30,
    flavor: 'Thirty straight days. You are officially a regular.',
    glyph: '🎞️',
  },
  cult_classic: {
    name: 'Cult Classic',
    days: 100,
    flavor: 'A hundred days. This is now part of who you are.',
    glyph: '📽️',
  },
  criterion_collection: {
    name: 'Criterion Collection',
    days: 365,
    flavor: 'A full year, unbroken. Pinned to the canon.',
    glyph: '🏆',
  },
};

export interface MilestoneUnlockModalProps {
  /** The slug to celebrate. Pass null/undefined to hide. */
  slug: string | null;
  onDismiss: () => void;
}

export function MilestoneUnlockModal({ slug, onDismiss }: MilestoneUnlockModalProps) {
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
  const copy = MILESTONE_COPY[slug];
  if (!copy) {
    // Defensive: unknown slug from the server (e.g. new release). Render
    // a generic celebration rather than swallowing the moment.
    return (
      <View style={s.overlay}>
        <Animated.View style={[s.card, { opacity, transform: [{ scale }] }]}>
          <View style={[s.glyphDisc, { backgroundColor: tc.gold }]}>
            <Text style={s.glyph}>🎉</Text>
          </View>
          <Text style={s.eyebrow}>New unlock</Text>
          <Text style={s.name}>{slug}</Text>
          <TouchableOpacity onPress={onDismiss} style={s.cta} activeOpacity={0.85}>
            <Text style={s.ctaText}>Take a bow</Text>
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
        <Text style={s.eyebrow}>{copy.days}-day milestone</Text>
        <Text style={s.name}>{copy.name}</Text>
        <Text style={s.flavor}>{copy.flavor}</Text>
        <TouchableOpacity onPress={onDismiss} style={s.cta} activeOpacity={0.85}>
          <Text style={s.ctaText}>Take a bow</Text>
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
    glyph: { fontSize: 36 },
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
