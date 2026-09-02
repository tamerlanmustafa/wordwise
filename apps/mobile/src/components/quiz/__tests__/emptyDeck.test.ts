/**
 * An empty Practice deck has two causes and they need opposite responses.
 *
 * `POST /srs/session/start` composes a deck, then throws away any card it
 * cannot build a translation MCQ for. When that drops *every* card the
 * response is `{ cards: [] }` — byte-identical to the response for a user
 * who genuinely has nothing due. The screen rendered a green tick and
 * "You're all caught up" for both, which meant a user whose target language
 * had a cold translation cache was told they had finished their work, sent
 * away for a day over something that often clears in minutes, and left with
 * no way to retry. The failure was invisible from the app entirely; its only
 * trace was a server log line.
 *
 * `deck_status` is the server telling the client which one happened — only
 * it can know, since only it saw the rows before the card build discarded
 * them.
 */
import { emptyDeckCopy } from '../emptyDeck';

describe('emptyDeckCopy', () => {
  it('congratulates a user who is genuinely caught up', () => {
    const copy = emptyDeckCopy('caught_up');

    expect(copy.tone).toBe('success');
    expect(copy.titleKey).toBe('quiz:review.caughtUpTitle');
    expect(copy.retry).toBe(false);
  });

  it('tells a user whose deck failed to build that it failed', () => {
    const copy = emptyDeckCopy('unavailable');

    expect(copy.titleKey).toBe('quiz:review.notReadyTitle');
    expect(copy.tone).not.toBe('success');
  });

  it('offers a retry only on the recoverable one', () => {
    // Re-running /srs/session/start on a genuinely empty queue just draws
    // the same empty queue, so a "try again" button there is a lie of a
    // different kind.
    expect(emptyDeckCopy('unavailable').retry).toBe(true);
    expect(emptyDeckCopy('caught_up').retry).toBe(false);
  });

  it('falls back to caught-up when the server sends no opinion', () => {
    // Older server builds predate the field. "No opinion" has to resolve to
    // the previous behaviour rather than accusing a healthy server of an
    // outage on every empty queue.
    expect(emptyDeckCopy(undefined).titleKey).toBe('quiz:review.caughtUpTitle');
    expect(emptyDeckCopy(null).titleKey).toBe('quiz:review.caughtUpTitle');
    expect(emptyDeckCopy('ok').titleKey).toBe('quiz:review.caughtUpTitle');
  });

  it('ignores a status it does not recognise', () => {
    // A future server value must not blank the screen.
    expect(emptyDeckCopy('something_new').titleKey).toBe('quiz:review.caughtUpTitle');
  });

  it('always names an icon, a CTA and a body', () => {
    for (const status of ['caught_up', 'unavailable', undefined]) {
      const copy = emptyDeckCopy(status);
      expect(copy.icon.length).toBeGreaterThan(0);
      expect(copy.ctaKey.length).toBeGreaterThan(0);
      expect(copy.bodyKey.length).toBeGreaterThan(0);
    }
  });
});
