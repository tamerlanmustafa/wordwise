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
import type { QuizCompleteResponse } from '../services/api';

export interface QuizResultScreenProps {
  result: QuizCompleteResponse;
  level: string;
  onDone: () => void;
  onPlayAgain?: () => void;
}

// End-of-session reward screen. Stars animate in, XP counts up.
export function QuizResultScreen({ result, level, onDone, onPlayAgain }: QuizResultScreenProps) {
  const color = cefrColors[level] || colors.primary;
  const label = cefrLabels[level] || level;
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

  const headline =
    result.stars === 3 ? 'Amazing!' :
    result.stars === 2 ? 'Nice work!' :
    result.stars === 1 ? 'Good try!' :
    'Keep going!';

  const accuracy = result.total_scored > 0
    ? Math.round((result.correct_count / result.total_scored) * 100)
    : null;

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
                {
                  opacity: v,
                  transform: [{ scale: v }],
                },
              ]}
            >
              {i < result.stars ? '⭐' : '☆'}
            </Animated.Text>
          ))}
        </View>

        <View style={styles.statsCard}>
          {accuracy !== null && (
            <StatRow label="Accuracy" value={`${accuracy}%`} />
          )}
          <StatRow label="Correct" value={`${result.correct_count} / ${result.total_scored}`} />
          <StatRow label="XP earned" value={`+${result.xp_earned}`} emphasis />
        </View>

        <View style={styles.footer}>
          {onPlayAgain && (
            <TouchableOpacity
              onPress={onPlayAgain}
              style={[styles.ghostBtn, { borderColor: color }]}
              activeOpacity={0.7}
            >
              <Text style={[styles.ghostBtnText, { color }]}>Play again</Text>
            </TouchableOpacity>
          )}
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
      <Text style={[styles.statValue, emphasis && styles.statValueEmphasis]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, padding: 24, alignItems: 'center', paddingTop: 40 },
  levelBadge: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center',
  },
  levelBadgeText: { fontSize: 24, fontWeight: '800', color: '#FFFFFF' },
  levelLabel: { fontSize: 14, color: colors.textSecondary, marginTop: 8 },
  headline: {
    fontSize: 32, fontWeight: '800', color: colors.text,
    marginTop: 24, textAlign: 'center',
  },
  starsRow: {
    flexDirection: 'row', marginTop: 16, gap: 8,
  },
  star: { fontSize: 64 },
  statsCard: {
    width: '100%', marginTop: 32, padding: 20,
    backgroundColor: colors.paper, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border,
    gap: 12,
  },
  statRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  statLabel: { fontSize: 14, color: colors.textSecondary },
  statValue: { fontSize: 18, fontWeight: '700', color: colors.text },
  statValueEmphasis: { color: colors.primary, fontSize: 20 },
  footer: {
    marginTop: 'auto', width: '100%', gap: 12, paddingBottom: 16,
  },
  primaryBtn: {
    paddingVertical: 16, borderRadius: 14, alignItems: 'center',
  },
  primaryBtnText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  ghostBtn: {
    paddingVertical: 14, borderRadius: 14, alignItems: 'center',
    borderWidth: 2, backgroundColor: colors.paper,
  },
  ghostBtnText: { fontSize: 16, fontWeight: '700' },
});
