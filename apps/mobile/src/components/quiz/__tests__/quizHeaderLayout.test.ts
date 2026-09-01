/**
 * The quiz header's two shapes. Not a render test (mobile testing is logic +
 * integration only — see CLAUDE.md); what can regress here is the branch that
 * decides whether there is a deck to report on at all, plus the fill maths
 * that used to sit inline in the component.
 */

import { quizHeaderProgress } from '../quizHeaderLayout';

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
