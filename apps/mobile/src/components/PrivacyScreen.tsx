import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BACK_ARROW } from '../i18n/rtl';

const COLORS = {
  primary: '#7C5CBF',
  background: '#FAFAF8',
  paper: '#FFFFFF',
  text: '#2D3142',
  textSecondary: '#5C6378',
  border: '#E8E8EC',
};

export interface PrivacyScreenProps {
  onBack: () => void;
  /** Names where Back lands (e.g. "Profile"). Defaults to a plain "Back". */
  backLabel?: string;
  mode: 'privacy' | 'terms';
}

export function PrivacyScreen({ onBack, backLabel, mode }: PrivacyScreenProps) {
  const isPrivacy = mode === 'privacy';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={8}>
          <Text style={styles.backText}>{BACK_ARROW} {backLabel ?? 'Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isPrivacy ? 'Privacy Policy' : 'Terms of Service'}</Text>
        <View style={{ width: 60 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {isPrivacy ? <PrivacyContent /> : <TermsContent />}
      </ScrollView>
    </SafeAreaView>
  );
}

function PrivacyContent() {
  return (
    <>
      <Text style={styles.lastUpdated}>Last updated: August 23, 2026</Text>

      <Text style={styles.sectionTitle}>1. Information We Collect</Text>
      <Text style={styles.body}>
        When you create an account, we collect your email address, username, and optionally your profile picture via Google Sign-In. We also collect your native language, learning language, and proficiency level to personalize your experience.
      </Text>
      <Text style={styles.body}>
        As you use the app, we collect data about which words you save, review outcomes (correct/incorrect), and interaction events (e.g., tapping a word, viewing a translation). This data is used to power the spaced-repetition system and personalize your vocabulary recommendations.
      </Text>

      <Text style={styles.sectionTitle}>2. How We Use Your Information</Text>
      <Text style={styles.body}>
        Your data is used to: provide and improve the WordWise service, personalize vocabulary recommendations, power spaced-repetition scheduling, display relevant advertisements (free tier), and communicate with you about your account.
      </Text>

      <Text style={styles.sectionTitle}>3. Data Sharing</Text>
      <Text style={styles.body}>
        We do not sell your personal data. We share data with: Google (for authentication), DeepL (for translations — only the text being translated), and AdMob (for serving ads to free-tier users — device identifiers only, no personal data). Leaderboard data (username and aggregate stats only) is visible to other users.
      </Text>

      <Text style={styles.sectionTitle}>4. Data Retention</Text>
      <Text style={styles.body}>
        Your account data is retained as long as your account is active. You can request deletion of your account and all associated data by contacting support. Cached vocabulary data stored locally on your device can be cleared from the app settings.
      </Text>

      <Text style={styles.sectionTitle}>5. Advertising</Text>
      <Text style={styles.body}>
        Free-tier users see banner advertisements served by Google AdMob. We use non-personalized ads for users under 16 or in regions where personalized advertising is restricted. Premium subscribers see no advertisements.
      </Text>

      <Text style={styles.sectionTitle}>6. Children's Privacy</Text>
      <Text style={styles.body}>
        WordWise is not directed at children under 13. If we learn that we have collected personal information from a child under 13, we will delete that information promptly.
      </Text>

      <Text style={styles.sectionTitle}>7. Your Rights</Text>
      <Text style={styles.body}>
        You have the right to access, correct, or delete your personal data. You may also opt out of personalized advertising. To exercise these rights, contact us at privacy@getwordwise.us.
      </Text>

      <Text style={styles.sectionTitle}>8. Contact</Text>
      <Text style={styles.body}>
        For privacy-related questions, contact privacy@getwordwise.us.
      </Text>
      <Text style={styles.body}>
        This Privacy Policy is published in English. Any translation is provided for convenience only; the English version is authoritative.
      </Text>
    </>
  );
}

function TermsContent() {
  return (
    <>
      <Text style={styles.lastUpdated}>Last updated: August 23, 2026</Text>

      <Text style={styles.sectionTitle}>1. Acceptance of Terms</Text>
      <Text style={styles.body}>
        By using WordWise, you agree to these Terms of Service. If you do not agree, do not use the app.
      </Text>

      <Text style={styles.sectionTitle}>2. The Service</Text>
      <Text style={styles.body}>
        WordWise is a vocabulary-learning application that analyzes English-language movie scripts and presents vocabulary organized by CEFR level. The service includes free and premium tiers.
      </Text>

      <Text style={styles.sectionTitle}>3. Accounts</Text>
      <Text style={styles.body}>
        You must create an account to use WordWise. You are responsible for maintaining the security of your account credentials. You must provide accurate information when creating your account.
      </Text>

      <Text style={styles.sectionTitle}>4. Subscriptions</Text>
      <Text style={styles.body}>
        WordWise Plus is a paid subscription service. Subscriptions auto-renew unless canceled at least 24 hours before the end of the current period. You can manage and cancel subscriptions through your Apple App Store or Google Play Store account settings. Refunds are handled by Apple or Google per their respective policies.
      </Text>

      <Text style={styles.sectionTitle}>5. Free Trial</Text>
      <Text style={styles.body}>
        New subscribers may be eligible for a 7-day free trial. If you do not cancel before the trial ends, you will be charged for the first subscription period. Free trial eligibility is determined by Apple/Google and is limited to one trial per user.
      </Text>

      <Text style={styles.sectionTitle}>6. Content</Text>
      <Text style={styles.body}>
        Movie scripts and subtitles used by WordWise are sourced from publicly available databases. WordWise does not host or stream movie content. Definitions and translations are provided for educational purposes.
      </Text>

      <Text style={styles.sectionTitle}>7. Acceptable Use</Text>
      <Text style={styles.body}>
        You agree not to: reverse-engineer the app, use automated tools to scrape data, share your premium account credentials, or use the service for any unlawful purpose.
      </Text>

      <Text style={styles.sectionTitle}>8. Limitation of Liability</Text>
      <Text style={styles.body}>
        WordWise is provided "as is" without warranties. We are not liable for any damages arising from your use of the service, including but not limited to inaccurate translations or vocabulary classifications.
      </Text>

      <Text style={styles.sectionTitle}>9. Changes to Terms</Text>
      <Text style={styles.body}>
        We may update these terms from time to time. Continued use of the app after changes constitutes acceptance of the new terms.
      </Text>

      <Text style={styles.sectionTitle}>10. Contact</Text>
      <Text style={styles.body}>
        For questions about these terms, contact support@getwordwise.us.
      </Text>
      <Text style={styles.body}>
        These Terms are published in English. Any translation is provided for convenience only; the English version is authoritative.
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: COLORS.paper,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backText: { fontSize: 16, color: COLORS.primary, fontWeight: '500', width: 60 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  content: { padding: 20, paddingBottom: 40 },
  lastUpdated: { fontSize: 12, color: COLORS.textSecondary, fontStyle: 'italic', marginBottom: 20 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginTop: 20, marginBottom: 8 },
  body: { fontSize: 14, color: COLORS.textSecondary, lineHeight: 22, marginBottom: 8 },
});
