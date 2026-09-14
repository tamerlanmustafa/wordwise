import { Container, Typography, Box } from '@mui/material';

export default function PrivacyPage() {
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        Privacy Policy
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Last updated: September 13, 2026
      </Typography>

      <Section title="1. Information We Collect">
        When you create an account, we collect your email address, username, and optionally your
        profile picture via Google Sign-In. We also collect your native language, learning language,
        and proficiency level to personalize your experience. As you use the app, we collect data
        about which words you save, review outcomes, and interaction events to power the
        spaced-repetition system and personalize vocabulary recommendations.
        {' '}When you first set up the app, we may also ask a few optional questions about your
        learning goals and what you find difficult. Every question can be skipped, and the answers
        are recorded as fixed multiple-choice options — never free text.
      </Section>

      <Section title="2. How We Use Your Information">
        Your data is used to: provide and improve the WordWise service, personalize vocabulary
        recommendations, power spaced-repetition scheduling, and communicate with you about
        your account.
      </Section>

      <Section title="3. Data Sharing">
        We do not sell your personal data. We share data with: Google and Apple (for
        authentication, if you sign in with them), and our translation providers (only the text
        being translated — never your identity). Leaderboard data (username and aggregate stats
        only) is visible to other users.
      </Section>

      <Section title="4. Data Retention">
        Your account data is retained as long as your account is active. You can permanently
        delete your account and everything saved to it from the app (Profile → Account → Delete
        account); you may also contact us at privacy@getwordwise.us.
      </Section>

      <Section title="5. Advertising">
        WordWise does not show advertisements and contains no advertising or analytics SDKs.
        We do not share device identifiers with advertising networks.
      </Section>

      <Section title="6. Children's Privacy">
        WordWise is not directed at children under 13. If we learn that we have collected personal
        information from a child under 13, we will delete that information promptly.
      </Section>

      <Section title="7. Your Rights">
        You have the right to access, correct, or delete your personal data. Deletion is available
        in the app at any time (Profile → Account → Delete account). To exercise the other rights,
        contact us at privacy@getwordwise.us.
      </Section>

      <Section title="8. Contact">
        For privacy-related questions, contact privacy@getwordwise.us. This Privacy Policy is
        published in English. Any translation is provided for convenience only; the English
        version is authoritative.
      </Section>
    </Container>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="h6" fontWeight={600} gutterBottom>
        {title}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ lineHeight: 1.8 }}>
        {children}
      </Typography>
    </Box>
  );
}
