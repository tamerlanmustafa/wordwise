/**
 * QuizResultScreen — end-of-session reward + journey-specific habit
 * loop closure.
 *
 * Two modes:
 *
 *   1. Legacy (movie / batch quiz). Renders stars+XP headline with a
 *      single "Done" CTA. `journey` prop is null.
 *
 *   2. Journey mode. Renders:
 *        • correct/total headline
 *        • 🔥 streak +1 ticker
 *        • Daily-goal pips (n / DAILY_GOAL)
 *        • Per-word ✓/× recap
 *        • Wall copy (when justHitGoal) OR a simple "back to movie" CTA
 *
 * Light/dark: tokens drive the surfaces, text, and CTA. The primary CTA
 * follows the same inversion rule as the Set Intro and Reel CTAs —
 * gold on dark, purple on light.
 */

import { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { cefrColors, cefrLabels } from '../theme/palette';
import { useThemeColors, useColorScheme, type ThemeColors } from '../theme/tokens';
import { DAILY_GOAL } from '../stores/dailyGoalStore';
import type { QuizCompleteResponse, QuizCardResultInput } from '../services/api';

export interface JourneyResultMeta {
  completedTileIdx: number;
  dailyDone: number;
  dailyStreak: number;
  /** True iff this completion pushed the user from < DAILY_GOAL to >=
   *  DAILY_GOAL today. Drives the celebration "wall" copy. Per-tile
   *  movie quizzes pass false; only the daily SRS review may set true. */
  justHitGoal: boolean;
  cardResults: QuizCardResultInput[];
}

export interface QuizResultScreenProps {
  result: QuizCompleteResponse;
  level: string;
  onDone: () => void;
  onPlayAgain?: () => void;
  /** Journey context. When present, the screen renders the streak +
      daily-pip + recap variant. */
  journey?: JourneyResultMeta | null;
}

export function QuizResultScreen({
  result,
  level,
  onDone,
  onPlayAgain,
  journey,
}: QuizResultScreenProps) {
  const tc = useThemeColors();
  const scheme = useColorScheme();
  const s = useMemo(() => makeStyles(tc, scheme), [tc, scheme]);

  const accent = cefrColors[level] || tc.primaryOnSurface;
  const label = cefrLabels[level] || level;

  // Primary CTA accent inverts: gold on dark, purple on light.
  const ctaBg = scheme === 'dark' ? tc.gold : tc.primary;
  const ctaFg = scheme === 'dark' ? tc.goldDeep : tc.textInverse;

  // Star animation (kept for both modes — small reward beat).
  const star1 = useRef(new Animated.Value(0)).current;
  const star2 = useRef(new Animated.Value(0)).current;
  const star3 = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animations = [star1, star2, star3].slice(0, result.stars).map((v, i) =>
      Animated.spring(v, {
        toValue: 1,
        useNativeDriver: true,
        delay: 200 + i * 250,
        friction: 4,
      })
    );
    Animated.parallel(animations).start();
  }, [result.stars, star1, star2, star3]);

  const accuracy = result.total_scored > 0
    ? Math.round((result.correct_count / result.total_scored) * 100)
    : null;

  // ── Journey mode ────────────────────────────────────────────────
  if (journey) {
    const dailyClamped = Math.min(journey.dailyDone, DAILY_GOAL);
    const hitWall = journey.justHitGoal;

    return (
      <SafeAreaView style={s.container} edges={['top']}>
        <View style={s.body}>
          {/* Headline: correct / total */}
          <Text style={s.headline}>
            {result.correct_count} of {result.total_scored} correct
          </Text>
          {accuracy !== null ? (
            <Text style={s.subHeadline}>{accuracy}% · +{result.xp_earned} XP</Text>
          ) : null}

          {/* Streak +1 ticker (only emphasized when hit3) */}
          <View style={s.streakRow}>
            <Text style={s.streakGlyph}>🔥</Text>
            <Text style={s.streakNumber}>{journey.dailyStreak}</Text>
            <Text style={s.streakLabel}>
              {hitWall ? 'day streak — +1 today!' : 'day streak'}
            </Text>
          </View>

          {/* Daily-goal pips */}
          <View style={s.pipsRow}>
            {Array.from({ length: DAILY_GOAL }).map((_, i) => (
              <View
                key={`pip-${i}`}
                style={[
                  s.pip,
                  i < dailyClamped ? s.pipFilled : s.pipEmpty,
                ]}
              ></View>
            ))}
            <Text style={s.pipsLabel}>{dailyClamped} / {DAILY_GOAL}</Text>
          </View>

          {/* Per-word ✓/× recap */}
          {journey.cardResults.length > 0 ? (
            <View style={s.recapCard}>
              {journey.cardResults.map((r, i) => (
                <View key={`${r.word}-${i}`} style={s.recapRow}>
                  <Text
                    style={[
                      s.recapMark,
                      r.is_correct ? s.recapMarkOk : s.recapMarkX,
                    ]}
                  >
                    {r.is_correct ? '✓' : '×'}
                  </Text>
                  <Text style={s.recapWord} numberOfLines={1}>{r.word}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Wall copy when the user just completed today's 3rd set. */}
          {hitWall ? (
            <View style={s.wallCard}>
              <Text style={s.wallTitle}>Today's done.</Text>
              <Text style={s.wallBody}>
                Come back tomorrow to keep the streak alive — or pick
                another movie and keep going.
              </Text>
            </View>
          ) : null}
        </View>

        {/* Footer CTA — single button, always returns to wherever the
            quiz was launched from (preview hub or movie detail). */}
        <View style={s.footer}>
          <TouchableOpacity
            onPress={onDone}
            style={[s.primaryBtn, { backgroundColor: ctaBg }]}
            activeOpacity={0.8}
          >
            <Text style={[s.primaryBtnText, { color: ctaFg }]}>
              {hitWall ? 'Stop for today' : 'Done'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Legacy mode (movie / batch quiz) ────────────────────────────
  const headline =
    result.stars === 3 ? 'Amazing!' :
    result.stars === 2 ? 'Nice work!' :
    result.stars === 1 ? 'Good try!' :
    'Keep going!';

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.body}>
        <View style={[s.levelBadge, { backgroundColor: accent }]}>
          <Text style={s.levelBadgeText}>{level}</Text>
        </View>
        <Text style={s.levelLabel}>{label}</Text>

        <Text style={s.headline}>{headline}</Text>

        <View style={s.starsRow}>
          {[star1, star2, star3].map((v, i) => (
            <Animated.Text
              key={i}
              style={[
                s.star,
                { opacity: v, transform: [{ scale: v }] },
              ]}
            >
              {i < result.stars ? '⭐' : '☆'}
            </Animated.Text>
          ))}
        </View>

        <View style={s.statsCard}>
          {accuracy !== null ? (
            <StatRow label="Accuracy" value={`${accuracy}%`} s={s} />
          ) : null}
          <StatRow label="Correct" value={`${result.correct_count} / ${result.total_scored}`} s={s} />
          <StatRow label="XP earned" value={`+${result.xp_earned}`} emphasis s={s} />
        </View>

        <View style={s.footer}>
          {onPlayAgain ? (
            <TouchableOpacity
              onPress={onPlayAgain}
              style={[s.ghostBtn, { borderColor: accent }]}
              activeOpacity={0.7}
            >
              <Text style={[s.ghostBtnText, { color: accent }]}>Play again</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={onDone}
            style={[s.primaryBtn, { backgroundColor: ctaBg }]}
            activeOpacity={0.8}
          >
            <Text style={[s.primaryBtnText, { color: ctaFg }]}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

function StatRow({
  label,
  value,
  emphasis,
  s,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  s: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={s.statRow}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statValue, emphasis ? s.statValueEmphasis : null]}>{value}</Text>
    </View>
  );
}

const makeStyles = (tc: ThemeColors, _scheme: 'light' | 'dark') => StyleSheet.create({
  container: { flex: 1, backgroundColor: tc.background },
  body: { flex: 1, padding: 24, paddingTop: 32 },

  // Shared
  headline: {
    fontSize: 28, fontWeight: '800', color: tc.text,
    textAlign: 'center',
  },
  subHeadline: {
    fontSize: 14, color: tc.textSecondary,
    textAlign: 'center', marginTop: 6,
  },
  eyebrow: {
    fontSize: 10, fontWeight: '900', color: tc.goldOnSurface,
    letterSpacing: 1.8, marginBottom: 6,
  },
  footer: {
    paddingHorizontal: 24, paddingBottom: 16,
    gap: 10,
  },
  primaryBtn: {
    paddingVertical: 14, borderRadius: 14, alignItems: 'center',
  },
  primaryBtnText: { fontSize: 15, fontWeight: '800', letterSpacing: 0.3 },
  ghostBtn: {
    paddingVertical: 12, borderRadius: 14, alignItems: 'center',
    borderWidth: 1.5,
  },
  ghostBtnText: { fontSize: 14, fontWeight: '700' },

  // Journey-mode pieces
  streakRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 6, marginTop: 20,
  },
  streakGlyph: { fontSize: 18 },
  streakNumber: { fontSize: 22, fontWeight: '900', color: tc.goldOnSurface },
  streakLabel: { fontSize: 13, color: tc.textSecondary },

  pipsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, marginTop: 14,
  },
  pip: { width: 28, height: 8, borderRadius: 4 },
  pipFilled: { backgroundColor: tc.goldOnSurface },
  pipEmpty: { backgroundColor: tc.border },
  pipsLabel: {
    fontSize: 12, fontWeight: '700',
    color: tc.textSecondary, marginLeft: 6,
  },

  recapCard: {
    marginTop: 22, padding: 16,
    backgroundColor: tc.paper, borderRadius: 14,
    borderWidth: 1, borderColor: tc.border,
    gap: 8,
  },
  recapRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  recapMark: { fontSize: 16, fontWeight: '900', width: 18, textAlign: 'center' },
  recapMarkOk: { color: tc.success },
  recapMarkX: { color: tc.error },
  recapWord: {
    fontSize: 15, fontWeight: '700', color: tc.text, flex: 1,
  },

  upNextCard: {
    marginTop: 22, padding: 16,
    backgroundColor: tc.paper, borderRadius: 14,
    borderWidth: 1, borderColor: tc.border,
  },
  upNextRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  upNextPoster: {
    width: 56, height: 84, borderRadius: 6,
    backgroundColor: tc.reelStockDeep,
  },
  upNextPosterEmpty: {},
  upNextText: { flex: 1 },
  upNextLabel: {
    fontSize: 11, color: tc.textSecondary,
    fontWeight: '700', letterSpacing: 0.4, marginBottom: 4,
  },
  upNextTitle: {
    fontSize: 16, fontWeight: '800', color: tc.text, letterSpacing: -0.2,
  },

  wallCard: {
    marginTop: 22, padding: 18,
    backgroundColor: tc.primaryTint,
    borderRadius: 14,
    borderWidth: 1, borderColor: tc.border,
  },
  wallTitle: { fontSize: 18, fontWeight: '800', color: tc.text, marginBottom: 6 },
  wallBody: { fontSize: 13, color: tc.textSecondary, lineHeight: 18 },

  // Legacy pieces (untouched semantics)
  levelBadge: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center',
  },
  levelBadgeText: { fontSize: 24, fontWeight: '800', color: tc.textInverse },
  levelLabel: { fontSize: 14, color: tc.textSecondary, marginTop: 8, textAlign: 'center' },
  starsRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 16, gap: 8 },
  star: { fontSize: 64 },
  statsCard: {
    width: '100%', marginTop: 32, padding: 20,
    backgroundColor: tc.paper, borderRadius: 16,
    borderWidth: 1, borderColor: tc.border, gap: 12,
  },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statLabel: { fontSize: 14, color: tc.textSecondary },
  statValue: { fontSize: 18, fontWeight: '700', color: tc.text },
  statValueEmphasis: { color: tc.primaryOnSurface, fontSize: 20 },
});
