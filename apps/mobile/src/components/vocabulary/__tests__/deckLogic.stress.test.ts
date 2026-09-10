/**
 * The deck under a thumb that will not stop.
 *
 * Every bug this deck has shipped came from a *sequence*, never from a single
 * call: a swipe committing while the previous card was still flying, a level
 * tab tapped twice before the first render landed, a batch of example
 * sentences arriving after the reader had already moved on. Each function was
 * correct on its own, which is exactly why unit tests kept passing.
 *
 * So this file does not test functions. It drives them the way a person does —
 * fast, repeatedly, in orders nobody designed for — and asserts the things that
 * must be true no matter what happened before:
 *
 *   • the cursor always points at a real card, or at nothing
 *   • the reader stays on the word they were on, whenever it still exists
 *   • the deck never shows a card twice
 *   • the count does not move while the pool can still supply it
 *   • the plan/fetch loop settles instead of running for ever
 *
 * Seeded, so a failure names the sequence that caused it (see test-utils/fuzz).
 */

import {
  deckReducer,
  peekNextIndex,
  planDeck,
  restoreDeck,
  swipeDecision,
  warmWindowKeys,
  DECK_TARGET_CARDS,
  type DeckAction,
  type DeckBand,
  type DeckState,
} from '../deckLogic';
import { forSeeds, gestureValue, makeRng } from '../../../test-utils/fuzz';

const words = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ word: `${prefix}${i}` }));

const keysOf = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`);

/** Every invariant the cursor must satisfy, whatever was done to it. */
function assertCursorSane(state: DeckState) {
  if (state.keys.length === 0) {
    expect(state.index).toBe(-1);
    return;
  }
  expect(state.index).toBeGreaterThanOrEqual(0);
  expect(state.index).toBeLessThan(state.keys.length);
  expect(state.keys[state.index]).toBeDefined();
}

describe('deck cursor under a random action storm', () => {
  it('always points at a real card, or at nothing', () => {
    forSeeds(15, (rng) => {
      let state = restoreDeck(keysOf(rng.int(30)), null);
      for (let step = 0; step < 200; step += 1) {
        const action: DeckAction = rng.pick([
          { type: 'advance' } as const,
          { type: 'focus', key: `w${rng.int(35)}` } as const,
          { type: 'sync', keys: keysOf(rng.int(30)) } as const,
          { type: 'restore', keys: keysOf(rng.int(30)), bookmarkWord: `w${rng.int(35)}` } as const,
        ]);
        state = deckReducer(state, action);
        assertCursorSane(state);
      }
    });
  });

  it('keeps the reader on the card they were on whenever it survives a sync', () => {
    // The load-bearing promise of `sync`. A confirmed sentence miss removes a
    // word mid-session; if that reshuffles the focus, the card under the
    // reader's thumb silently becomes a different word.
    forSeeds(15, (rng) => {
      let state = restoreDeck(keysOf(20), null);
      for (let step = 0; step < 150; step += 1) {
        if (rng.chance(0.5)) state = deckReducer(state, { type: 'advance' });
        const before = state.index >= 0 ? state.keys[state.index] : null;
        // Drop a random subset, but never the focused word.
        const survivors = state.keys.filter((k) => k === before || rng.chance(0.7));
        state = deckReducer(state, { type: 'sync', keys: survivors });
        assertCursorSane(state);
        if (before != null && survivors.includes(before)) {
          expect(state.keys[state.index]).toBe(before);
        }
      }
    });
  });

  it('advances round the whole deck and back to the start, never off it', () => {
    forSeeds(10, (rng) => {
      const size = 1 + rng.int(25);
      let state = restoreDeck(keysOf(size), null);
      const seen = new Set<string>();
      for (let step = 0; step < size * 3; step += 1) {
        seen.add(state.keys[state.index]);
        state = deckReducer(state, { type: 'advance' });
        assertCursorSane(state);
      }
      // Three laps of a rotation must have touched every card.
      expect(seen.size).toBe(size);
    });
  });

  it('survives the deck emptying underneath it', () => {
    // A level with no renderable sentences at all, arriving mid-session.
    forSeeds(10, (rng) => {
      let state = restoreDeck(keysOf(15), null);
      for (let i = 0; i < rng.int(10); i += 1) state = deckReducer(state, { type: 'advance' });
      state = deckReducer(state, { type: 'sync', keys: [] });
      expect(state.index).toBe(-1);
      // …and refilling brings it back rather than leaving it stranded.
      state = deckReducer(state, { type: 'sync', keys: keysOf(5) });
      assertCursorSane(state);
    });
  });

  it('never proposes a next card that is not in the deck', () => {
    forSeeds(20, (rng) => {
      let state = restoreDeck(keysOf(rng.int(20)), null);
      for (let step = 0; step < 100; step += 1) {
        state = deckReducer(state, rng.chance(0.5)
          ? { type: 'advance' }
          : { type: 'sync', keys: keysOf(rng.int(20)) });
        const next = peekNextIndex(state);
        if (next >= 0) expect(state.keys[next]).toBeDefined();
        for (const key of warmWindowKeys(state)) expect(state.keys).toContain(key);
      }
    });
  });
});

describe('swipes fired faster than they can commit', () => {
  it('always resolves to one of three answers, for any gesture', () => {
    // Including the ones a real thumb produces at the moment of release:
    // zero travel, a flick with no distance, a drag that ends where it began.
    forSeeds(30, (rng) => {
      for (let i = 0; i < 400; i += 1) {
        const action = swipeDecision(gestureValue(rng), gestureValue(rng, 5));
        expect(['learn', 'next', null]).toContain(action);
      }
    });
  });

  it('never commits on a gesture that went nowhere', () => {
    const rng = makeRng(99);
    for (let i = 0; i < 200; i += 1) {
      expect(swipeDecision(0, rng.range(-0.4, 0.4))).toBeNull();
    }
  });

  it('is symmetric: mirroring a gesture mirrors the answer', () => {
    // RTL flips `dx` and `vx` through `directionSign` before this sees them, so
    // an asymmetry here would send an Arabic reader's card the wrong way.
    forSeeds(20, (rng) => {
      for (let i = 0; i < 200; i += 1) {
        const dx = gestureValue(rng);
        const vx = gestureValue(rng, 5);
        const a = swipeDecision(dx, vx);
        const b = swipeDecision(-dx, -vx);
        if (a === null) expect(b).toBeNull();
        else expect(b).toBe(a === 'next' ? 'learn' : 'next');
      }
    });
  });
});

describe('planDeck under a churning usability oracle', () => {
  const bands = (): DeckBand<{ word: string }>[] => [
    { items: words('s', 120), cap: 42 },
    { items: words('o', 120) },
    { items: words('b', 400) },
  ];

  // Seed and round counts are kept deliberately modest: this suite runs on
  // every push (.husky/pre-push) and in CI, and a stress test that adds
  // seconds to that loop is one someone eventually reaches for `--onlyChanged`
  // to avoid. Twelve seeds over twelve rounds already walks tens of thousands
  // of plans.
  it('never exceeds the target, never repeats a card, never invents one', () => {
    forSeeds(12, (rng) => {
      const bad = new Set<string>();
      const all = new Set(bands().flatMap((b) => b.items.map((i) => i.word)));
      for (let round = 0; round < 12; round += 1) {
        const { cards, scanned } = planDeck(bands(), (w) => !bad.has(w), DECK_TARGET_CARDS);
        expect(cards.length).toBeLessThanOrEqual(DECK_TARGET_CARDS);
        expect(new Set(cards.map((c) => c.word)).size).toBe(cards.length);
        expect(new Set(scanned.map((c) => c.word)).size).toBe(scanned.length);
        for (const c of cards) {
          expect(all.has(c.word)).toBe(true);
          expect(bad.has(c.word)).toBe(false);
        }
        // Everything shown was examined, so the sentence batch asked about it.
        const scannedWords = new Set(scanned.map((c) => c.word));
        for (const c of cards) expect(scannedWords.has(c.word)).toBe(true);
        // A round of answers lands: some of what we just scanned has no sentence.
        for (const c of scanned) if (rng.chance(0.25)) bad.add(c.word);
      }
    });
  });

  it('holds the count while the pool can still supply it', () => {
    // The reported bug, replayed: "CARD 3 / 60" must not become "CARD 3 / 42"
    // as the batch responses arrive.
    forSeeds(25, (rng) => {
      const bad = new Set<string>();
      for (let round = 0; round < 12; round += 1) {
        const { cards, scanned } = planDeck(bands(), (w) => !bad.has(w), DECK_TARGET_CARDS);
        expect(cards).toHaveLength(DECK_TARGET_CARDS);
        for (const c of scanned) if (rng.chance(0.2)) bad.add(c.word);
      }
    });
  });

  it('settles instead of looping for ever', () => {
    // The plan feeds the sentence batch and the batch feeds the plan. That is
    // deliberate, and it is also exactly the shape that spins for ever if a
    // round can ever add work without removing any. Each round marks what it
    // asked about; the pool is finite; so it has to reach a fixed point.
    forSeeds(25, (rng) => {
      const bad = new Set<string>();
      const asked = new Set<string>();
      let rounds = 0;
      for (;;) {
        rounds += 1;
        if (rounds > 200) throw new Error('plan/fetch loop did not settle');
        const { scanned } = planDeck(bands(), (w) => !bad.has(w), DECK_TARGET_CARDS);
        const fresh = scanned.filter((c) => !asked.has(c.word));
        if (fresh.length === 0) break;
        for (const c of fresh) {
          asked.add(c.word);
          if (rng.chance(0.3)) bad.add(c.word);
        }
      }
      expect(rounds).toBeLessThan(200);
    });
  });

  it('degrades to a short deck rather than an empty one', () => {
    // Everything unusable except a handful. The ceiling has to give way.
    forSeeds(10, (rng) => {
      const keep = new Set<string>();
      const pool = bands().flatMap((b) => b.items.map((i) => i.word));
      for (let i = 0; i < 5; i += 1) keep.add(rng.pick(pool));
      const { cards } = planDeck(bands(), (w) => keep.has(w), DECK_TARGET_CARDS);
      expect(cards.length).toBe(keep.size);
    });
  });
});
