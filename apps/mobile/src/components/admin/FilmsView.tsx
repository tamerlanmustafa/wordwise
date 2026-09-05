/**
 * FilmsView — the catalogue: how big it is, how much of it is usable, and how
 * it splits across the six CEFR bands.
 *
 * Consolidates what used to be spread over the admin landing page (the
 * "Movies processed" tile and the "Films by level" donut) with the browser
 * that was reachable only by tapping one of them. Same data, one page, one
 * call — and the call only happens when this page is opened.
 */

import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import type { AdminFilms } from '../../services/api';
import { cefrColors } from '../../theme/palette';
import { CEFR_LEVELS } from '../../types/constants';
import { type AdminColors, useAdminColors } from './adminTheme';
import { Card, EmptyState, Section, StatGrid, StatTile } from './AdminUI';
import { DonutChart, type ChartSlice } from './LevelCharts';

export function FilmsView({
  data,
  onBrowse,
}: {
  data: AdminFilms | null;
  /** Opens the processed-film browser, optionally filtered to one band. */
  onBrowse: (level?: string) => void;
}) {
  const c = useAdminColors();
  const styles = useMemo(() => makeStyles(c), [c]);

  const slices = useMemo<ChartSlice[]>(
    () =>
      CEFR_LEVELS.map((lv) => ({
        label: lv,
        value: data?.movies_by_level?.[lv] ?? 0,
        color: cefrColors[lv],
      })),
    [data],
  );

  if (!data) return <EmptyState message="No film data yet." />;

  const graded = slices.reduce((n, s) => n + s.value, 0);

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Section
        title="Catalogue"
        hint={
          'A film is "ready" once we have its subtitles and have graded every word in them. ' +
          'Until then it exists on TMDB and not in the app.'
        }
      >
        <StatGrid>
          <StatTile
            label="Ready to read"
            value={`${data.movies_processed.toLocaleString()}`}
            sublabel={`of ${data.movies_total.toLocaleString()} in the catalogue`}
            color={c.primary}
            onPress={() => onBrowse()}
          />
          <StatTile
            label="Still waiting"
            value={`${data.movies_unprocessed.toLocaleString()}`}
            sublabel="no subtitles fetched yet"
            color={c.warning}
          />
        </StatGrid>
      </Section>

      <Section
        title="Films by level"
        hint={
          'How the graded catalogue splits across the six CEFR bands. Every film sits in exactly ' +
          'one, decided by how hard its vocabulary is. Tap a band to browse it.'
        }
      >
        <Card>
          <DonutChart slices={slices} total={graded} caption="films" />
        </Card>
        <StatGrid>
          {CEFR_LEVELS.filter((lv) => (data.movies_by_level[lv] ?? 0) > 0).map((lv) => (
            <StatTile
              key={lv}
              label={lv}
              value={`${(data.movies_by_level[lv] ?? 0).toLocaleString()}`}
              color={cefrColors[lv]}
              onPress={() => onBrowse(lv)}
            />
          ))}
        </StatGrid>
        {graded < data.movies_processed ? (
          <Text style={styles.note}>
            {(data.movies_processed - graded).toLocaleString()} ready films have no level yet —
            they have subtitles but no difficulty score, so no shelf can show them.
          </Text>
        ) : null}
      </Section>
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
      marginTop: 12,
    },
  });
