/**
 * The card count sits still.
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
 * The second thing `planDeck` returns is the pool prefix it had to walk. That
 * is what the sentence batch fetches, and it has to be the walk rather than
 * the cards: a replacement word nobody asked the backend about looks
 * permanently pending, so it would sit on a skeleton for ever.
 */

import { DECK_TARGET_CARDS, planDeck } from '../deckLogic';

const pool = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ word: `w${i}`, frequency_rank: n - i }));

/** Usability oracle: every word is fine except the named ones. */
const allBut = (...bad: string[]) => (w: string) => !bad.includes(w);
const anything = () => true;

describe('planDeck', () => {
  it('takes the target when the pool can supply it', () => {
    const { cards } = planDeck(pool(200), anything, 60);
    expect(cards).toHaveLength(60);
    expect(cards[0].word).toBe('w0');
    expect(cards[59].word).toBe('w59');
  });

  it('holds the target by reaching further into the pool for replacements', () => {
    // The whole point. Five unusable words in the first sixty means the deck
    // goes to w64, not that it shows 55 cards.
    const { cards } = planDeck(pool(200), allBut('w2', 'w7', 'w11', 'w30', 'w58'), 60);
    expect(cards).toHaveLength(60);
    expect(cards.map((c) => c.word)).not.toContain('w2');
    expect(cards.map((c) => c.word)).toContain('w64');
  });

  it('keeps the pool order', () => {
    // The pool is sorted rarest-first, and the bookmark is written against
    // positions in it. Reordering would move the reader without asking.
    const { cards } = planDeck(pool(20), allBut('w3'), 5);
    expect(cards.map((c) => c.word)).toEqual(['w0', 'w1', 'w2', 'w4', 'w5']);
  });

  it('reports the prefix it walked, rejects included', () => {
    // `scanned` is what the sentence batch must cover. Fetching only `cards`
    // would leave every replacement unasked-about, and an unasked word reads
    // as "still loading" for ever.
    const { cards, scanned } = planDeck(pool(20), allBut('w1', 'w2'), 3);
    expect(cards.map((c) => c.word)).toEqual(['w0', 'w3', 'w4']);
    expect(scanned.map((c) => c.word)).toEqual(['w0', 'w1', 'w2', 'w3', 'w4']);
  });

  it('does not walk past what it needed', () => {
    // Every extra word in `scanned` is a backend request, and on a
    // SentenceBank miss that request is an LLM generation with a real cost.
    // Scanning the whole pool to fill 60 cards would pay for hundreds.
    const { scanned } = planDeck(pool(500), anything, 60);
    expect(scanned).toHaveLength(60);
  });

  it('is optimistic about words nobody has heard back about', () => {
    // A deck that admitted a word only once its sentence was confirmed would
    // start at zero cards and fill in visibly — the same flicker, upside down.
    const seen = new Set(['w0', 'w1']);
    const { cards } = planDeck(pool(50), (w) => seen.has(w) || true, 10);
    expect(cards).toHaveLength(10);
  });

  it('gives back what it has when the pool is too small', () => {
    // Honest short deck rather than a padded one.
    expect(planDeck(pool(12), anything, 60).cards).toHaveLength(12);
    expect(planDeck(pool(12), () => false, 60).cards).toHaveLength(0);
    expect(planDeck([], anything, 60).cards).toEqual([]);
  });

  it('walks the whole pool before giving up', () => {
    // A short pool must be exhausted, not abandoned at the target.
    const { scanned } = planDeck(pool(12), () => false, 60);
    expect(scanned).toHaveLength(12);
  });

  it('defaults to the shared target', () => {
    expect(DECK_TARGET_CARDS).toBeGreaterThanOrEqual(50);
    expect(DECK_TARGET_CARDS).toBeLessThanOrEqual(60);
    expect(planDeck(pool(200), anything).cards).toHaveLength(DECK_TARGET_CARDS);
  });

  it('holds the count steady as answers arrive, which is the bug it fixes', () => {
    // Replays the sequence the reader complained about: a full pool, then
    // misses landing one chunk at a time. The count must not move.
    const p = pool(200);
    const bad: string[] = [];
    const counts = [planDeck(p, allBut(...bad), 60).cards.length];
    for (const w of ['w4', 'w9', 'w17', 'w33', 'w41', 'w52', 'w58']) {
      bad.push(w);
      counts.push(planDeck(p, allBut(...bad), 60).cards.length);
    }
    expect(new Set(counts)).toEqual(new Set([60]));
  });
});
