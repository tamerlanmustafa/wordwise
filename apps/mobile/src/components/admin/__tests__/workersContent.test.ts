/**
 * The Workers page's copy and its health rules.
 *
 * The rules are the part worth testing. "Is this worker alive" cannot be
 * answered by a throughput number: a worker that has drained its backlog and
 * one that died three weeks ago holding a full one both report zero. Every
 * rule here is therefore about a timestamp, and the cases below are the ones
 * that actually happened — the sentence worker wedged for five days behind a
 * WARN nobody read (#154), and the movie seed reporting "0 new jobs" on every
 * restart for months while the catalogue never grew.
 */

import type { AdminWorkers } from '../../../services/api';
import {
  WORKERS,
  WORKER_HEALTH_LABEL,
  formatUsd,
  hoursSince,
  relativeAge,
  workerById,
  workerHealth,
  workerStats,
} from '../workersContent';

const NOW = new Date('2026-09-05T12:00:00Z').getTime();

function hoursAgo(h: number): string {
  return new Date(NOW - h * 3_600_000).toISOString();
}

function makeData(over: Partial<AdminWorkers> = {}): AdminWorkers {
  return {
    queue: {
      done: 4353,
      pending: 0,
      running: 0,
      failed: 0,
      dead: 0,
      done_24h: 12,
      last_done_at: hoursAgo(1),
      last_queued_at: hoursAgo(3),
      next_run_at: null,
    },
    fetcher: { events_1h: 40, failures_1h: 1, p95_ms: 900, target_qps: 0.75, max_qps: 4 },
    llm_24h: {},
    llm_last_seen: {},
    backlog: { definitions_missing: 0, definitions_retryable: 0, sentences_skipped: 2059 },
    active_window_hours: 24,
    ...over,
  };
}

// ── copy ────────────────────────────────────────────────────────────────────

describe('worker copy', () => {
  it('covers all four background processes', () => {
    expect(WORKERS.map((w) => w.id)).toEqual(['job', 'sentence', 'definition', 'translation']);
  });

  it('explains every worker in plain words rather than pipeline nouns', () => {
    for (const w of WORKERS) {
      expect(w.summary.length).toBeGreaterThan(20);
      expect(w.explainer.length).toBeGreaterThan(120);
      expect(w.healthy.length).toBeGreaterThan(40);
    }
  });

  it('names the ledger context for every worker that spends money', () => {
    // Spend is attributed by the `context` string the worker writes. A worker
    // whose key is wrong shows $0 while it is looping, which is the exact
    // failure this page exists to catch.
    expect(workerById('sentence').ledgerContext).toBe('sentence_worker');
    expect(workerById('definition').ledgerContext).toBe('definition_worker');
    // The film worker calls TMDB and subtitle sources, not an LLM.
    expect(workerById('job').ledgerContext).toBeUndefined();
  });

  it('refuses an unknown id rather than rendering a blank card', () => {
    // @ts-expect-error deliberately off-contract
    expect(() => workerById('nope')).toThrow();
  });
});

// ── time helpers ────────────────────────────────────────────────────────────

describe('relativeAge', () => {
  it.each([
    [null, 'never'],
    [undefined, 'never'],
  ])('reports %s as %s', (iso, expected) => {
    expect(relativeAge(iso, NOW)).toBe(expected);
  });

  it('scales from minutes to years', () => {
    expect(relativeAge(hoursAgo(0.25), NOW)).toBe('15 min ago');
    expect(relativeAge(hoursAgo(5), NOW)).toBe('5 h ago');
    expect(relativeAge(hoursAgo(24), NOW)).toBe('yesterday');
    expect(relativeAge(hoursAgo(24 * 9), NOW)).toBe('9 d ago');
    expect(relativeAge(hoursAgo(24 * 60), NOW)).toBe('2 mo ago');
    expect(relativeAge(hoursAgo(24 * 400), NOW)).toBe('1 y ago');
  });

  it('never renders a negative age when the phone clock is ahead of the server', () => {
    expect(relativeAge(new Date(NOW + 60_000).toISOString(), NOW)).toBe('just now');
  });

  it('treats an unparseable timestamp as no timestamp', () => {
    expect(relativeAge('not a date', NOW)).toBe('never');
    expect(hoursSince('not a date', NOW)).toBeNull();
  });
});

describe('formatUsd', () => {
  it('keeps sub-cent spend visible', () => {
    // One Haiku batch costs fractions of a cent. Rounding to $0.00 would make
    // a worker that is actively spending look idle.
    expect(formatUsd(0.0004)).toBe('$0.0004');
    expect(formatUsd(0.42)).toBe('$0.420');
    expect(formatUsd(12.5)).toBe('$12.50');
  });

  it('prints an exact zero as $0, not $0.0000', () => {
    expect(formatUsd(0)).toBe('$0');
  });
});

// ── health ──────────────────────────────────────────────────────────────────

describe('workerHealth', () => {
  it('reports off when there is no data at all', () => {
    expect(workerHealth('job', null, NOW)).toBe('off');
  });

  describe('film ingestion', () => {
    it('is ok when the queue is drained', () => {
      expect(workerHealth('job', makeData(), NOW)).toBe('ok');
    });

    it('warns when work is queued and nothing has finished in a day', () => {
      // The shape of a wedged worker: a full queue and no movement.
      const data = makeData({
        queue: { ...makeData().queue, pending: 32, last_done_at: hoursAgo(48) },
      });
      expect(workerHealth('job', data, NOW)).toBe('warn');
    });

    it('is ok when work is queued and it is visibly moving', () => {
      const data = makeData({
        queue: { ...makeData().queue, pending: 32, last_done_at: hoursAgo(2) },
      });
      expect(workerHealth('job', data, NOW)).toBe('ok');
    });

    it('warns when the queue is empty but films were given up on', () => {
      const data = makeData({ queue: { ...makeData().queue, dead: 193 } });
      expect(workerHealth('job', data, NOW)).toBe('warn');
    });

    it('does not warn about dead jobs while there is still live work', () => {
      // Dead films are worth a look, not an interruption — and while the queue
      // is moving they are the least interesting thing on the page.
      const data = makeData({
        queue: { ...makeData().queue, dead: 193, pending: 10, last_done_at: hoursAgo(1) },
      });
      expect(workerHealth('job', data, NOW)).toBe('ok');
    });

    it('warns when there is work queued and nothing has ever finished', () => {
      const data = makeData({
        queue: { ...makeData().queue, pending: 5, done: 0, last_done_at: null },
      });
      expect(workerHealth('job', data, NOW)).toBe('warn');
    });
  });

  describe('definitions', () => {
    it('is ok when the backlog is empty, however long it has been silent', () => {
      // Nothing left to do is the goal. A page that turns amber when a worker
      // finishes is a page people learn to ignore.
      const data = makeData({
        backlog: { definitions_missing: 60, definitions_retryable: 0, sentences_skipped: 0 },
        llm_last_seen: { definition_worker: hoursAgo(24 * 30) },
      });
      expect(workerHealth('definition', data, NOW)).toBe('ok');
    });

    it('warns when there is a retryable backlog and it has been silent for a day', () => {
      const data = makeData({
        backlog: { definitions_missing: 7700, definitions_retryable: 7700, sentences_skipped: 0 },
        llm_last_seen: { definition_worker: hoursAgo(30) },
      });
      expect(workerHealth('definition', data, NOW)).toBe('warn');
    });

    it('is ok while it is actively draining a backlog', () => {
      const data = makeData({
        backlog: { definitions_missing: 7700, definitions_retryable: 7700, sentences_skipped: 0 },
        llm_last_seen: { definition_worker: hoursAgo(1) },
      });
      expect(workerHealth('definition', data, NOW)).toBe('ok');
    });

    it('warns when it has work outstanding and has never run', () => {
      const data = makeData({
        backlog: { definitions_missing: 100, definitions_retryable: 100, sentences_skipped: 0 },
        llm_last_seen: {},
      });
      expect(workerHealth('definition', data, NOW)).toBe('warn');
    });
  });

  describe('translation cache', () => {
    it('reports off, because off is what it is meant to be', () => {
      // Disabled in prod since the 2026-08-21 runaway. Reporting that as a
      // failure would put a permanent red mark on a deliberate decision.
      expect(workerHealth('translation', makeData(), NOW)).toBe('off');
    });

    it('reports ok if it is ever switched back on and runs', () => {
      const data = makeData({ llm_last_seen: { translation_worker: hoursAgo(2) } });
      expect(workerHealth('translation', data, NOW)).toBe('ok');
    });
  });

  it('has a word for every status, so colour is never the only signal', () => {
    for (const key of ['ok', 'warn', 'fail', 'off'] as const) {
      expect(WORKER_HEALTH_LABEL[key]).toBeTruthy();
    }
  });
});

// ── stats ───────────────────────────────────────────────────────────────────

describe('workerStats', () => {
  it('gives every worker at least one row', () => {
    const data = makeData();
    for (const w of WORKERS) {
      expect(workerStats(w.id, data, NOW).length).toBeGreaterThan(0);
    }
  });

  it('labels rows in learner-facing words, not table names', () => {
    const labels = WORKERS.flatMap((w) => workerStats(w.id, makeData(), NOW)).map((s) => s.label);
    const jargon = /lemma|movie_jobs|sentence_bank|cefr|tmdb_id|backlog/i;
    for (const label of labels) expect(label).not.toMatch(jargon);
  });

  it('shows spend attributed to the right worker', () => {
    const data = makeData({
      llm_24h: {
        definition_worker: { calls: 12, cost_usd: 0.42, last_at: hoursAgo(1) },
        sentence_worker: { calls: 0, cost_usd: 0, last_at: null },
      },
    });

    const defRows = workerStats('definition', data, NOW);
    expect(defRows.find((r) => r.label === 'Spent today')?.value).toBe('$0.420');
    const sentRows = workerStats('sentence', data, NOW);
    expect(sentRows.find((r) => r.label === 'Spent today')?.value).toBe('$0');
  });

  it('reports zero spend rather than blank when a worker has no ledger rows', () => {
    const rows = workerStats('sentence', makeData(), NOW);
    expect(rows.find((r) => r.label === 'Calls today')?.value).toBe('0');
  });

  it('omits the subtitle-source rows when there is no recent traffic', () => {
    // An empty hour is silence, not a 0% success rate — printing "0 of 0
    // worked" reads as an outage.
    const data = makeData({ fetcher: { ...makeData().fetcher, events_1h: 0 } });
    const labels = workerStats('job', data, NOW).map((r) => r.label);
    expect(labels).not.toContain('Subtitle lookups (1 h)');
  });

  it('includes them when there is', () => {
    const labels = workerStats('job', makeData(), NOW).map((r) => r.label);
    expect(labels).toContain('Subtitle lookups (1 h)');
  });

  it('omits the pace row when the rate limiter has never been written', () => {
    const data = makeData({ fetcher: { ...makeData().fetcher, target_qps: null } });
    const labels = workerStats('job', data, NOW).map((r) => r.label);
    expect(labels).not.toContain('Request pace');
  });

  it('separates the definition backlog it will retry from the part it will not', () => {
    // The whole point of the 2026-09-05 fix: a word the model declined is not
    // re-bought, so "missing" and "will retry" are different numbers and the
    // page must not conflate them.
    const data = makeData({
      backlog: { definitions_missing: 2460, definitions_retryable: 69, sentences_skipped: 0 },
    });
    const rows = workerStats('definition', data, NOW);
    expect(rows.find((r) => r.label === 'Words with no meaning yet')?.value).toBe('2,460');
    expect(rows.find((r) => r.label === 'Of those, it will retry')?.value).toBe('69');
  });
});
