/**
 * The card count sits still, and the mix is a choice.
 *
 * "CARD 3 / 60" turning into "CARD 3 / 42" a second later, then 40, then 42,
 * was not a rendering glitch — it was the deck honestly reporting a list that
 * was still being decided. The old order of operations was: take the first 60
 * words, then drop the ones whose AI-authored example sentence comes back
 * missing. Both halves of that arrive over the network, so the reader watched
 * the subtraction happen.
 *
 * A film's vocabulary at one level runs to hundreds of words. Taking the first
 * 60 USABLE words instead of the first 60 words costs nothing and pins the
 * number, because every drop has a replacement waiting behind it.
 *
 * `planDeck` also owns the mix. Bands are asked in order, each may carry a
 * ceiling, and a second pass ignores the ceilings if the deck would otherwise
 * come up short — a ceiling exists to stop one band crowding out the others,
 * and once the others are empty it has nothing left to protect.
 *
 * The second thing it returns is the pool prefix it walked. That is what the
 * sentence batch fetches, and it has to be the walk rather than the cards: a
 * replacement word nobody asked the backend about looks permanently pending,
 * so it would sit on a skeleton for ever.
 */

import { DECK_TARGET_CARDS, planDeck, type DeckBand } from '../deckLogic';

const words = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ word: `${prefix}${i}` }));
const band = <T,>(items: T[], cap?: number): DeckBand<T> => ({ items, cap });

/** Usability oracle: every word is fine except the named ones. */
const allBut = (...bad: string[]) => (w: string) => !bad.includes(w);
const anything = () => true;

describe('planDeck — filling to the target', () => {
  it('takes the target when the pool can supply it', () => {
    const { cards } = planDeck([band(words('w', 200))], anything, 60);
    expect(cards).toHaveLength(60);
    expect(cards[0].word).toBe('w0');
    expect(cards[59].word).toBe('w59');
  });

  it('holds the target by reaching further into the band for replacements', () => {
    // The whole point. Five unusable words in the first sixty means the deck
    // goes to w64, not that it shows 55 cards.
    const { cards } = planDeck(
      [band(words('w', 200))],
      allBut('w2', 'w7', 'w11', 'w30', 'w58'),
      60,
    );
    expect(cards).toHaveLength(60);
    expect(cards.map((c) => c.word)).not.toContain('w2');
    expect(cards.map((c) => c.word)).toContain('w64');
  });

  it('keeps the order it was given', () => {
    // Bands arrive pre-sorted, and the bookmark is written against positions
    // in the result. Reordering would move the reader without asking.
    const { cards } = planDeck([band(words('w', 20))], allBut('w3'), 5);
    expect(cards.map((c) => c.word)).toEqual(['w0', 'w1', 'w2', 'w4', 'w5']);
  });

  it('reports the prefix it walked, rejects included', () => {
    // `scanned` is what the sentence batch must cover. Fetching only `cards`
    // would leave every replacement unasked-about, and an unasked word reads
    // as "still loading" for ever.
    const { cards, scanned } = planDeck([band(words('w', 20))], allBut('w1', 'w2'), 3);
    expect(cards.map((c) => c.word)).toEqual(['w0', 'w3', 'w4']);
    expect(scanned.map((c) => c.word)).toEqual(['w0', 'w1', 'w2', 'w3', 'w4']);
  });

  it('does not walk past what it needed', () => {
    // Every extra word in `scanned` is a backend request, and on a
    // SentenceBank miss that request is an LLM generation with a real cost.
    expect(planDeck([band(words('w', 500))], anything, 60).scanned).toHaveLength(60);
  });

  it('is optimistic about words nobody has heard back about', () => {
    // A deck that admitted a word only once its sentence was confirmed would
    // start at zero cards and fill in visibly — the same flicker, upside down.
    expect(planDeck([band(words('w', 50))], anything, 10).cards).toHaveLength(10);
  });

  it('gives back what it has when the pool is too small', () => {
    expect(planDeck([band(words('w', 12))], anything, 60).cards).toHaveLength(12);
    expect(planDeck([band(words('w', 12))], () => false, 60).cards).toHaveLength(0);
    expect(planDeck([], anything, 60).cards).toEqual([]);
  });

  it('walks a short band to its end before giving up', () => {
    expect(planDeck([band(words('w', 12))], () => false, 60).scanned).toHaveLength(12);
  });

  it('defaults to the shared target', () => {
    expect(DECK_TARGET_CARDS).toBeGreaterThanOrEqual(50);
    expect(DECK_TARGET_CARDS).toBeLessThanOrEqual(60);
    expect(planDeck([band(words('w', 200))], anything).cards).toHaveLength(DECK_TARGET_CARDS);
  });

  it('holds the count steady as answers arrive, which is the bug it fixes', () => {
    // Replays the sequence the reader complained about: a full pool, then
    // misses landing one chunk at a time. The count must not move.
    const b = [band(words('w', 200))];
    const bad: string[] = [];
    const counts = [planDeck(b, allBut(...bad), 60).cards.length];
    for (const w of ['w4', 'w9', 'w17', 'w33', 'w41', 'w52', 'w58']) {
      bad.push(w);
      counts.push(planDeck(b, allBut(...bad), 60).cards.length);
    }
    expect(new Set(counts)).toEqual(new Set([60]));
  });
});

describe('planDeck — the mix', () => {
  it('honours a band ceiling and moves on', () => {
    const { cards } = planDeck(
      [band(words('s', 100), 7), band(words('o', 100))],
      anything,
      10,
    );
    expect(cards.filter((c) => c.word.startsWith('s'))).toHaveLength(7);
    expect(cards.filter((c) => c.word.startsWith('o'))).toHaveLength(3);
  });

  it('counts the ceiling in CARDS, not in candidates', () => {
    // The ceiling has to be applied after the usability filter or it means
    // nothing: a band capped at 7 candidates, two of which have no sentence,
    // contributes 5 cards and quietly under-delivers the mix.
    const { cards } = planDeck(
      [band(words('s', 100), 7), band(words('o', 100))],
      allBut('s0', 's3', 's5'),
      10,
    );
    expect(cards.filter((c) => c.word.startsWith('s'))).toHaveLength(7);
    expect(cards.map((c) => c.word)).not.toContain('s0');
  });

  it('takes bands in order, so the fallback ladder is a ladder', () => {
    const { cards } = planDeck(
      [band([], 42), band(words('own', 4)), band(words('below', 100))],
      anything,
      10,
    );
    expect(cards.slice(0, 4).map((c) => c.word)).toEqual(['own0', 'own1', 'own2', 'own3']);
    expect(cards.slice(4).every((c) => c.word.startsWith('below'))).toBe(true);
  });

  it('a band under its ceiling simply contributes less', () => {
    // The ceiling is never a floor. Measured across 300 scripts, a C1 reader's
    // stretch band is a median of 6 words — demanding 42 would fail every time.
    const { cards } = planDeck(
      [band(words('s', 6), 42), band(words('o', 100))],
      anything,
      60,
    );
    expect(cards).toHaveLength(60);
    expect(cards.filter((c) => c.word.startsWith('s'))).toHaveLength(6);
  });

  it('relaxes the ceilings rather than shipping a short deck', () => {
    // 90% stretch beats 34 cards. Once the other bands are exhausted the
    // ceiling has nothing left to protect.
    const { cards } = planDeck([band(words('s', 100), 20), band(words('o', 5))], anything, 60);
    expect(cards).toHaveLength(60);
    expect(cards.filter((c) => c.word.startsWith('s'))).toHaveLength(55);
  });

  it('never takes the same word twice across the two passes', () => {
    const { cards, scanned } = planDeck(
      [band(words('s', 30), 5), band(words('o', 3))],
      anything,
      60,
    );
    expect(new Set(cards.map((c) => c.word)).size).toBe(cards.length);
    // …and never asks the sentence batch about it twice either.
    expect(new Set(scanned.map((c) => c.word)).size).toBe(scanned.length);
  });
});
