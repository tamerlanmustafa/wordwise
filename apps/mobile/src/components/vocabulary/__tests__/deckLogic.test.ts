import {
  deckReducer,
  restoreDeck,
  promotedKeyAfterRemoval,
  swipeDecision,
  shouldClaimHorizontalDrag,
  parseViewMode,
  SWIPE_THRESHOLD,
  CLAIM_DISTANCE,
  VIEW_MODE_KEY,
  type DeckState,
  type VocabViewMode,
} from '../deckLogic';

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

  it('leaves ambiguous diagonals to the ScrollView', () => {
    // 15 is not > 12 * 1.5, so the scroll keeps the gesture.
    expect(shouldClaimHorizontalDrag(15, 12)).toBe(false);
  });

  it('ignores sub-threshold horizontal jitter', () => {
    expect(shouldClaimHorizontalDrag(CLAIM_DISTANCE, 0)).toBe(false);
    expect(shouldClaimHorizontalDrag(CLAIM_DISTANCE + 1, 0)).toBe(true);
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
