/**
 * The quiz header's two shapes. Not a render test (mobile testing is logic +
 * integration only — see CLAUDE.md); what can regress here is the branch that
 * decides whether there is a deck to report on at all, plus the fill maths
 * that used to sit inline in the component.
 */

import { quizSegments, quizHeaderProgress, sessionPosition } from '../quizHeaderLayout';

describe('quizHeaderProgress — mid-deck', () => {
  it('reports progress and fills proportionally', () => {
    expect(quizHeaderProgress(1, 4)).toEqual({ showProgress: true, pct: 25 });
    expect(quizHeaderProgress(2, 4)).toEqual({ showProgress: true, pct: 50 });
  });

  it('fills completely on the last card, never past it', () => {
    expect(quizHeaderProgress(4, 4).pct).toBe(100);
    // A card index that has run past the deck (an off-by-one upstream) must
    // clamp rather than render a bar wider than its track.
    expect(quizHeaderProgress(9, 4).pct).toBe(100);
  });

  it('clamps a negative index to an empty bar', () => {
    expect(quizHeaderProgress(-3, 4).pct).toBe(0);
  });
});

describe('quizHeaderProgress — no deck behind the header', () => {
  // The done screen. It shares the header so the session ends in the same
  // chrome it ran in, but a counter and a progress bar there would be
  // reporting on a deck that no longer exists.
  it('drops the chrome when the position is omitted', () => {
    expect(quizHeaderProgress()).toEqual({ showProgress: false, pct: 0 });
  });

  it('drops it when only one half of the pair is given', () => {
    expect(quizHeaderProgress(3, undefined).showProgress).toBe(false);
    expect(quizHeaderProgress(undefined, 10).showProgress).toBe(false);
  });

  it('treats a zero-card session as no deck rather than dividing by zero', () => {
    expect(quizHeaderProgress(0, 0)).toEqual({ showProgress: false, pct: 0 });
    expect(quizHeaderProgress(1, 0).pct).not.toBeNaN();
  });
});

describe('sessionPosition — a resumed deck counts from where it left off', () => {
  // `reviewSessionStore` caches an in-flight session so quitting Practice
  // and coming back picks up the same cards. It hands back only what's
  // *left* — answered cards are dropped as they're consumed — and the
  // screen fed that straight to the header. A user three cards into a
  // ten-card session was told "1 / 7", with the gold bar reset to empty,
  // while the done screen at the end reported all ten. The store has kept
  // `totalCards` since it was written; nothing read it.

  it('counts across the whole session, not the tail', () => {
    // Answered 3 of 10, quit, reopened: 7 cards loaded, sitting on the first.
    expect(sessionPosition(0, 7, 3)).toEqual({ index: 4, total: 10 });
  });

  it('advances through the resumed portion to the real end', () => {
    expect(sessionPosition(6, 7, 3)).toEqual({ index: 10, total: 10 });
  });

  it('is the plain count for a fresh session', () => {
    // Nothing answered before, so the offset has to disappear entirely
    // rather than shift a normal session by one.
    expect(sessionPosition(0, 10, 0)).toEqual({ index: 1, total: 10 });
    expect(sessionPosition(9, 10, 0)).toEqual({ index: 10, total: 10 });
  });

  it('feeds a progress bar that never runs backwards on resume', () => {
    // The bug's visible half: reopening used to reset the bar to ~14%
    // after the user had already filled 30% of it.
    const before = quizHeaderProgress(3, 10).pct;
    const resumed = sessionPosition(0, 7, 3);
    expect(quizHeaderProgress(resumed.index, resumed.total).pct).toBeGreaterThan(before);
  });

  it('ignores a negative offset rather than counting below one', () => {
    expect(sessionPosition(0, 5, -2)).toEqual({ index: 1, total: 5 });
  });
});

describe('quizSegments (the bar doubles as a scorecard)', () => {
  it('colours each answered question by its own outcome', () => {
    // The old bar was one fill to a percentage, which said where you were and
    // nothing about how it had gone.
    expect(quizSegments([true, false, true], 4, 5)).toEqual([
      'correct',
      'wrong',
      'correct',
      'current',
      'pending',
    ]);
  });

  it('marks exactly one segment current', () => {
    const segs = quizSegments([true], 2, 5);
    expect(segs.filter((x) => x === 'current')).toHaveLength(1);
  });

  it('is all pending but the first on an untouched deck', () => {
    expect(quizSegments([], 1, 3)).toEqual(['current', 'pending', 'pending']);
  });

  it('leaves nothing current once the last answer lands', () => {
    // At the end `index` still points at the last card, but it is answered —
    // an answered segment must not be overwritten by the current marker.
    expect(quizSegments([true, true], 2, 2)).toEqual(['correct', 'correct']);
  });

  it('returns one segment per question, always', () => {
    expect(quizSegments([true], 2, 7)).toHaveLength(7);
    expect(quizSegments([], 1, 1)).toHaveLength(1);
  });

  it('renders nothing for a deck with no cards', () => {
    // A zero-card session would otherwise draw an empty bar claiming a deck
    // that is not there — the same reason `quizHeaderProgress` bails.
    expect(quizSegments([], 0, 0)).toEqual([]);
  });

  it('survives a resumed deck reporting more answers than the index', () => {
    // `index` counts from the resumed position; outcomes are recovered totals.
    // Neither may push a segment out of range or drop one.
    expect(quizSegments([true, true, false], 4, 5)).toHaveLength(5);
  });
});
