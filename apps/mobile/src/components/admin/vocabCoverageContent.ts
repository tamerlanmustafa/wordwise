/**
 * vocabCoverageContent — the plain-English layer over /admin/health/vocab-coverage.
 *
 * The API returns raw metrics with terse thresholds ("warn <90%, fail <20%").
 * This module owns what is specific to *this* report: (a) how its metrics are
 * grouped into tabs, (b) a human explanation of what each one means, and (c)
 * the snapshot-relative trend line. Formatting and meter geometry are shared
 * with the other health reports — see healthMetricContent. All pure — no React,
 * no fetching — so it's unit-testable and the view stays presentation-only.
 */

import type { VocabCoverageMetric } from '../../services/api';

export type CoverageCategoryId =
  | 'pipeline'
  | 'coverage'
  | 'quality'
  | 'caches'
  | 'cost'
  | 'other';

export interface CoverageCategory {
  id: CoverageCategoryId;
  /** Tab label — kept short so the tab row fits narrow phones. */
  label: string;
  /** One line answering "what question does this group answer?" */
  blurb: string;
  /** Metric keys in display order. */
  keys: string[];
}

export const COVERAGE_CATEGORIES: readonly CoverageCategory[] = [
  // First tab on purpose: every trend line in the others is measured against
  // the last snapshot, so if the writer has stopped they are all comparing
  // today against whenever it died (#154).
  {
    id: 'pipeline',
    label: 'Reporting',
    blurb: 'Is anyone still writing these numbers down?',
    keys: ['vocab_snapshot_age'],
  },
  {
    id: 'coverage',
    label: 'Coverage',
    blurb: 'Do our words have example sentences yet?',
    keys: ['usage_weighted_sentence_coverage', 'uncovered_visible_lemmas'],
  },
  {
    id: 'quality',
    label: 'Quality',
    blurb: 'Is broken data piling up?',
    keys: ['noop_translations', 'orphan_sentences', 'dead_end_movies', 'a2_registry_share'],
  },
  {
    id: 'caches',
    label: 'Caches',
    blurb: 'Are we reusing what we already paid for?',
    keys: [
      'translation_cache_growth',
      'word_sentence_examples_rows',
      'word_sentence_gloss_share',
    ],
  },
  {
    id: 'cost',
    label: 'Cost',
    blurb: 'What is AI costing us today?',
    keys: ['llm_cost_last_24h'],
  },
];

/**
 * What each number means, in the plainest words that are still true.
 *
 * House style, because these are read at 2am by someone deciding whether to
 * care: **one short sentence saying what it is, then one saying what good and
 * bad look like.** No metric names, no table names, no "weighted" unless the
 * weighting changes the decision. If a sentence needs a comma and a clause to
 * survive, it is explaining the implementation rather than the number.
 */
export const METRIC_EXPLANATIONS: Readonly<Record<string, string>> = {
  vocab_snapshot_age:
    'How long since these numbers were last written down. Under a day is normal. If it climbs past two, the job that records them has stopped — and every "since last time" arrow on this page is then comparing today against something stale.',
  usage_weighted_sentence_coverage:
    'Out of the words learners actually run into, how many have an example sentence ready. Higher is better; this is the one number that says whether the app has something to teach. Common words count for more than rare ones, because that is what people hit.',
  uncovered_visible_lemmas:
    'How many real words still have no example sentence. Should fall a little every day as the worker grinds through them. If it jumps up, either a batch of new films landed or the worker died.',
  noop_translations:
    'Translations that came back identical to the English. That is almost always a silent failure we then saved. Should be zero.',
  orphan_sentences:
    'Example sentences attached to no word, so nothing can ever show them. Harmless, but they mean something broke during an import.',
  dead_end_movies:
    'Films we never got a usable script for. They still show in the catalogue and can teach nothing.',
  a2_registry_share:
    'How much of the whole dictionary we rated A2. If one level holds most of the words, the grader is not really telling them apart — and every level-based feature gets worse.',
  translation_cache_growth:
    'New translations saved in the last week. Above zero means we are keeping what we buy. Zero means we are probably paying to translate the same text twice.',
  word_sentence_examples_rows:
    'How many word reveals we have saved so we never have to build them again. Should climb steadily as people use the app.',
  word_sentence_gloss_share:
    'Of those saved reveals, how many had the word matched to the exact sentence it sits in. When this drops, a word can be shown with a meaning that does not fit its own sentence.',
  llm_cost_last_24h:
    'What we spent on AI today, against the daily cap. Writing sentences and revealing words both draw on it, so it rises when either gets busy.',
};

export function explanationFor(key: string): string {
  return METRIC_EXPLANATIONS[key] ?? 'No description available for this metric yet.';
}

export interface CategorySection {
  category: CoverageCategory;
  metrics: VocabCoverageMetric[];
}

const OTHER_CATEGORY: CoverageCategory = {
  id: 'other',
  label: 'Other',
  blurb: 'Numbers we have not filed anywhere yet.',
  keys: [],
};

/**
 * Group metrics into the tab sections, preserving each category's declared
 * order. Any metric the server adds that we don't know about lands in "Other"
 * rather than silently vanishing; empty categories are dropped.
 */
export function groupMetricsByCategory(
  metrics: readonly VocabCoverageMetric[]
): CategorySection[] {
  const byKey = new Map(metrics.map((m) => [m.key, m]));
  const claimed = new Set<string>();
  const sections: CategorySection[] = [];

  for (const category of COVERAGE_CATEGORIES) {
    const found: VocabCoverageMetric[] = [];
    for (const key of category.keys) {
      const m = byKey.get(key);
      if (m) {
        found.push(m);
        claimed.add(key);
      }
    }
    if (found.length > 0) sections.push({ category, metrics: found });
  }

  const leftovers = metrics.filter((m) => !claimed.has(m.key));
  if (leftovers.length > 0) {
    sections.push({ category: OTHER_CATEGORY, metrics: leftovers });
  }
  return sections;
}

/**
 * Trend line for a metric, phrased so "good" and "bad" are explicit rather than
 * leaving the reader to work out whether up is good. Null when there's no prior
 * snapshot to compare against.
 */
export function formatTrend(metric: VocabCoverageMetric): { text: string; good: boolean } | null {
  const { delta, direction } = metric;
  if (delta == null || delta === 0) return null;
  const rose = delta > 0;
  const magnitude = Math.abs(delta);
  const mag = Number.isInteger(magnitude)
    ? magnitude.toLocaleString()
    : magnitude.toFixed(2);
  // direction 'min' = higher is better, so a rise is good.
  const good = direction === 'min' ? rose : !rose;
  return { text: `${rose ? '▲' : '▼'} ${mag} since last snapshot`, good };
}
