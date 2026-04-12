import { Container, Typography, Box } from '@mui/material';

export default function TermsPage() {
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        Terms of Service
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Last updated: April 2026
      </Typography>

      <Section title="1. Acceptance of Terms">
        By using WordWise, you agree to these Terms of Service. If you do not agree, do not use
        the app or website.
      </Section>

      <Section title="2. The Service">
        WordWise is a vocabulary-learning application that analyzes English-language movie scripts
        and presents vocabulary organized by CEFR level. The service includes free and premium tiers.
      </Section>

      <Section title="3. Accounts">
        You must create an account to use WordWise. You are responsible for maintaining the security
        of your account credentials. You must provide accurate information when creating your account.
      </Section>

      <Section title="4. Subscriptions">
        WordWise Plus is a paid subscription service. On mobile, subscriptions are managed through
        the Apple App Store or Google Play Store and auto-renew unless canceled at least 24 hours
        before the end of the current period. On web, subscriptions are managed through Stripe.
        Refunds are handled per the respective platform's policies.
      </Section>

      <Section title="5. Free Trial">
        New subscribers may be eligible for a 7-day free trial. If you do not cancel before the
        trial ends, you will be charged for the first subscription period. Free trial eligibility
        is limited to one trial per user.
      </Section>

      <Section title="6. Content">
        Movie scripts and subtitles used by WordWise are sourced from publicly available databases.
        WordWise does not host or stream movie content. Definitions and translations are provided
        for educational purposes.
      </Section>

      <Section title="7. Acceptable Use">
        You agree not to: reverse-engineer the app, use automated tools to scrape data, share your
        premium account credentials, or use the service for any unlawful purpose.
      </Section>

      <Section title="8. Limitation of Liability">
        WordWise is provided "as is" without warranties. We are not liable for any damages arising
        from your use of the service, including but not limited to inaccurate translations or
        vocabulary classifications.
      </Section>

      <Section title="9. Changes to Terms">
        We may update these terms from time to time. Continued use of the app after changes
        constitutes acceptance of the new terms.
      </Section>

      <Section title="10. Contact">
        For questions about these terms, contact support@wordwise.app.
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
