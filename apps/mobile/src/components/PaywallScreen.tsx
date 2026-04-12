import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const COLORS = {
  primary: '#7C5CBF',
  background: '#FAFAF8',
  paper: '#FFFFFF',
  text: '#2D3142',
  textSecondary: '#5C6378',
  textTertiary: '#9AA0AE',
  border: '#E8E8EC',
  accent: '#F4A261',
};

export interface PaywallScreenProps {
  onBack: () => void;
  previewsUsed: number;
  previewsLimit: number;
}

const FEATURES = [
  { icon: '🧠', title: 'Unlimited SRS Reviews', desc: 'Review all your saved words with spaced repetition — no session limits.' },
  { icon: '🚫', title: 'No Ads', desc: 'Clean, distraction-free learning experience.' },
  { icon: '📊', title: 'Detailed Stats', desc: 'Track your retention rate and box progression over time.' },
  { icon: '🎯', title: 'Priority Support', desc: 'Get help directly from the WordWise team.' },
];

export function PaywallScreen({ onBack, previewsUsed, previewsLimit }: PaywallScreenProps) {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={8}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>WordWise Plus</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.content}>
        <Text style={styles.heroTitle}>Unlock your full{'\n'}vocabulary potential</Text>
        <Text style={styles.heroSub}>
          You've used {previewsUsed} of {previewsLimit} free review sessions.
          Upgrade to keep learning with spaced repetition.
        </Text>

        <View style={styles.featureList}>
          {FEATURES.map((f) => (
            <View key={f.title} style={styles.featureRow}>
              <Text style={styles.featureIcon}>{f.icon}</Text>
              <View style={styles.featureText}>
                <Text style={styles.featureTitle}>{f.title}</Text>
                <Text style={styles.featureDesc}>{f.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.cta}>
          <TouchableOpacity style={styles.trialBtn} onPress={() => {
            // TODO: StoreKit / Google Play billing integration
          }}>
            <Text style={styles.trialBtnText}>Start 7-Day Free Trial</Text>
          </TouchableOpacity>
          <Text style={styles.priceHint}>Then $4.99/month · Cancel anytime</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.paper,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backText: { fontSize: 16, color: COLORS.primary, fontWeight: '500', width: 60 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
    justifyContent: 'space-between',
    paddingBottom: 24,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
    lineHeight: 36,
  },
  heroSub: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 12,
  },
  featureList: { marginTop: 32, gap: 20 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  featureIcon: { fontSize: 24, marginTop: 2 },
  featureText: { flex: 1 },
  featureTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 2 },
  featureDesc: { fontSize: 13, color: COLORS.textSecondary, lineHeight: 18 },
  cta: { alignItems: 'center', marginTop: 32 },
  trialBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: 18,
    paddingHorizontal: 48,
    borderRadius: 14,
    width: '100%',
    alignItems: 'center',
    shadowColor: COLORS.primary,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  trialBtnText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  priceHint: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 10,
  },
});
