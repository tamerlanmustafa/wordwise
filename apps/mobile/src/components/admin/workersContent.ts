/**
 * workersContent — what each background worker is, in plain English, and how
 * to read whether it is alive.
 *
 * WordWise runs four long-lived processes next to the API. Nothing in the app
 * ever shows them, so the only way anyone knew the movie seed had been
 * restarting its page walk from 1 on every deploy — for months — was to read
 * the log line that said "0 new jobs" and understand why that was a failure
 * rather than a steady state. Same for the sentence worker, which sat wedged
 * for five days behind a WARN nobody read (#154).
 *
 * So this page is written for someone who has never seen the pipeline: what
 * the worker does, why it matters to a user, and what "healthy" looks like.
 *
 * Pure — no React, no fetching. The view renders what this decides, which is
 * what makes the status rules testable without a device.
 */

import type { AdminWorkers } from '../../services/api';

export type WorkerId = 'job' | 'sentence' | 'definition' | 'translation';

/** Same three-way scale as every /admin/health/* report, plus "off" for a
 *  worker that is deliberately not running — which is a fact, not a fault. */
export type WorkerHealth = 'ok' | 'warn' | 'fail' | 'off';

export interface WorkerCopy {
  id: WorkerId;
  /** What it is called on the page. */
  name: string;
  /** The one-line version: what it does, in the app's own terms. */
  summary: string;
  /** Two or three sentences for someone who has never seen the pipeline —
   *  what it actually does, and what a user would notice if it stopped. */
  explainer: string;
  /** What good looks like, so a number on this page can be judged without
   *  already knowing the system. */
  healthy: string;
  /** The ledger `context` this worker writes its LLM spend under, if it spends
   *  anything. The movie job worker calls TMDB and subtitle sources, not an
   *  LLM, so it has none. */
  ledgerContext?: string;
}

export const WORKERS: readonly WorkerCopy[] = [
  {
    id: 'job',
    name: 'Film ingestion',
    summary: 'Finds films on TMDB, fetches their subtitles, and grades every word in them.',
    explainer:
      'This is the front of the pipeline. It keeps a queue of films to process; for each one it ' +
      'looks up the subtitles, splits them into words, reduces each word to its dictionary form, ' +
      'and assigns it a CEFR level. A film only appears in Explore once this has finished with ' +
      'it — until then it exists on TMDB and not in the app.',
    healthy:
      'Pending falls over time and Done climbs. Nothing pending and nothing done for days means ' +
      'either the catalogue is fully drained or the worker is asleep — the "last finished" time ' +
      'below is what tells those two apart.',
  },
  {
    id: 'sentence',
    name: 'Example sentences',
    summary: 'Writes the example sentence shown under a word.',
    explainer:
      'Every word a learner taps needs a sentence that uses it. Asking the model at the moment ' +
      'of the tap would make the card wait several seconds, so this worker writes them in ' +
      'advance for every word that appears in a film and has none yet. If it stops, new words ' +
      'still work — they just fall back to generating on demand, and the card is slow.',
    healthy:
      'Spend in the last 24h is small and non-zero while there is still a backlog, and zero once ' +
      'there is not. Steady spend with a backlog that never shrinks is the shape of a loop.',
    ledgerContext: 'sentence_worker',
  },
  {
    id: 'definition',
    name: 'Definitions',
    summary: 'Writes the one-line meaning under a word.',
    explainer:
      'Runs after the sentence worker and reads its output: the definition has to describe the ' +
      'sense the example sentence uses, not the word\'s most common sense, or the card ' +
      'contradicts itself. A word with no definition still shows — the gloss line under it is ' +
      'simply blank, which is what 2,330 words looked like before September 2026.',
    healthy:
      'Missing definitions fall. "Retryable" is the part of that gap the worker will attempt ' +
      'again; the rest are words the model has already declined and will not be paid for twice.',
    ledgerContext: 'definition_worker',
  },
  {
    id: 'translation',
    name: 'Translation cache',
    summary: 'Pre-translates words and sentences into every language the app offers.',
    explainer:
      'Translating at the moment a card is revealed means waiting on an external service on the ' +
      'critical path of somebody\'s first card. This worker fills the cache ahead of them, ' +
      'paced by monthly free allowances that reset on their own schedule. If it is off, ' +
      'translations still work — the first person to need one pays the wait, and everyone after ' +
      'them gets it from the cache.',
    healthy:
      'Currently disabled on purpose after a run that spent money and produced nothing. Off is ' +
      'the expected state until that is fixed.',
  },
];

export function workerById(id: WorkerId): WorkerCopy {
  const found = WORKERS.find((w) => w.id === id);
  if (!found) throw new Error(`unknown worker: ${id}`);
  return found;
}

/** Hours since an ISO timestamp, or null when there is nothing to measure. */
export function hoursSince(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return (now - t) / 3_600_000;
}

/**
 * "3 h ago" / "yesterday" / "never".
 *
 * A relative age rather than a timestamp because the question this page
 * answers is "is it alive", and nobody can subtract two ISO strings at a
 * glance. The absolute time is one tap away in the logs when it matters.
 */
export function relativeAge(iso: string | null | undefined, now = Date.now()): string {
  const hours = hoursSince(iso, now);
  if (hours == null) return 'never';
  if (hours < 0) return 'just now'; // clock skew between phone and server
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min ago`;
  if (hours < 24) return `${Math.round(hours)} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} d ago`;
  const months = Math.round(days / 30);
  return months < 12 ? `${months} mo ago` : `${Math.round(days / 365)} y ago`;
}

/** Money, at the resolution these numbers actually land on. Sub-cent spend is
 *  common (one Haiku batch is fractions of a cent) and rounding it to $0.00
 *  would make a live worker look idle. */
export function formatUsd(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

export function formatCount(n: number): string {
  return n.toLocaleString();
}

/**
 * Is this worker awake?
 *
 * Deliberately not "does it have a backlog". A worker with an empty queue and
 * one that died three weeks ago holding a full one both report zero throughput
 * — the difference is entirely in *when* it last did something, which is why
 * every rule below is about a timestamp and not a count.
 *
 * `warn` rather than `fail` almost everywhere: a worker being quiet is
 * ambiguous evidence on a product with a drained backlog, and a dashboard that
 * cries fail at its normal steady state is a dashboard people stop reading.
 */
export function workerHealth(
  id: WorkerId,
  data: AdminWorkers | null,
  now = Date.now(),
): WorkerHealth {
  if (!data) return 'off';

  if (id === 'translation') {
    // Disabled in prod since the 2026-08-21 runaway. Off is the intended
    // state, so it reports off rather than pretending to be healthy.
    const seen = hoursSince(data.llm_last_seen?.translation_worker ?? null, now);
    return seen != null && seen < data.active_window_hours ? 'ok' : 'off';
  }

  if (id === 'job') {
    const { pending, running, dead, last_done_at } = data.queue;
    const idleHours = hoursSince(last_done_at, now);
    // Work waiting and nothing finished in a day: the queue is not moving.
    if (pending + running > 0 && (idleHours == null || idleHours > data.active_window_hours)) {
      return 'warn';
    }
    // Everything drained. Dead jobs are worth a look but are not an outage —
    // a film with no subtitles anywhere is a permanent, correct dead end.
    if (dead > 0 && pending + running === 0) return 'warn';
    return 'ok';
  }

  const copy = workerById(id);
  const context = copy.ledgerContext;
  const backlog =
    id === 'definition' ? data.backlog.definitions_retryable : null;
  const lastSeen = context ? hoursSince(data.llm_last_seen?.[context] ?? null, now) : null;

  // Nothing left to do is the goal, not a fault — even if it has been silent
  // for a month.
  if (backlog === 0) return 'ok';
  if (lastSeen == null) return 'warn';       // work outstanding, never ran
  return lastSeen > data.active_window_hours ? 'warn' : 'ok';
}

export const WORKER_HEALTH_LABEL: Readonly<Record<WorkerHealth, string>> = {
  ok: 'Running',
  warn: 'Check',
  fail: 'Down',
  off: 'Off',
};

/**
 * The rows shown under one worker: its numbers, already formatted and already
 * labelled in plain words.
 *
 * Built here rather than in the view so that "which numbers does this worker
 * actually have" is one decision in one place — the four workers share no
 * metrics at all, and a view that branched on `id` inline would grow a
 * different shape for each of them.
 */
export interface WorkerStat {
  label: string;
  value: string;
  /** Extra line under the value, for the ones a number alone misreads. */
  hint?: string;
}

export function workerStats(
  id: WorkerId,
  data: AdminWorkers,
  now = Date.now(),
): WorkerStat[] {
  const copy = workerById(id);
  const spend = copy.ledgerContext ? data.llm_24h?.[copy.ledgerContext] : undefined;
  const lastSeen = copy.ledgerContext ? data.llm_last_seen?.[copy.ledgerContext] : null;

  if (id === 'job') {
    const q = data.queue;
    const f = data.fetcher;
    const rows: WorkerStat[] = [
      { label: 'Films waiting', value: formatCount(q.pending) },
      { label: 'Films in progress', value: formatCount(q.running) },
      { label: 'Films finished', value: formatCount(q.done) },
      {
        label: 'Finished today',
        value: formatCount(q.done_24h),
        hint: `Last one ${relativeAge(q.last_done_at, now)}.`,
      },
      {
        label: 'Gave up on',
        value: formatCount(q.dead),
        hint: 'No subtitles found anywhere, or failed too many times.',
      },
      {
        label: 'Last film queued',
        value: relativeAge(q.last_queued_at, now),
        hint: 'New releases are looked for every 12 hours.',
      },
    ];
    if (f.events_1h > 0) {
      rows.push({
        label: 'Subtitle lookups (1 h)',
        value: `${formatCount(f.events_1h - f.failures_1h)} of ${formatCount(f.events_1h)} worked`,
        hint: `Slowest ones took ${(f.p95_ms / 1000).toFixed(1)} s.`,
      });
    }
    if (f.target_qps != null) {
      rows.push({
        label: 'Request pace',
        value: `${f.target_qps.toFixed(2)}/s`,
        hint: 'Speeds up while the sources are healthy, backs off the moment they are not.',
      });
    }
    return rows;
  }

  if (id === 'sentence') {
    return [
      {
        label: 'Words it has given up on',
        value: formatCount(data.backlog.sentences_skipped),
        hint: 'The model declined these. Changing the prompt lets it try them again.',
      },
      { label: 'Calls today', value: formatCount(spend?.calls ?? 0) },
      { label: 'Spent today', value: formatUsd(spend?.cost_usd ?? 0) },
      { label: 'Last worked', value: relativeAge(lastSeen, now) },
    ];
  }

  if (id === 'definition') {
    return [
      {
        label: 'Words with no meaning yet',
        value: formatCount(data.backlog.definitions_missing),
        hint: 'Their card shows the word with a blank line under it.',
      },
      {
        label: 'Of those, it will retry',
        value: formatCount(data.backlog.definitions_retryable),
        hint: 'The rest were declined by the model and are not paid for twice.',
      },
      { label: 'Calls today', value: formatCount(spend?.calls ?? 0) },
      { label: 'Spent today', value: formatUsd(spend?.cost_usd ?? 0) },
      { label: 'Last worked', value: relativeAge(lastSeen, now) },
    ];
  }

  return [
    {
      label: 'Status',
      value: 'Disabled',
      hint: 'Turned off after a run that spent money and produced nothing.',
    },
  ];
}
