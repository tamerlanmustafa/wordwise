/**
 * Public data-deletion instructions page.
 *
 * Google Play's Data safety form requires a publicly reachable URL that
 * explains how users can request deletion of their account and data — this
 * page is that URL. It intentionally requires no login (reviewers open it
 * anonymously) and mirrors PrivacyPage's plain MUI layout.
 */
import { Container, Typography, Box } from '@mui/material';
import { Link } from 'react-router-dom';

export default function DeleteAccountPage() {
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        Delete Your Account
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        WordWise (GetWordWise) — account &amp; data deletion
      </Typography>

      <Section title="Delete in the app (fastest)">
        Open WordWise, tap your profile picture, then choose “Delete account” and confirm.
        On the web, go to Settings → Danger zone → Delete account. Deletion is immediate and
        permanent: your account and all associated data — saved words, learning progress,
        streaks, quiz history, and preferences — are erased from our servers.
      </Section>

      <Section title="Delete by email">
        If you can no longer sign in, email{' '}
        <a href="mailto:privacy@getwordwise.us">privacy@getwordwise.us</a> from the address
        associated with your account and we will delete the account within 30 days.
      </Section>

      <Section title="What is deleted">
        Everything tied to your account: profile (email, username, sign-in identifiers),
        saved vocabulary and word lists, review/quiz history and progress, streaks and
        achievements, and translation history. Anonymous, non-identifying records required
        for legal or accounting purposes (e.g. purchase ledgers) may be retained where the
        law requires.
      </Section>

      <Box sx={{ mt: 4 }}>
        <Typography variant="body2" color="text.secondary">
          See also our <Link to="/privacy">Privacy Policy</Link> and{' '}
          <Link to="/terms">Terms of Service</Link>.
        </Typography>
      </Box>
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
