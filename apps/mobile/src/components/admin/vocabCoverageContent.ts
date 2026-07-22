/**
 * vocabCoverageContent — the plain-English layer over /admin/health/vocab-coverage.
 *
 * The API returns raw metrics with terse thresholds ("warn <90%, fail <20%").
 * This module owns (a) how those metrics are grouped into tabs, (b) a human
 * explanation of what each one actually means, and (c) the meter geometry the
 * view draws. All pure — no React, no fetching — so it's unit-testable and the
 * view stays presentation-only.
 *
 * Thresholds themselves are NOT redeclared here: warn_at/fail_at/max_value come
 * from the server so the markers can never drift from the bands the backend
 * actually classifies against.
 */

import type { VocabCoverageMetric, VocabCoverageStatus } from '../../services/api';

export type CoverageCategoryId = 'coverage' | 'quality' | 'caches' | 'cost' | 'other';

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
  {
    id: 'coverage',
    label: 'Coverage',
    blurb: 'Do the words in our movies have example sentences to show?',
    keys: ['usage_weighted_sentence_coverage', 'uncovered_visible_lemmas'],
  },
  {
    id: 'quality',
    label: 'Quality',
    blurb: 'Is the vocabulary data clean, or is broken data piling up?',
    keys: ['noop_translations', 'orphan_sentences', 'dead_end_movies', 'a2_registry_share'],
  },
  {
    id: 'caches',
    label: 'Caches',
    blurb: 'Are we reusing saved work instead of paying to redo it?',
    keys: [
      'translation_cache_growth',
      'word_sentence_examples_rows',
      'word_sentence_gloss_share',
    ],
  },
  {
    id: 'cost',
    label: 'Cost',
    blurb: 'What are we spending on AI, and how close is that to the cap?',
    keys: ['llm_cost_last_24h'],
  },
];

/** High-level, jargon-free: what does this number actually tell me? */
export const METRIC_EXPLANATIONS: Readonly<Record<string, string>> = {
  usage_weighted_sentence_coverage:
    'Of all the words people actually meet in movies, the share that have at least one example sentence ready to show. Weighted by how often each word appears, so common words count more than rare ones. This is the headline "is the product ready" number.',
  uncovered_visible_lemmas:
    'How many real words still have no example sentence at all. The sentence worker grinds this down over time, so it should keep falling — if it climbs, either the worker stalled or a batch of new movies just landed.',
  noop_translations:
    'Translations that came back word-for-word identical to the English. That almost always means the translation silently failed and we cached the failure. Should sit at zero.',
  orphan_sentences:
    'Example sentences that are not linked to any word, so nothing can ever display them. Harmless but dead weight, and a sign something broke during import.',
  dead_end_movies:
    'Movies we could never get a usable script for, so they have no vocabulary behind them. They still appear in the catalogue but can not teach anything.',
  a2_registry_share:
    'The share of every word we know that is rated A2 (elementary). If almost everything lands in one difficulty level, the grader is not really discriminating — so level-based features get less useful.',
  translation_cache_growth:
    'How many new translations we saved in the last 7 days. Above zero means caching is alive and working. Zero would suggest we are re-translating the same text and paying for it twice.',
  word_sentence_examples_rows:
    'How many word reveals we have cached (the sentence plus its translation). This grows each time someone reveals a word we have not seen before, so it should climb steadily.',
  word_sentence_gloss_share:
    'Of those cached reveals, the share where the word’s meaning was matched to the specific sentence. When this is low the alignment step is being skipped, so the word’s translation can disagree with the sentence it sits in.',
  llm_cost_last_24h:
    'What we spent on AI in the last 24 hours, against the daily cap. Both sentence generation and word reveals draw from this budget, so it climbs when either is busy.',
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
  blurb: 'Metrics the app does not have a category for yet.',
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

export function statusCounts(
  metrics: readonly VocabCoverageMetric[]
): Record<VocabCoverageStatus, number> {
  const counts: Record<VocabCoverageStatus, number> = { ok: 0, warn: 0, fail: 0 };
  for (const m of metrics) counts[m.status] += 1;
  return counts;
}

const STATUS_RANK: Record<VocabCoverageStatus, number> = { ok: 0, warn: 1, fail: 2 };

/** Worst status in the list — mirrors the server's overall rollup. */
export function worstStatus(metrics: readonly VocabCoverageMetric[]): VocabCoverageStatus {
  let worst: VocabCoverageStatus = 'ok';
  for (const m of metrics) {
    if (STATUS_RANK[m.status] > STATUS_RANK[worst]) worst = m.status;
  }
  return worst;
}

export interface MeterGeometry {
  /** Fill width as a 0–100 percentage of the track. */
  fillPct: number;
  /** Marker positions along the track, or null when that band doesn't apply. */
  warnPct: number | null;
  failPct: number | null;
}

const clampPct = (n: number): number => Math.max(0, Math.min(100, n));

/**
 * Meter geometry for a bounded metric, or null when the metric is an unbounded
 * count (which renders as a stat tile instead).
 */
export function meterGeometry(metric: VocabCoverageMetric): MeterGeometry | null {
  const max = metric.max_value;
  if (max == null || max <= 0) return null;
  const toPct = (n: number | null): number | null =>
    n == null ? null : clampPct((n / max) * 100);
  return {
    fillPct: metric.value == null ? 0 : clampPct((metric.value / max) * 100),
    warnPct: toPct(metric.warn_at),
    failPct: toPct(metric.fail_at),
  };
}

/** Display string for a metric value, respecting its unit. */
export function formatMetricValue(metric: VocabCoverageMetric): string {
  const { value, unit } = metric;
  if (value == null) return '—';
  const n = Number.isInteger(value)
    ? value.toLocaleString()
    : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (unit === '%') return `${n}%`;
  if (unit === '$') return `$${n}`;
  return `${n} ${unit}`;
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
