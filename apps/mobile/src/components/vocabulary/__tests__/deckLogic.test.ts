import {
  deckReducer,
  restoreDeck,
  promotedKeyAfterRemoval,
  swipeDecision,
  shouldClaimHorizontalDrag,
  parseViewMode,
  pickDefaultLevel,
  resolveBookmarkLevel,
  SWIPE_THRESHOLD,
  SWIPE_VELOCITY_THRESHOLD,
  HORIZONTAL_BIAS,
  CLAIM_DISTANCE,
  STACK_SLOTS,
  VIEW_MODE_KEY,
  type DeckState,
  type VocabViewMode,
} from '../deckLogic';
import { SWIPE_COMMIT_VELOCITY, SWIPE_H_BIAS } from '../../../utils/swipeDecision';

const KEYS = ['hollow', 'brittle', 'run out of', 'grim'];

describe('restoreDeck', () => {
  it('starts from the bookmarked word when it is in the deck', () => {
    expect(restoreDeck(KEYS, 'run out of')).toEqual({ keys: KEYS, index: 2 });
  });

  it('falls back to card 0 when there is no bookmark', () => {
    expect(restoreDeck(KEYS, null)).toEqual({ keys: KEYS, index: 0 });
  });

  it('falls back to card 0 when the bookmarked word is not in this deck', () => {
    expect(restoreDeck(KEYS, 'elsewhere')).toEqual({ keys: KEYS, index: 0 });
  });

  it('marks an empty deck with index -1', () => {
    expect(restoreDeck([], 'hollow')).toEqual({ keys: [], index: -1 });
  });
});

describe('deckReducer advance', () => {
  it('moves to the next card', () => {
    const state: DeckState = { keys: KEYS, index: 1 };
    expect(deckReducer(state, { type: 'advance' }).index).toBe(2);
  });

  it('wraps to the first card past the end — words stay in rotation', () => {
    const state: DeckState = { keys: KEYS, index: 3 };
    expect(deckReducer(state, { type: 'advance' }).index).toBe(0);
  });

  it('no-ops on an empty deck', () => {
    const state: DeckState = { keys: [], index: -1 };
    expect(deckReducer(state, { type: 'advance' })).toBe(state);
  });
});

describe('deckReducer sync (items changed under the deck)', () => {
  it('keeps focus on the same card when it is still present', () => {
    // "brittle" was learned while "grim" is focused: position shifts 3 → 2.
    const state: DeckState = { keys: KEYS, index: 3 };
    const next = deckReducer(state, { type: 'sync', keys: ['hollow', 'run out of', 'grim'] });
    expect(next).toEqual({ keys: ['hollow', 'run out of', 'grim'], index: 2 });
  });

  it('promotes the card now at the same position when the focused card was learned', () => {
    const state: DeckState = { keys: KEYS, index: 1 };
    const next = deckReducer(state, { type: 'sync', keys: ['hollow', 'run out of', 'grim'] });
    expect(next.index).toBe(1); // "run out of" promotes into position 1
  });

  it('wraps to the start when the learned card was the last one', () => {
    const state: DeckState = { keys: KEYS, index: 3 };
    const next = deckReducer(state, { type: 'sync', keys: ['hollow', 'brittle', 'run out of'] });
    expect(next.index).toBe(0);
  });

  it('ends the deck (index -1) when every card is gone', () => {
    const state: DeckState = { keys: KEYS, index: 2 };
    expect(deckReducer(state, { type: 'sync', keys: [] })).toEqual({ keys: [], index: -1 });
  });

  it('recovers from an empty deck when cards arrive', () => {
    const state: DeckState = { keys: [], index: -1 };
    expect(deckReducer(state, { type: 'sync', keys: KEYS }).index).toBe(0);
  });
});

describe('deckReducer focus (undo a swipe)', () => {
  it('moves focus back to the given key', () => {
    const state: DeckState = { keys: KEYS, index: 2 };
    expect(deckReducer(state, { type: 'focus', key: 'brittle' })).toEqual({
      keys: KEYS,
      index: 1,
    });
  });

  it('no-ops when the key has left the deck (learned meanwhile)', () => {
    const state: DeckState = { keys: KEYS, index: 2 };
    expect(deckReducer(state, { type: 'focus', key: 'gone' })).toBe(state);
  });

  it('no-ops when the key is already focused', () => {
    const state: DeckState = { keys: KEYS, index: 1 };
    expect(deckReducer(state, { type: 'focus', key: 'brittle' })).toBe(state);
  });
});

describe('deckReducer restore', () => {
  it('re-runs the bookmark restore against a new key set', () => {
    const state: DeckState = { keys: [], index: -1 };
    const next = deckReducer(state, { type: 'restore', keys: KEYS, bookmarkWord: 'grim' });
    expect(next).toEqual({ keys: KEYS, index: 3 });
  });
});

describe('promotedKeyAfterRemoval', () => {
  it('names the card that takes focus after the current one is learned', () => {
    expect(promotedKeyAfterRemoval({ keys: KEYS, index: 1 }, 'brittle')).toBe('run out of');
  });

  it('wraps to the first card when the last one is removed', () => {
    expect(promotedKeyAfterRemoval({ keys: KEYS, index: 3 }, 'grim')).toBe('hollow');
  });

  it('returns null when the removal empties the deck', () => {
    expect(promotedKeyAfterRemoval({ keys: ['hollow'], index: 0 }, 'hollow')).toBeNull();
  });
});

describe('swipeDecision', () => {
  it('treats a left pan past the threshold as "I know this"', () => {
    expect(swipeDecision(-91)).toBe('learn');
    expect(swipeDecision(-SWIPE_THRESHOLD)).toBe('learn');
  });

  it('treats a right pan past the threshold as next', () => {
    expect(swipeDecision(91)).toBe('next');
    expect(swipeDecision(SWIPE_THRESHOLD)).toBe('next');
  });

  it('does nothing inside the threshold (springs back)', () => {
    expect(swipeDecision(0)).toBeNull();
    expect(swipeDecision(-89)).toBeNull();
    expect(swipeDecision(89)).toBeNull();
  });

  it('matches BookmarkRowWrapper: 90pt', () => {
    expect(SWIPE_THRESHOLD).toBe(90);
  });

  // #110: the deck used to read distance only, so the flick below — the
  // gesture users actually make — travelled 60pt and did nothing.
  it('commits a short fast flick that never reaches the distance threshold', () => {
    expect(swipeDecision(60, SWIPE_VELOCITY_THRESHOLD + 0.3)).toBe('next');
    expect(swipeDecision(-60, -(SWIPE_VELOCITY_THRESHOLD + 0.3))).toBe('learn');
  });

  it('still springs back on a short SLOW drag — the distance rule is intact', () => {
    expect(swipeDecision(60, 0.1)).toBeNull();
    expect(swipeDecision(-60, -0.1)).toBeNull();
    expect(swipeDecision(89, SWIPE_VELOCITY_THRESHOLD)).toBeNull();
  });

  it('behaves exactly as before when no velocity is supplied', () => {
    for (const dx of [0, -89, 89, -SWIPE_THRESHOLD, SWIPE_THRESHOLD, -91, 91, -300, 300]) {
      expect(swipeDecision(dx, 0)).toBe(swipeDecision(dx));
    }
    expect(swipeDecision(89, 0)).toBeNull();
    expect(swipeDecision(-91, 0)).toBe('learn');
  });

  it('takes the direction from a pure flick with no travel at all', () => {
    expect(swipeDecision(0, 0.9)).toBe('next');
    expect(swipeDecision(0, -0.9)).toBe('learn');
  });

  it('reuses the home feed flick speed rather than a second constant', () => {
    expect(SWIPE_VELOCITY_THRESHOLD).toBe(SWIPE_COMMIT_VELOCITY);
  });
});

describe('shouldClaimHorizontalDrag (deck vs. vertical scroll)', () => {
  it('claims a decisively horizontal drag', () => {
    expect(shouldClaimHorizontalDrag(20, 2)).toBe(true);
    expect(shouldClaimHorizontalDrag(-20, 2)).toBe(true);
  });

  it('leaves vertical scrolls to the ScrollView', () => {
    expect(shouldClaimHorizontalDrag(4, 30)).toBe(false);
    expect(shouldClaimHorizontalDrag(0, -12)).toBe(false);
  });

  // #110: at the old 1.5 this exact drag fell through to the scroll, which is
  // half of why a real thumb swipe read as unresponsive.
  it('claims the diagonal arc a real thumb traces', () => {
    expect(shouldClaimHorizontalDrag(15, 12)).toBe(true);
    expect(shouldClaimHorizontalDrag(-15, 12)).toBe(true);
  });

  it('still leaves a vertically-dominant drag to the ScrollView', () => {
    // 12 is not > 15, so the screen scrolls. The home feed's 0.65 would claim
    // this one; the deck deliberately does not — it kills the whole screen's
    // scroll for the gesture and cannot hand it back.
    expect(shouldClaimHorizontalDrag(12, 15)).toBe(false);
    expect(shouldClaimHorizontalDrag(20, 26)).toBe(false);
  });

  it('stays stricter than the home feed, on purpose', () => {
    expect(HORIZONTAL_BIAS).toBeGreaterThan(SWIPE_H_BIAS);
    // …but no longer stricter than "more horizontal than vertical".
    expect(HORIZONTAL_BIAS).toBeLessThanOrEqual(1);
  });

  it('ignores sub-threshold horizontal jitter', () => {
    expect(shouldClaimHorizontalDrag(CLAIM_DISTANCE, 0)).toBe(false);
    expect(shouldClaimHorizontalDrag(CLAIM_DISTANCE + 1, 0)).toBe(true);
  });
});

describe('STACK_SLOTS (promote animation geometry)', () => {
  it('puts the focused slot at identity so a promoted card lands exactly on it', () => {
    expect(STACK_SLOTS[0]).toEqual({ translateY: 0, scale: 1, opacity: 1 });
  });

  it('recedes monotonically — each layer higher, smaller, and fainter', () => {
    for (let i = 1; i < STACK_SLOTS.length; i++) {
      expect(STACK_SLOTS[i].translateY).toBeLessThan(STACK_SLOTS[i - 1].translateY);
      expect(STACK_SLOTS[i].scale).toBeLessThan(STACK_SLOTS[i - 1].scale);
      expect(STACK_SLOTS[i].opacity).toBeLessThan(STACK_SLOTS[i - 1].opacity);
    }
  });
});

describe('view-mode persistence', () => {
  it('round-trips both modes through the persisted string', () => {
    const modes: VocabViewMode[] = ['rows', 'cards'];
    for (const mode of modes) {
      // What gets written to AsyncStorage is the mode string itself.
      expect(parseViewMode(mode)).toBe(mode);
    }
  });

  it('falls back on missing or corrupt values', () => {
    expect(parseViewMode(null)).toBe('rows');
    expect(parseViewMode(undefined)).toBe('rows');
    expect(parseViewMode('grid')).toBe('rows');
    expect(parseViewMode('', 'cards')).toBe('cards');
  });

  it('uses the AsyncStorage key from the spec', () => {
    expect(VIEW_MODE_KEY).toBe('vocab_view_mode');
  });
});

describe('pickDefaultLevel (no-bookmark screen load)', () => {
  it('opens the level with the most words', () => {
    expect(pickDefaultLevel({ A1: 4, B1: 31, B2: 12 })).toBe('B1');
  });

  it('returns null for an empty distribution so the caller keeps its default', () => {
    expect(pickDefaultLevel({})).toBeNull();
  });
});

describe('resolveBookmarkLevel (bookmarked screen load)', () => {
  const idioms = [{ phrase: 'run out of', cefr_level: 'b2' }];

  it('uses the stored CEFR level for a plain bookmark', () => {
    expect(resolveBookmarkLevel({ word: 'hollow', level: 'C1' }, idioms)).toBe('C1');
  });

  it('migrates a legacy idioms-mode bookmark to the phrase’s own CEFR level', () => {
    const legacy = { word: 'run out of', level: 'intermediate', mode: 'idioms' };
    expect(resolveBookmarkLevel(legacy, idioms)).toBe('B2');
  });

  it('keeps the stored level when the legacy phrase is no longer in the vocab', () => {
    const legacy = { word: 'long gone', level: 'advanced', mode: 'idioms' };
    expect(resolveBookmarkLevel(legacy, idioms)).toBe('advanced');
  });
});
