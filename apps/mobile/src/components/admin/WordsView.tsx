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
 *
 * ## The level tabs
 *
 * The chart says how big each band is; the tabs say what is *in* one. That
 * second question is the one that catches grading bugs, and until there was a
 * way to read a band the only way to ask it was a psql session — which is how
 * 3,850 ungraded words sat in A2 for months (2026-09-06) with a bar chart
 * cheerfully reporting the band as the app's largest.
 *
 * So the row shows `source` and `confidence`, not just the word. A row written
 * by the old `fallback`/0.0 default is flagged `ungraded` here, because "this
 * word is A2" and "nothing ever decided this word is A2" look identical until
 * you print the provenance.
 *
 * ## One scroller, not two
 *
 * The whole page is a FlatList whose header is the overview. A FlatList nested
 * inside a ScrollView renders every row eagerly — it loses virtualization,
 * which on a 9,000-word band is the entire point of paging the endpoint.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAdminWordList } from '../../hooks/useAdminWordList';
import type {
  AdminWord,
  AdminWordExclusion,
  AdminWordFilter,
  AdminWords,
  AdminWordSort,
} from '../../services/api';
import { cefrColors } from '../../theme/palette';
import { CEFR_LEVELS } from '../../types/constants';
import { withTap } from '../../utils/feedback';
import { type AdminColors, useAdminColors } from './adminTheme';
import { Card, EmptyState, Row, Section, StatGrid, StatTile } from './AdminUI';
import { BarChart, type ChartSlice } from './LevelCharts';

/** The bands a tab can open. Mirrors `REGISTRY_LEVELS` in
 *  `backend/src/services/admin_panels.py` — UNKNOWN is browsable precisely
 *  because it is the pile that needs draining (#91). */
export const WORD_BROWSE_LEVELS: readonly string[] = [...CEFR_LEVELS, 'UNKNOWN'];

/** Must match `WORD_SORTS` in `backend/src/services/admin_panels.py`. */
export const WORD_SORT_TABS: ReadonlyArray<{ id: AdminWordSort; label: string }> = [
  { id: 'frequency', label: 'Commonest' },
  { id: 'rarest', label: 'Rarest' },
  { id: 'alpha', label: 'A–Z' },
  { id: 'movies', label: 'Most films' },
  { id: 'recent', label: 'Recently changed' },
];

/**
 * Which slice of the band to list. Must match `WORD_VISIBILITIES` in
 * `backend/src/services/admin_panels.py`.
 *
 * `learner` leads and is the default, because "what does this level actually
 * deal" is the question, and the registry answers a different one: prod on
 * 2026-09-07 holds 42,998 lemmas against 27,209 a learner can reach.
 */
export const WORD_FILTER_TABS: ReadonlyArray<{
  id: AdminWordFilter;
  label: string;
  blurb: string;
  /** Chips are grouped so eleven of them stay scannable: the three broad
   *  slices, then the single causes, then the two safety checks. */
  group: 'slice' | 'cause' | 'safety';
}> = [
  {
    id: 'learner',
    label: 'Learners see',
    blurb: 'Exactly what the feed can deal at this level — the app’s own eligibility test.',
    group: 'slice',
  },
  {
    id: 'removed',
    label: 'Removed',
    blurb: 'Every word a learner can never meet, and which filter removed each one.',
    group: 'slice',
  },
  {
    id: 'all',
    label: 'All',
    blurb: 'The whole registry at this level, removed rows marked.',
    group: 'slice',
  },
  {
    id: 'hidden',
    label: 'Hidden',
    blurb: 'Curated away in hidden_words — someone decided we should not teach these.',
    group: 'cause',
  },
  {
    id: 'short',
    label: 'Too short',
    blurb: 'Under four letters, or not purely alphabetic. Mostly tokenizer debris.',
    group: 'cause',
  },
  {
    id: 'ungraded',
    label: 'Never graded',
    blurb: 'Placeholder level from an old default — nothing ever judged these. Should be 0.',
    group: 'cause',
  },
  {
    id: 'unknown',
    label: 'Ungraded pile',
    blurb: 'The UNKNOWN holding pen: classified as unplaceable, never taught.',
    group: 'cause',
  },
  {
    id: 'no_sentence',
    label: 'No sentence',
    blurb: 'Waiting on the sentence worker. A worklist, not a verdict.',
    group: 'cause',
  },
  {
    id: 'no_definition',
    label: 'No meaning',
    blurb: 'No definition written. These still show on a card, with a blank line under them.',
    group: 'cause',
  },
  {
    id: 'slur',
    label: 'Slurs',
    blurb: 'Slurs the profanity filter blocks. Any of these reaching a learner is a bug.',
    group: 'safety',
  },
  {
    id: 'profane',
    label: 'Profanity',
    blurb: 'Strong profanity and slurs. Mild swears (damn, hell) are taught and excluded here.',
    group: 'safety',
  },
];

/** @deprecated Old name; `WORD_FILTER_TABS` is the same list, longer. */
export const WORD_VISIBILITY_TABS = WORD_FILTER_TABS;

/** Filters that ask "is anything we refuse to teach still reachable" rather
 *  than "what did we remove". A non-zero count under `learner` eligibility is
 *  a bug, not a statistic — which is why they are their own group. */
export const SAFETY_FILTERS: ReadonlyArray<AdminWordFilter> = WORD_FILTER_TABS.filter(
  (t) => t.group === 'safety',
).map((t) => t.id);

/** Plain-language label for `excluded_reason`. Wording matches what the filter
 *  actually does, not the column it reads. */
export const EXCLUSION_LABELS: Record<AdminWordExclusion, string> = {
  unknown_level: 'ungraded pile',
  ungraded: 'never graded',
  shape: 'too short / not a word',
  curated_away: 'hidden',
  no_sentence: 'no sentence yet',
};

/**
 * Is this row's level a real judgement, or a placeholder?
 *
 * The same test `trusted_registry_sql` applies in SQL: `fallback` with no
 * confidence is the classifier's "I gave up" written through an old default.
 * The deliberate whitelists share `source='fallback'` but carry real
 * confidence (kids 0.95, slang 0.85), so the split is on confidence — get
 * this wrong in the lenient direction and the flag stops meaning anything.
 */
export function isUngraded(word: Pick<AdminWord, 'source' | 'confidence'>): boolean {
  return word.source === 'fallback' && word.confidence < 0.5;
}

/**
 * The line that reconciles the chip count with the list under it.
 *
 * The chip counts the whole registry band; most filters list a subset of it,
 * and leaving that gap unexplained is the kind of quiet mismatch that makes an
 * admin page untrustworthy — it is a smaller version of the bug that put 3,850
 * ungraded words behind a confident A2 label.
 *
 * Pure, so the wording is testable without rendering anything.
 */
export function countLine(
  filter: AdminWordFilter,
  total: number,
  registryCount: number,
): string {
  const n = total.toLocaleString();
  const of = registryCount.toLocaleString();
  if (filter === 'learner') {
    const removed = registryCount - total;
    return removed > 0
      ? `${n} of ${of} reach a learner · ${removed.toLocaleString()} removed`
      : `${n} of ${of} reach a learner`;
  }
  if (filter === 'removed') return `${n} of ${of} never reach a learner`;
  if (filter === 'all') return `${n} in the registry`;
  return `${n} of ${of} in this band`;
}

export function levelColor(level: string, fallback: string): string {
  // UNKNOWN is not a CEFR band, so it gets neutral ink rather than a colour
  // that would put it on the difficulty ramp.
  return cefrColors[level] ?? fallback;
}

export function WordsView({ data }: { data: AdminWords | null }) {
  const c = useAdminColors();
  const styles = useMemo(() => makeStyles(c), [c]);

  const [level, setLevel] = useState<string | null>(null);
  const [sort, setSort] = useState<AdminWordSort>('frequency');
  const [filter, setFilter] = useState<AdminWordFilter>('learner');
  const { words, total, loading, loadingMore, hasMore, error, loadMore } = useAdminWordList(
    level,
    sort,
    filter,
  );

  // Tapping the open tab closes it and returns to the overview, so the tabs
  // are both the way in and the way back — there is no other affordance on a
  // page that is otherwise a single scroll.
  const toggleLevel = useCallback(
    (lv: string) => setLevel((prev) => (prev === lv ? null : lv)),
    [],
  );

  const slices = useMemo<ChartSlice[]>(
    () => [
      ...CEFR_LEVELS.map((lv) => ({
        label: lv,
        value: data?.words_by_level?.[lv] ?? 0,
        color: cefrColors[lv],
      })),
      { label: 'UNKNOWN', value: data?.words_by_level?.UNKNOWN ?? 0, color: c.textTertiary },
    ],
    [data, c.textTertiary],
  );

  const renderItem = useCallback(
    ({ item }: { item: AdminWord }) => {
      const ungraded = isUngraded(item);
      return (
        <View
          style={[styles.wordRow, { borderStartColor: levelColor(item.cefr_level, c.textTertiary) }]}
        >
          <View style={styles.wordTopRow}>
            <Text style={styles.wordLemma} numberOfLines={1}>
              {item.lemma}
            </Text>
            {item.pos ? <Text style={styles.wordPos}>{item.pos.toLowerCase()}</Text> : null}
          </View>
          <View style={styles.wordMetaRow}>
            <Text style={styles.wordMeta}>
              {item.frequency_rank != null ? `#${item.frequency_rank.toLocaleString()}` : 'unranked'}
              {' · '}
              {item.movie_count.toLocaleString()} {item.movie_count === 1 ? 'film' : 'films'}
            </Text>
            <Text style={styles.wordSource} numberOfLines={1}>
              {item.source} {item.confidence.toFixed(2)}
            </Text>
          </View>
          {item.excluded_reason || ungraded || item.hidden || !item.has_definition ? (
            <View style={styles.flagRow}>
              {/* Why a learner never meets this word — the reason the
                  "Removed" view exists. First, because it explains the row. */}
              {item.excluded_reason ? (
                <View style={[styles.flag, { backgroundColor: c.error }]}>
                  <Text style={styles.flagText}>
                    {EXCLUSION_LABELS[item.excluded_reason] ?? item.excluded_reason}
                  </Text>
                </View>
              ) : null}
              {/* Suppressed when it would only restate the line above. */}
              {ungraded && item.excluded_reason !== 'ungraded' ? (
                <View style={[styles.flag, { backgroundColor: c.error }]}>
                  <Text style={styles.flagText}>ungraded</Text>
                </View>
              ) : null}
              {item.hidden && item.excluded_reason !== 'curated_away' ? (
                <View style={[styles.flag, { backgroundColor: c.textTertiary }]}>
                  <Text style={styles.flagText}>hidden</Text>
                </View>
              ) : null}
              {!item.has_definition ? (
                <View style={[styles.flag, { backgroundColor: c.warning }]}>
                  <Text style={styles.flagText}>no meaning</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      );
    },
    [styles, c.error, c.warning, c.textTertiary],
  );

  if (!data) return <EmptyState message="No word data yet." />;

  const definedPct = data.lemmas_total
    ? Math.round((data.definitions_written / data.lemmas_total) * 100)
    : 0;

  // What the open band's chip says — the whole registry at that level. The
  // list is a slice of it, and `countLine` below states which.
  const registryCount = level ? (data.words_by_level?.[level] ?? 0) : 0;

  const header = (
    <View>
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
        title="Browse a level"
        hint={
          'Tap a band to read the words in it, tap again to close. The chart says how big a band ' +
          'is; this says what is actually in it — which is the question that catches a grading ' +
          'bug.'
        }
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {WORD_BROWSE_LEVELS.map((lv) => {
            const on = level === lv;
            const tint = levelColor(lv, c.textTertiary);
            return (
              <TouchableOpacity
                key={lv}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${lv}, ${(data.words_by_level?.[lv] ?? 0).toLocaleString()} words`}
                style={[
                  styles.levelChip,
                  { borderColor: tint },
                  on && { backgroundColor: tint },
                ]}
                onPress={withTap(() => toggleLevel(lv))}
              >
                <Text style={[styles.levelChipText, on && styles.levelChipTextOn]}>{lv}</Text>
                <Text style={[styles.levelChipCount, on && styles.levelChipTextOn]}>
                  {(data.words_by_level?.[lv] ?? 0).toLocaleString()}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {level ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {WORD_FILTER_TABS.map((tab, i) => {
              const on = filter === tab.id;
              const startsGroup = i > 0 && WORD_FILTER_TABS[i - 1].group !== tab.group;
              return (
                <View key={tab.id} style={styles.chipWrap}>
                  {/* A hairline where the grouping changes: three broad
                      slices, then single causes, then the safety checks. */}
                  {startsGroup ? <View style={styles.chipDivider} /> : null}
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityHint={tab.blurb}
                    style={[
                      styles.sortChip,
                      tab.group === 'safety' && styles.safetyChip,
                      on && styles.sortChipOn,
                    ]}
                    onPress={withTap(() => setFilter(tab.id))}
                  >
                    <Text style={[styles.sortChipText, on && styles.sortChipTextOn]}>
                      {tab.label}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>
        ) : null}

        {level ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {WORD_SORT_TABS.map((tab) => (
              <TouchableOpacity
                key={tab.id}
                accessibilityRole="button"
                accessibilityState={{ selected: sort === tab.id }}
                style={[styles.sortChip, sort === tab.id && styles.sortChipOn]}
                onPress={withTap(() => setSort(tab.id))}
              >
                <Text style={[styles.sortChipText, sort === tab.id && styles.sortChipTextOn]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}

        {/* Reconciles the chip count with the list. The chip counts the whole
            registry band; in the default view the list is a subset of it, and
            leaving that gap unexplained is the kind of quiet mismatch that
            makes an admin page untrustworthy. */}
        {level && total != null ? (
          <Text style={styles.countLine}>
            {countLine(filter, total, registryCount)}
          </Text>
        ) : null}

        {/* A safety filter reading zero is the result you want, and an empty
            list alone does not say so — it looks like every other empty list.
            Say it, so "nothing is wrong" is legible as an answer. */}
        {level && total === 0 && SAFETY_FILTERS.includes(filter) ? (
          <Text style={[styles.countLine, { color: c.success }]}>
            None in {level} — nothing offensive is reachable here.
          </Text>
        ) : null}

        {level ? (
          <Text style={styles.note}>
            {WORD_FILTER_TABS.find((t) => t.id === filter)?.blurb}
          </Text>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {level && loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color={c.primary} />
          </View>
        ) : null}
      </Section>

      {/* The overview's tail only when no band is open — with a list below,
          it would sit between the tabs and the words they opened. */}
      {level ? null : (
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
      )}
    </View>
  );

  return (
    <FlatList
      data={words}
      keyExtractor={(w) => String(w.id)}
      renderItem={renderItem}
      contentContainerStyle={styles.scroll}
      ListHeaderComponent={header}
      onEndReached={loadMore}
      onEndReachedThreshold={0.6}
      // The header is tall and the rows are cheap, so keep a generous window:
      // a band opened from the top of the page starts every row off-screen.
      initialNumToRender={20}
      ListFooterComponent={
        !level || loading ? null : loadingMore ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color={c.primary} />
          </View>
        ) : words.length === 0 ? (
          <Text style={styles.note}>
            {filter === 'learner'
              ? `No words in ${level} reach a learner.`
              : filter === 'removed'
                ? `Nothing is removed from ${level} — every word reaches a learner.`
                : `No words in ${level} match this filter.`}
          </Text>
        ) : !hasMore ? (
          <Text style={styles.note}>
            End of {level} — {words.length.toLocaleString()} loaded
          </Text>
        ) : null
      }
    />
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
    error: {
      fontSize: 12.5,
      lineHeight: 18,
      color: c.error,
      marginTop: 8,
    },
    countLine: {
      fontSize: 13,
      fontWeight: '600',
      color: c.text,
      marginTop: 8,
    },
    chipRow: {
      gap: 8,
      paddingVertical: 4,
      // Logical, not `paddingRight`: this is the room after the last chip, and
      // in Arabic the row starts on the right (#104b).
      paddingEnd: 8,
    },
    levelChip: {
      minWidth: 58,
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      borderWidth: 1.5,
      backgroundColor: c.paper,
    },
    levelChipText: {
      fontSize: 13,
      fontWeight: '700',
      color: c.text,
    },
    levelChipCount: {
      fontSize: 10.5,
      marginTop: 1,
      color: c.textTertiary,
    },
    levelChipTextOn: {
      color: c.accentInk,
    },
    chipWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    chipDivider: {
      width: StyleSheet.hairlineWidth,
      height: 20,
      backgroundColor: c.border,
    },
    sortChip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: c.inset,
    },
    safetyChip: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.error,
    },
    sortChipOn: {
      backgroundColor: c.accentFill,
    },
    sortChipText: {
      fontSize: 12.5,
      fontWeight: '600',
      color: c.textSecondary,
    },
    sortChipTextOn: {
      color: c.accentInk,
    },
    loadingBox: {
      paddingVertical: 20,
      alignItems: 'center',
    },
    wordRow: {
      backgroundColor: c.paper,
      borderRadius: 10,
      borderStartWidth: 3,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 8,
    },
    wordTopRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 8,
    },
    wordLemma: {
      flexShrink: 1,
      fontSize: 15,
      fontWeight: '700',
      color: c.text,
    },
    wordPos: {
      fontSize: 11.5,
      color: c.textTertiary,
    },
    wordMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      marginTop: 3,
    },
    wordMeta: {
      fontSize: 12,
      color: c.textSecondary,
    },
    wordSource: {
      flexShrink: 1,
      fontSize: 11,
      color: c.textTertiary,
    },
    flagRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 6,
    },
    flag: {
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 5,
    },
    flagText: {
      fontSize: 10,
      fontWeight: '700',
      color: c.onStatusFill,
    },
  });
