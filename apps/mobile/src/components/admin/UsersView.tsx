/**
 * UsersView — who has an account, what they are on, and whether they came back.
 *
 * Counts are rolling windows rather than all-time totals wherever an all-time
 * total would be uninformative: on a product before launch, "signups ever" is
 * the same number every day and says nothing about whether anything changed
 * this week. The grant/revoke tool lives at the bottom of this page rather than
 * on the hub, because it is a thing you do *to* a user and this is the page
 * about users.
 */

import { useMemo, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import type { AdminUsers } from '../../services/api';
import { type AdminColors, useAdminColors } from './adminTheme';
import { Card, EmptyState, Row, Section, StatGrid, StatTile } from './AdminUI';

export function UsersView({
  data,
  children,
}: {
  data: AdminUsers | null;
  /** The grant/revoke Plus tool, owned by AdminScreen where its state lives. */
  children?: ReactNode;
}) {
  const c = useAdminColors();
  const styles = useMemo(() => makeStyles(c), [c]);

  if (!data) return <EmptyState message="No user data yet." />;

  const paying = data.premium + data.trial;

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <Section title="Accounts">
        <StatGrid>
          <StatTile
            label="Total"
            value={data.users_total.toLocaleString()}
            sublabel={`${data.onboarded.toLocaleString()} finished setup`}
            color={c.primary}
          />
          <StatTile
            label="Paying"
            value={paying.toLocaleString()}
            sublabel={`${data.premium} premium · ${data.trial} on trial`}
            color={c.success}
          />
        </StatGrid>
      </Section>

      <Section
        title="Joining"
        hint="Rolling windows, not all-time totals — the question is whether this week moved."
      >
        <Card>
          <Row label="Signed up in the last 7 days" value={data.signups_7d.toLocaleString()} />
          <Row label="Signed up in the last 30 days" value={data.signups_30d.toLocaleString()} />
        </Card>
      </Section>

      <Section
        title="Coming back"
        hint="Counted from the last day someone actually studied, not from opening the app."
      >
        <Card>
          <Row label="Studied in the last 7 days" value={data.studied_7d.toLocaleString()} />
          <Row label="Studied in the last 30 days" value={data.studied_30d.toLocaleString()} />
          <Row
            label="Have saved a word"
            value={data.users_with_saved_words.toLocaleString()}
            tone={data.users_with_saved_words > 0 ? undefined : c.textTertiary}
          />
          <Row label="Words saved in total" value={data.saved_words.toLocaleString()} />
        </Card>
      </Section>

      <Section title="Tiers">
        <Card>
          <Row label="Free" value={data.free.toLocaleString()} />
          <Row label="Premium" value={data.premium.toLocaleString()} />
          <Row label="On trial" value={data.trial.toLocaleString()} />
          <Row label="Comped" value={data.comped.toLocaleString()} />
          <Row label="Admins" value={data.admins.toLocaleString()} />
          <Row
            label="Deactivated"
            value={(data.users_total - data.active_accounts).toLocaleString()}
          />
        </Card>
        <Text style={styles.note}>
          Admins bypass every paywall regardless of tier, so they are counted separately rather
          than folded into Free.
        </Text>
      </Section>

      {children}
    </ScrollView>
  );
}

const makeStyles = (c: AdminColors) =>
  StyleSheet.create({
    scroll: {
      paddingHorizontal: 16,
      paddingBottom: 32,
    },
    note: {
      fontSize: 12.5,
      lineHeight: 18,
      color: c.textTertiary,
      marginTop: 4,
    },
  });
