/**
 * Stats selectors (Profile §C) — pure derivations for the profile screen.
 *
 * `SrsStats` exposes aggregate Leitner boxes (`by_box`) but no per-CEFR-level
 * mastery or per-day activity, so the brief's "comprehension by level" and the
 * "5-week contribution calendar" need their own derivations. These are pure +
 * deterministic so they're unit-tested at the boundaries; the screen feeds
 * real store/API data in (and renders the static end-state until that data
 * exists — no fabricated numbers).
 */

import { CEFR_LEVELS, type CefrLevel } from '../../types';

export interface LevelWord {
  cefr_level: CefrLevel;
  /** True once the user has mastered/learned this word. */
  mastered: boolean;
}

export interface ComprehensionByLevel {
  level: CefrLevel;
  /** Whole-percent mastered for the band (0 when the band has no words). */
  pct: number;
  mastered: number;
  total: number;
}

/**
 * Per-CEFR-band comprehension. Always returns all six bands in order (A1→C2)
 * so the UI has a stable row set even for bands with no words yet.
 */
export function comprehensionByLevel(words: ReadonlyArray<LevelWord>): ComprehensionByLevel[] {
  const totals: Record<CefrLevel, { mastered: number; total: number }> = {
    A1: { mastered: 0, total: 0 },
    A2: { mastered: 0, total: 0 },
    B1: { mastered: 0, total: 0 },
    B2: { mastered: 0, total: 0 },
    C1: { mastered: 0, total: 0 },
    C2: { mastered: 0, total: 0 },
  };
  for (const w of words) {
    const bucket = totals[w.cefr_level];
    if (!bucket) continue; // ignore unknown levels defensively
    bucket.total += 1;
    if (w.mastered) bucket.mastered += 1;
  }
  return CEFR_LEVELS.map((level) => {
    const { mastered, total } = totals[level];
    return { level, mastered, total, pct: total === 0 ? 0 : Math.round((mastered / total) * 100) };
  });
}

/**
 * Maps a per-day review count to a 0–3 contribution-calendar intensity:
 *   0 = none · 1 = light (1–2) · 2 = medium (3–5) · 3 = heavy (6+).
 */
export function intensityForCount(count: number): 0 | 1 | 2 | 3 {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  return 3;
}

/**
 * Builds a `weeks × 7` flat intensity grid (most-recent day last) from a map of
 * YYYY-MM-DD → review count, ending on `today`. Days with no entry are 0.
 */
export function calendarIntensity(
  countsByDate: Readonly<Record<string, number>>,
  today: Date = new Date(),
  weeks = 5,
): Array<0 | 1 | 2 | 3> {
  const days = weeks * 7;
  const out: Array<0 | 1 | 2 | 3> = [];
  // Walk oldest → newest so index 0 is the furthest-back day.
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push(intensityForCount(countsByDate[key] ?? 0));
  }
  return out;
}
