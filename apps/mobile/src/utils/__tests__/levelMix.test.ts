/**
 * levelMix — the Explore mix as cut points on one bar.
 *
 * The rule these all defend: shares are *derived* from the cuts, so there is
 * no arrangement of cuts whose shares fail to total 100. That is what removes
 * the "15% still to assign" state, the redistribution pass and the disabled
 * Done — so the total-is-always-100 property test below is the one that makes
 * the whole design claim real, not a nice-to-have.
 */
import {
  MIX_CUT_COUNT,
  MIX_LEVELS,
  MIX_STEP,
  MIX_TOTAL,
  cutsToMix,
  defaultMixForLevel,
  dominantLevel,
  isBalanced,
  isValidMix,
  mixShortfall,
  mixToCuts,
  mixTotal,
  moveCut,
  nudge,
  pageCounts,
  type MixCuts,
} from '../levelMix';
import type { LevelMix } from '../../services/api';

const DEFAULT = { A1: 0, A2: 0, B1: 70, B2: 20, C1: 10, C2: 0 };
/** What the previous, four-level build wrote to AsyncStorage. */
const LEGACY = { A2: 0, B1: 70, B2: 20, C1: 10 };

const sharesOf = (mix: Record<string, number>) => MIX_LEVELS.map((l) => mix[l] ?? 0);

describe('levelMix — the six levels', () => {
  it('addresses the whole CEFR range', () => {
    expect(MIX_LEVELS).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
    expect(MIX_CUT_COUNT).toBe(5);
  });

  it('sums the six levels, treating a missing one as zero', () => {
    expect(mixTotal(DEFAULT)).toBe(100);
    expect(mixTotal(LEGACY)).toBe(100);
  });
});

describe('levelMix — cuts are the state', () => {
  it('derives shares as the gaps between cuts', () => {
    expect(cutsToMix([0, 0, 55, 80, 95])).toEqual({
      A1: 0, A2: 0, B1: 55, B2: 25, C1: 15, C2: 5,
    });
  });

  it('round-trips a mix through cuts unchanged', () => {
    expect(cutsToMix(mixToCuts(DEFAULT))).toEqual(DEFAULT);
  });

  it('gives the last level whatever is left of the bar', () => {
    expect(cutsToMix([10, 20, 30, 40, 50]).C2).toBe(50);
  });

  it('orders and clamps cuts handed to it out of shape', () => {
    // Nothing in the app produces these; the total must survive them anyway.
    expect(mixTotal(cutsToMix([80, 20, 50, -30, 400]))).toBe(MIX_TOTAL);
    expect(mixTotal(cutsToMix([]))).toBe(MIX_TOTAL);
  });
});

describe('levelMix — total is always 100', () => {
  it('holds across any sequence of drags and nudges', () => {
    // The property test. A random walk over the two operations the UI can
    // perform, from a random legal start, asserting the invariant after each.
    let seed = 20260830;
    const rand = () => {
      // Deterministic LCG — a flaky property test is worse than none.
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let run = 0; run < 200; run++) {
      let cuts: MixCuts = mixToCuts(defaultMixForLevel(MIX_LEVELS[run % MIX_LEVELS.length]));

      for (let step = 0; step < 25; step++) {
        cuts =
          rand() < 0.5
            ? moveCut(cuts, Math.floor(rand() * MIX_CUT_COUNT), rand() * 120 - 10)
            : nudge(
                cuts,
                Math.floor(rand() * MIX_LEVELS.length),
                rand() < 0.5 ? MIX_STEP : -MIX_STEP,
              );

        const mix = cutsToMix(cuts);
        expect(mixTotal(mix)).toBe(MIX_TOTAL);
        expect(isValidMix(mix)).toBe(true);
      }
    }
  });

  it('keeps cuts ordered and snapped after every operation', () => {
    let cuts: MixCuts = mixToCuts(DEFAULT);
    for (const [index, value] of [[3, 12], [0, 91], [4, 3], [2, 100], [1, 0]] as const) {
      cuts = moveCut(cuts, index, value);
      expect(cuts).toEqual([...cuts].sort((a, b) => a - b));
      for (const c of cuts) {
        expect(c % MIX_STEP).toBe(0);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(MIX_TOTAL);
      }
    }
  });
});

describe('levelMix — moveCut', () => {
  it('snaps to 5% detents', () => {
    expect(moveCut([0, 0, 0, 0, 0], 0, 63)).toEqual([65, 65, 65, 65, 65]);
    expect(moveCut([0, 0, 0, 0, 0], 0, 61)).toEqual([60, 60, 60, 60, 60]);
  });

  it('pushes later cuts rather than crossing them', () => {
    // Cut 2 dragged past cuts 3 and 4 takes them with it; they end level
    // with it, never behind it.
    const next = moveCut([10, 20, 30, 40, 50], 2, 80);
    expect(next).toEqual([10, 20, 80, 80, 80]);
    expect(next).toEqual([...next].sort((a, b) => a - b));
  });

  it('pushes earlier cuts the same way', () => {
    expect(moveCut([10, 20, 30, 40, 50], 3, 5)).toEqual([5, 5, 5, 5, 50]);
  });

  it('zeroes one level by dragging its divider onto its neighbour', () => {
    // B1 (cut 1 → cut 2) collapses; nothing else moves.
    const before = cutsToMix([10, 20, 40, 60, 80]);
    const after = cutsToMix(moveCut([10, 20, 40, 60, 80], 2, 20));
    expect(after.B1).toBe(0);
    expect(after.A1).toBe(before.A1);
    expect(after.A2).toBe(before.A2);
    expect(after.B2).toBe(40);
    expect(mixTotal(after)).toBe(MIX_TOTAL);
  });

  it('drives A1 to 100 by sweeping the stack to the end', () => {
    const mix = cutsToMix(moveCut(mixToCuts(DEFAULT), 0, 100));
    expect(mix).toEqual({ A1: 100, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 });
    expect(isValidMix(mix)).toBe(true);
    expect(cutsToMix(mixToCuts(mix))).toEqual(mix);
  });

  it('drives C2 to 100 by sweeping the stack to the start', () => {
    const mix = cutsToMix(moveCut(mixToCuts(DEFAULT), MIX_CUT_COUNT - 1, 0));
    expect(mix).toEqual({ A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 100 });
    expect(isValidMix(mix)).toBe(true);
    expect(cutsToMix(mixToCuts(mix))).toEqual(mix);
  });

  it('ignores an index off the end of the bar', () => {
    expect(moveCut([10, 20, 30, 40, 50], 9, 80)).toEqual([10, 20, 30, 40, 50]);
  });
});

describe('levelMix — nudge', () => {
  it('gives a level 5%, taken from the largest other level', () => {
    const mix = cutsToMix(nudge(mixToCuts(DEFAULT), 0));
    expect(mix.A1).toBe(5);
    expect(mix.B1).toBe(65); // B1 was the largest
    expect(mix.B2).toBe(20);
    expect(mixTotal(mix)).toBe(MIX_TOTAL);
  });

  it('reopens a level sitting at 0%', () => {
    const collapsed = mixToCuts({ A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 100 });
    expect(cutsToMix(nudge(collapsed, 0))).toEqual({
      A1: 5, A2: 0, B1: 0, B2: 0, C1: 0, C2: 95,
    });
  });

  it('breaks donor ties toward the higher CEFR level', () => {
    // B1 and B2 are level at 50. Nudging A1 must take from B2, so repeated
    // taps don't gut one level while its equal sits untouched.
    const mix = cutsToMix(nudge(mixToCuts({ B1: 50, B2: 50 }), 0));
    expect(mix.B1).toBe(50);
    expect(mix.B2).toBe(45);
    expect(mix.A1).toBe(5);
  });

  it('runs the trade backwards on a negative delta', () => {
    const mix = cutsToMix(nudge(mixToCuts(DEFAULT), 2, -MIX_STEP));
    expect(mix.B1).toBe(65);
    // The largest other level receives it — B2 at 20.
    expect(mix.B2).toBe(25);
  });

  it('is a no-op when the level already holds 100', () => {
    const full = mixToCuts({ C2: 100 });
    expect(nudge(full, MIX_LEVELS.indexOf('C2'))).toEqual(full);
    expect(cutsToMix(nudge(full, MIX_LEVELS.indexOf('C2')))).toEqual({
      A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 100,
    });
  });

  it('is a no-op when the level has nothing to give back', () => {
    const cuts = mixToCuts(DEFAULT);
    expect(nudge(cuts, MIX_LEVELS.indexOf('A1'), -MIX_STEP)).toEqual(cuts);
  });
});

describe('levelMix — migration of stored mixes', () => {
  it('round-trips a four-level mix from the previous build', () => {
    // The literal AsyncStorage value: A1 and C2 absent, and it still totals
    // 100, so it must survive untouched with those two at 0%.
    expect(isBalanced(LEGACY)).toBe(true);
    expect(cutsToMix(mixToCuts(LEGACY))).toEqual(DEFAULT);
  });

  it('scales an unbalanced mix back to 100, keeping its shape', () => {
    // The old panel's legal-but-unsendable state: 85 assigned.
    const recovered = cutsToMix(mixToCuts({ A2: 0, B1: 60, B2: 15, C1: 10 }));
    expect(mixTotal(recovered)).toBe(MIX_TOTAL);
    // Proportions preserved: B1 stays the dominant level, C1 the smallest.
    expect(recovered.B1).toBeGreaterThan(recovered.B2);
    expect(recovered.B2).toBeGreaterThan(recovered.C1);
    expect(recovered.C1).toBeGreaterThan(0);
    expect(dominantLevel(recovered)).toBe('B1');
  });

  it('snaps a scaled mix to whole detents', () => {
    for (const c of mixToCuts({ B1: 33, B2: 33, C1: 19 })) {
      expect(c % MIX_STEP).toBe(0);
    }
  });

  it('falls back to the B1 row for an empty or unusable mix', () => {
    expect(cutsToMix(mixToCuts({}))).toEqual(defaultMixForLevel('B1'));
    expect(cutsToMix(mixToCuts({ B1: 0, B2: 0 }))).toEqual(defaultMixForLevel('B1'));
    expect(cutsToMix(mixToCuts({ B1: NaN } as never))).toEqual(defaultMixForLevel('B1'));
  });
});

describe('levelMix — dominant level', () => {
  it('names the most-weighted level for the rail', () => {
    expect(dominantLevel(DEFAULT)).toBe('B1');
    expect(dominantLevel({ A1: 0, A2: 0, B1: 10, B2: 60, C1: 30, C2: 0 })).toBe('B2');
    expect(dominantLevel({ C2: 100 })).toBe('C2');
    expect(dominantLevel({ A1: 100 })).toBe('A1');
  });

  it('breaks ties toward the lower level so the label does not flicker', () => {
    expect(dominantLevel({ B1: 50, B2: 50 })).toBe('B1');
  });
});

describe('levelMix — first-run default', () => {
  it('sits 70/20/10 on the user level and the two above', () => {
    expect(defaultMixForLevel('A1')).toEqual({ A1: 70, A2: 20, B1: 10, B2: 0, C1: 0, C2: 0 });
    expect(defaultMixForLevel('B1')).toEqual({ A1: 0, A2: 0, B1: 70, B2: 20, C1: 10, C2: 0 });
  });

  it('folds the overflow back when the band runs off the top', () => {
    expect(defaultMixForLevel('C1')).toEqual({ A1: 0, A2: 0, B1: 0, B2: 0, C1: 70, C2: 30 });
    expect(defaultMixForLevel('C2')).toEqual({ A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 100 });
  });

  it('falls back to B1 for an unknown level', () => {
    expect(defaultMixForLevel(null)).toEqual(defaultMixForLevel('B1'));
    expect(defaultMixForLevel('nonsense')).toEqual(defaultMixForLevel('B1'));
  });

  it('always produces a balanced mix expressible as cuts', () => {
    for (const level of [...MIX_LEVELS, null]) {
      const mix = defaultMixForLevel(level);
      expect(mixTotal(mix)).toBe(MIX_TOTAL);
      expect(cutsToMix(mixToCuts(mix))).toEqual(mix);
    }
  });
});

describe('levelMix — wire guard', () => {
  it('accepts every shape the bar can produce, including single levels', () => {
    expect(isValidMix(DEFAULT)).toBe(true);
    expect(isValidMix({ A1: 100 })).toBe(true);
    expect(isValidMix({ C2: 100 })).toBe(true);
  });

  it('rejects sums that are not 100', () => {
    expect(isValidMix({ B1: 70, B2: 20 })).toBe(false);
    expect(isValidMix({ B1: 70, B2: 40 })).toBe(false);
  });

  it('rejects unknown levels and bad shapes', () => {
    expect(isValidMix({ D1: 100 })).toBe(false);
    expect(isValidMix({ B1: '70' })).toBe(false);
    expect(isValidMix({ B1: NaN, B2: 100 })).toBe(false);
    expect(isValidMix({})).toBe(false);
    expect(isValidMix(null)).toBe(false);
  });
});

describe('levelMix — page read-out', () => {
  it('reads the mix out as cards', () => {
    expect(pageCounts(DEFAULT, 20)).toEqual([
      { level: 'B1', count: 14 },
      { level: 'B2', count: 4 },
      { level: 'C1', count: 2 },
    ]);
  });

  it('omits levels at 0', () => {
    expect(pageCounts({ C2: 100 }, 20)).toEqual([{ level: 'C2', count: 20 }]);
  });

  it('always sums to the page size', () => {
    const mixes: LevelMix[] = [
      DEFAULT,
      { A1: 100 },
      { C2: 100 },
      { A1: 5, A2: 5, B1: 5, B2: 5, C1: 5, C2: 75 },
      { A1: 5, A2: 15, B1: 20, B2: 20, C1: 20, C2: 20 },
      // The shapes naive rounding loses or gains a card on.
      { A1: 35, A2: 35, B1: 30 },
      { A1: 5, A2: 95 },
      { B1: 50, B2: 50 },
      { A1: 10, A2: 10, B1: 10, B2: 10, C1: 30, C2: 30 },
      { A2: 45, C1: 55 },
      { A1: 15, B2: 85 },
      { A1: 25, B1: 25, C1: 25, C2: 25 },
    ];
    for (const size of [1, 3, 7, 20, 50]) {
      for (const mix of mixes) {
        const counts = pageCounts(mix, size);
        expect(counts.reduce((sum, c) => sum + c.count, 0)).toBe(size);
      }
    }
  });

  it('returns nothing for an empty page or an empty mix', () => {
    expect(pageCounts(DEFAULT, 0)).toEqual([]);
    expect(pageCounts({}, 20)).toEqual([]);
  });
});

describe('levelMix — thin-level note', () => {
  it('names the level that came back empty and where the cards came from', () => {
    expect(mixShortfall({ A1: 50, A2: 50 }, { A2: 20 })).toEqual({ short: 'A1', from: 'A2' });
  });

  it('stays quiet until a real page has come back', () => {
    expect(mixShortfall(DEFAULT, {})).toBeNull();
  });

  it('stays quiet when everything the user asked for was served', () => {
    expect(mixShortfall(DEFAULT, { B1: 14, B2: 4, C1: 2 })).toBeNull();
  });

  it('ignores levels the user did not really ask for', () => {
    expect(mixShortfall({ B1: 100 }, { B1: 20 })).toBeNull();
  });

  it('names the largest shortfall when several levels came back empty', () => {
    const note = mixShortfall({ A1: 10, A2: 30, B1: 60 }, { B1: 20 });
    expect(note).toEqual({ short: 'A2', from: 'B1' });
  });
});

describe('levelMix — shares', () => {
  it('exposes exactly six shares in CEFR order', () => {
    expect(sharesOf(cutsToMix([5, 10, 65, 90, 95]))).toEqual([5, 5, 55, 25, 5, 5]);
  });
});
