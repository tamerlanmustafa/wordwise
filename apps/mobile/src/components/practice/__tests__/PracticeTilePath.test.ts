// kindAtIndex lives in practicePathStore, which transitively pulls in
// AsyncStorage. The store's stateful code is irrelevant here — we only
// exercise the pure helpers — so we use the library's official mock.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import {
  buildWindow,
  offsetForIndex,
  connectorXs,
  CONNECTOR_DOTS,
  sectionForIndex,
  isSectionStart,
  SECTION_SIZE,
} from '../PracticeTilePath';
import { kindAtIndex } from '../../../stores/practicePathStore';

describe('kindAtIndex (3-step cycle)', () => {
  it('cycles through the three kinds in order', () => {
    expect(kindAtIndex(0)).toBe('quick_recall');
    expect(kindAtIndex(1)).toBe('tough_words');
    expect(kindAtIndex(2)).toBe('movie_deep_dive');
  });

  it('wraps around after each full cycle', () => {
    expect(kindAtIndex(3)).toBe('quick_recall');
    expect(kindAtIndex(4)).toBe('tough_words');
    expect(kindAtIndex(5)).toBe('movie_deep_dive');
    expect(kindAtIndex(9)).toBe('quick_recall');
    expect(kindAtIndex(11)).toBe('movie_deep_dive');
  });

  it('never returns the deprecated synonym_round kind', () => {
    for (let i = 0; i < 30; i += 1) {
      expect(kindAtIndex(i)).not.toBe('synonym_round');
    }
  });

  it('handles a defensively negative index', () => {
    expect(kindAtIndex(-1)).toBe('movie_deep_dive');
    expect(kindAtIndex(-3)).toBe('quick_recall');
  });
});

describe('buildWindow', () => {
  it('renders 7 tiles for a fresh user (cursor=0): one active + six locked', () => {
    const w = buildWindow(0);
    expect(w).toHaveLength(7);
    expect(w[0]).toEqual({ index: 0, kind: 'quick_recall', state: 'active' });
    expect(w.slice(1).every((t) => t.state === 'locked')).toBe(true);
    expect(w.map((t) => t.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('shows one completed above when cursor=1', () => {
    const w = buildWindow(1);
    expect(w[0]).toEqual({ index: 0, kind: 'quick_recall', state: 'completed' });
    expect(w[1]).toEqual({ index: 1, kind: 'tough_words', state: 'active' });
    expect(w.slice(2).every((t) => t.state === 'locked')).toBe(true);
  });

  it('caps completed-above at 2 once cursor >= 2', () => {
    const w = buildWindow(2);
    expect(w[0].state).toBe('completed');
    expect(w[1].state).toBe('completed');
    expect(w[2]).toEqual({ index: 2, kind: 'movie_deep_dive', state: 'active' });
    expect(w.slice(3).every((t) => t.state === 'locked')).toBe(true);
  });

  it('slides the window once cursor advances past 2', () => {
    const w = buildWindow(5);
    expect(w.map((t) => t.index)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(w[0].state).toBe('completed');
    expect(w[1].state).toBe('completed');
    // cursor=5, 5 % 3 === 2 → movie_deep_dive active.
    expect(w[2]).toEqual({ index: 5, kind: 'movie_deep_dive', state: 'active' });
    expect(w.slice(3).every((t) => t.state === 'locked')).toBe(true);
  });

  it('still cycles kinds correctly past the first full loop', () => {
    // cursor=3: second pass through the 3-step cycle starts.
    const w = buildWindow(3);
    expect(w[2]).toEqual({ index: 3, kind: 'quick_recall', state: 'active' });
    // The two completed tiles just before should be from the end of the
    // first cycle: tough_words (idx 1) and movie_deep_dive (idx 2).
    expect(w[0].kind).toBe('tough_words');
    expect(w[1].kind).toBe('movie_deep_dive');
  });

  it('handles a high cursor far into many cycles', () => {
    const w = buildWindow(100);
    expect(w[2].index).toBe(100);
    expect(w[2].state).toBe('active');
    expect(w[2].kind).toBe('tough_words'); // 100 % 3 === 1
    expect(w.filter((t) => t.state === 'completed')).toHaveLength(2);
    expect(w.filter((t) => t.state === 'locked')).toHaveLength(4);
    expect(w.filter((t) => t.state === 'active')).toHaveLength(1);
  });
});

describe('offsetForIndex (zigzag anchored to absolute index)', () => {
  it('is keyed on absolute index, repeating every 7', () => {
    expect(offsetForIndex(0)).toBe(0);
    expect(offsetForIndex(1)).toBe(24);
    expect(offsetForIndex(7)).toBe(offsetForIndex(0));
    expect(offsetForIndex(8)).toBe(offsetForIndex(1));
  });

  it('handles a defensively negative index', () => {
    // ((-1 % 7) + 7) % 7 === 6 → last offset.
    expect(offsetForIndex(-1)).toBe(-20);
  });

  it('scrolls the path shape as the cursor advances (not frozen)', () => {
    // The bug this fixes: keying the offset on the rendered slot made
    // every window an identical frozen shape. Keying on the absolute
    // index means consecutive cursors render a shifted zigzag.
    const shapeAt = (cursor: number) =>
      buildWindow(cursor).map((t) => offsetForIndex(t.index));
    expect(shapeAt(3)).not.toEqual(shapeAt(4));
  });
});

describe('connectorXs (dotted trail between consecutive tiles)', () => {
  it('steps evenly between the two tiles’ zigzag offsets', () => {
    // offsetForIndex: 0 → 0, 1 → 24. Dots at t = ¼, ½, ¾ of the span.
    expect(connectorXs(0, 1)).toEqual([6, 12, 18]);
  });

  it('interpolates across a negative→positive span', () => {
    // offsetForIndex: 2 → -16, 3 → 12 (span 28).
    expect(connectorXs(2, 3)).toEqual([-9, -2, 5]);
  });

  it('always returns CONNECTOR_DOTS offsets', () => {
    expect(connectorXs(4, 5)).toHaveLength(CONNECTOR_DOTS);
  });

  it('wraps absolute indices the same way offsetForIndex does', () => {
    // Indices 7/8 land on the same zigzag slots as 0/1.
    expect(connectorXs(7, 8)).toEqual(connectorXs(0, 1));
  });
});

describe('section checkpoints', () => {
  it('groups indices into 1-based sections of SECTION_SIZE', () => {
    expect(sectionForIndex(0)).toBe(1);
    expect(sectionForIndex(SECTION_SIZE - 1)).toBe(1);
    expect(sectionForIndex(SECTION_SIZE)).toBe(2);
    expect(sectionForIndex(SECTION_SIZE * 2)).toBe(3);
  });

  it('marks only the first index of each section as a section start', () => {
    expect(isSectionStart(0)).toBe(true);
    expect(isSectionStart(SECTION_SIZE)).toBe(true);
    expect(isSectionStart(SECTION_SIZE * 2)).toBe(true);
    expect(isSectionStart(1)).toBe(false);
    expect(isSectionStart(SECTION_SIZE - 1)).toBe(false);
  });
});
