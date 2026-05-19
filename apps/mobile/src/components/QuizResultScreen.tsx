/**
 * QuizResultScreen — end-of-session reward + journey-specific habit
 * loop closure.
 *
 * Two modes:
 *
 *   1. Legacy (movie / batch quiz). Renders the original stars+XP
 *      headline with a single "Done" CTA. `journey` prop is null.
 *
 *   2. Journey mode. Renders:
 *        • correct/total headline
 *        • 🔥 streak +1 ticker
 *        • Daily-goal pips (n / DAILY_GOAL)
 *        • Per-word ✓/× recap
 *        • Wall copy (when justHit3) OR a simple "back to movie" CTA
 *      The result screen no longer chains into the next reel tile —
 *      the user returns to the just-quizzed movie's preview hub so
 *      they can see fresh stars/progress, then decide what's next.
 */

import { useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, cefrColors, cefrLabels } from '../theme/palette';
import { DAILY_GOAL } from '../stores/dailyGoalStore';
import type { QuizCompleteResponse, QuizCardResultInput } from '../services/api';

export interface JourneyResultMeta {
  completedTileIdx: number;
  dailyDone: number;
  dailyStreak: number;
  justHit3: boolean;
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

const GOLD = '#FFD166';

export function QuizResultScreen({
  result,
  level,
  onDone,
  onPlayAgain,
  journey,
}: QuizResultScreenProps) {
  const color = cefrColors[level] || colors.primary;
  const label = cefrLabels[level] || level;

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
    const hitWall = journey.justHit3;

    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.body}>
          {/* Headline: correct / total */}
          <Text style={styles.headline}>
            {result.correct_count} of {result.total_scored} correct
          </Text>
          {accuracy !== null ? (
            <Text style={styles.subHeadline}>{accuracy}% · +{result.xp_earned} XP</Text>
          ) : null}

          {/* Streak +1 ticker (only emphasized when hit3) */}
          <View style={styles.streakRow}>
            <Text style={styles.streakGlyph}>🔥</Text>
            <Text style={styles.streakNumber}>{journey.dailyStreak}</Text>
            <Text style={styles.streakLabel}>
              {hitWall ? 'day streak — +1 today!' : 'day streak'}
            </Text>
          </View>

          {/* Daily-goal pips */}
          <View style={styles.pipsRow}>
            {Array.from({ length: DAILY_GOAL }).map((_, i) => (
              <View
                key={`pip-${i}`}
                style={[
                  styles.pip,
                  i < dailyClamped ? styles.pipFilled : styles.pipEmpty,
                ]}
              ></View>
            ))}
            <Text style={styles.pipsLabel}>{dailyClamped} / {DAILY_GOAL}</Text>
          </View>

          {/* Per-word ✓/× recap */}
          {journey.cardResults.length > 0 ? (
            <View style={styles.recapCard}>
              {journey.cardResults.map((r, i) => (
                <View key={`${r.word}-${i}`} style={styles.recapRow}>
                  <Text
                    style={[
                      styles.recapMark,
                      r.is_correct ? styles.recapMarkOk : styles.recapMarkX,
                    ]}
                  >
                    {r.is_correct ? '✓' : '×'}
                  </Text>
                  <Text style={styles.recapWord} numberOfLines={1}>{r.word}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Wall copy when the user just completed today's 3rd set. */}
          {hitWall ? (
            <View style={styles.wallCard}>
              <Text style={styles.wallTitle}>Today's done.</Text>
              <Text style={styles.wallBody}>
                Come back tomorrow to keep the streak alive — or pick
                another movie and keep going.
              </Text>
            </View>
          ) : null}
        </View>

        {/* Footer CTA — single button, always returns to wherever the
            quiz was launched from (preview hub or movie detail). */}
        <View style={styles.footer}>
          <TouchableOpacity
            onPress={onDone}
            style={[styles.primaryBtn, { backgroundColor: GOLD }]}
            activeOpacity={0.8}
          >
            <Text style={[styles.primaryBtnText, { color: '#3a2400' }]}>
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
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.body}>
        <View style={[styles.levelBadge, { backgroundColor: color }]}>
          <Text style={styles.levelBadgeText}>{level}</Text>
        </View>
        <Text style={styles.levelLabel}>{label}</Text>

        <Text style={styles.headline}>{headline}</Text>

        <View style={styles.starsRow}>
          {[star1, star2, star3].map((v, i) => (
            <Animated.Text
              key={i}
              style={[
                styles.star,
                { opacity: v, transform: [{ scale: v }] },
              ]}
            >
              {i < result.stars ? '⭐' : '☆'}
            </Animated.Text>
          ))}
        </View>

        <View style={styles.statsCard}>
          {accuracy !== null ? (
            <StatRow label="Accuracy" value={`${accuracy}%`} />
          ) : null}
          <StatRow label="Correct" value={`${result.correct_count} / ${result.total_scored}`} />
          <StatRow label="XP earned" value={`+${result.xp_earned}`} emphasis />
        </View>

        <View style={styles.footer}>
          {onPlayAgain ? (
            <TouchableOpacity
              onPress={onPlayAgain}
              style={[styles.ghostBtn, { borderColor: color }]}
              activeOpacity={0.7}
            >
              <Text style={[styles.ghostBtnText, { color }]}>Play again</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={onDone}
            style={[styles.primaryBtn, { backgroundColor: color }]}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

function StatRow({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, emphasis ? styles.statValueEmphasis : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, padding: 24, paddingTop: 32 },

  // Shared
  headline: {
    fontSize: 28, fontWeight: '800', color: colors.text,
    textAlign: 'center',
  },
  subHeadline: {
    fontSize: 14, color: colors.textSecondary,
    textAlign: 'center', marginTop: 6,
  },
  eyebrow: {
    fontSize: 10, fontWeight: '900', color: GOLD,
    letterSpacing: 1.8, marginBottom: 6,
  },
  footer: {
    paddingHorizontal: 24, paddingBottom: 16,
    gap: 10,
  },
  primaryBtn: {
    paddingVertical: 14, borderRadius: 14, alignItems: 'center',
  },
  primaryBtnText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.3 },
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
  streakNumber: { fontSize: 22, fontWeight: '900', color: GOLD },
  streakLabel: { fontSize: 13, color: colors.textSecondary },

  pipsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, marginTop: 14,
  },
  pip: { width: 28, height: 8, borderRadius: 4 },
  pipFilled: { backgroundColor: GOLD },
  pipEmpty: { backgroundColor: 'rgba(0,0,0,0.08)' },
  pipsLabel: {
    fontSize: 12, fontWeight: '700',
    color: colors.textSecondary, marginLeft: 6,
  },

  recapCard: {
    marginTop: 22, padding: 16,
    backgroundColor: colors.paper, borderRadius: 14,
    borderWidth: 1, borderColor: colors.border,
    gap: 8,
  },
  recapRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  recapMark: { fontSize: 16, fontWeight: '900', width: 18, textAlign: 'center' },
  recapMarkOk: { color: '#4CAF50' },
  recapMarkX: { color: '#F44336' },
  recapWord: {
    fontSize: 15, fontWeight: '700', color: colors.text, flex: 1,
  },

  upNextCard: {
    marginTop: 22, padding: 16,
    backgroundColor: colors.paper, borderRadius: 14,
    borderWidth: 1, borderColor: colors.border,
  },
  upNextRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  upNextPoster: {
    width: 56, height: 84, borderRadius: 6,
    backgroundColor: '#221710',
  },
  upNextPosterEmpty: {},
  upNextText: { flex: 1 },
  upNextLabel: {
    fontSize: 11, color: colors.textSecondary,
    fontWeight: '700', letterSpacing: 0.4, marginBottom: 4,
  },
  upNextTitle: {
    fontSize: 16, fontWeight: '800', color: colors.text, letterSpacing: -0.2,
  },

  wallCard: {
    marginTop: 22, padding: 18,
    backgroundColor: 'rgba(255,209,102,0.10)',
    borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(255,209,102,0.45)',
  },
  wallTitle: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: 6 },
  wallBody: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },

  // Legacy pieces (untouched semantics)
  levelBadge: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center',
  },
  levelBadgeText: { fontSize: 24, fontWeight: '800', color: '#FFFFFF' },
  levelLabel: { fontSize: 14, color: colors.textSecondary, marginTop: 8, textAlign: 'center' },
  starsRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 16, gap: 8 },
  star: { fontSize: 64 },
  statsCard: {
    width: '100%', marginTop: 32, padding: 20,
    backgroundColor: colors.paper, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border, gap: 12,
  },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statLabel: { fontSize: 14, color: colors.textSecondary },
  statValue: { fontSize: 18, fontWeight: '700', color: colors.text },
  statValueEmphasis: { color: colors.primary, fontSize: 20 },
});
