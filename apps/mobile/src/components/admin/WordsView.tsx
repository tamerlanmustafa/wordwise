/**
 * WordsView — the vocabulary registry: how many words we know, how they are
 * graded, and how much of each word we have actually written.
 *
 * The level split on this page moved source on 2026-09-05. It used to count
 * distinct lemmas in `word_classifications` — one row per (film, word), so
 * millions of rows — and that single query was 5 of the 5.5 seconds it took to
 * open admin at all. It now counts the registry itself, which is one row per
 * word and is the table every backfill corrects. The numbers moved with it:
 * the registry holds words no film in the catalogue happens to use, and its
 * levels are the current ones rather than whatever was true when a script was
 * processed.
 */

import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import type { AdminWords } from '../../services/api';
import { cefrColors } from '../../theme/palette';
import { CEFR_LEVELS } from '../../types/constants';
import { type AdminColors, useAdminColors } from './adminTheme';
import { Card, EmptyState, Row, Section, StatGrid, StatTile } from './AdminUI';
import { BarChart, type ChartSlice } from './LevelCharts';

export function WordsView({ data }: { data: AdminWords | null }) {
  const c = useAdminColors();
  const styles = useMemo(() => makeStyles(c), [c]);

  const slices = useMemo<ChartSlice[]>(
    () => [
      ...CEFR_LEVELS.map((lv) => ({
        label: lv,
        value: data?.words_by_level?.[lv] ?? 0,
        color: cefrColors[lv],
      })),
      // Not a CEFR band, so it gets the neutral ink rather than a colour that
      // would put it on the difficulty ramp.
      { label: 'UNKNOWN', value: data?.words_by_level?.UNKNOWN ?? 0, color: c.textTertiary },
    ],
    [data, c.textTertiary],
  );

  if (!data) return <EmptyState message="No word data yet." />;

  const definedPct = data.lemmas_total
    ? Math.round((data.definitions_written / data.lemmas_total) * 100)
    : 0;

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Section
        title="Dictionary"
        hint={
          'Every distinct word the app knows, counted once each — a word that appears in 500 ' +
          'films still counts once.'
        }
      >
        <StatGrid>
          <StatTile
            label="Words known"
            value={data.lemmas_total.toLocaleString()}
            color={c.primary}
          />
          <StatTile
            label="With a meaning"
            value={`${definedPct}%`}
            sublabel={`${data.definitions_written.toLocaleString()} written`}
            color={definedPct >= 90 ? c.success : c.warning}
          />
        </StatGrid>
      </Section>

      <Section
        title="Words by level"
        hint={
          'The band we graded each word into. UNKNOWN is the pile we could not grade; it should ' +
          'be shrinking. Bars rather than a donut because UNKNOWN dwarfs the rest, and a donut ' +
          'of one huge wedge says less than a ranked comparison.'
        }
      >
        <Card>
          <BarChart slices={slices} />
        </Card>
      </Section>

      <Section
        title="What we have written"
        hint="A word with no meaning still shows on a card — the line under it is simply blank."
      >
        <Card>
          <Row
            label="Missing a meaning"
            value={data.definitions_missing.toLocaleString()}
            tone={data.definitions_missing > 0 ? c.warning : undefined}
          />
          <Row label="Declined by the model" value={data.definitions_skipped.toLocaleString()} />
          <Row label="No example sentence" value={data.sentences_skipped.toLocaleString()} />
          <Row label="Hidden from learners" value={data.hidden_words.toLocaleString()} />
          <Row label="Multi-word phrases" value={data.multi_word.toLocaleString()} />
          <Row label="Ranked by frequency" value={data.frequency_ranked.toLocaleString()} />
        </Card>
        <Text style={styles.note}>
          "Declined" means the model was asked and refused. Those are recorded so the same word is
          never paid for twice — changing the prompt lets it try them all again.
        </Text>
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
      marginTop: 4,
    },
  });
