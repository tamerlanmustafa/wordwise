/**
 * Which "we can't teach this film" screen to show.
 *
 * Three failures reached one paper box printing `err.message` — usually the
 * literal words "Failed to fetch script" — under a Retry button. Two of the
 * three are permanent, so for those the button's only possible outcome is the
 * same screen again, which teaches the reader that the app is broken and that
 * pressing things does not help.
 *
 * The interesting assertion in here is not the copy. It is `retryable`.
 */

import {
  movieLoadFailureCopy,
  type MovieLoadFailure,
} from '../movieLoadFailure';

const KINDS: NonNullable<MovieLoadFailure>[] = [
  'unavailable',
  'script_too_short',
  'transient',
];

describe('movieLoadFailureCopy', () => {
  it('offers a retry only for the failure a retry can fix', () => {
    // The whole point. "No source has this film" and "the script we found is a
    // synopsis stub" are facts about the film; trying again cannot change
    // either, and a button implying otherwise is a lie that costs a
    // round-trip. A timeout is the one case where trying again is real advice.
    expect(movieLoadFailureCopy('unavailable').retryable).toBe(false);
    expect(movieLoadFailureCopy('script_too_short').retryable).toBe(false);
    expect(movieLoadFailureCopy('transient').retryable).toBe(true);
  });

  it('gives the two permanent cases different words', () => {
    // They were one string once — "Script too short or not found" — which
    // answered neither question. "We don't have this film" and "we have it and
    // cannot teach from it" are different things to be told.
    const missing = movieLoadFailureCopy('unavailable');
    const stub = movieLoadFailureCopy('script_too_short');

    expect(missing.titleKey).not.toBe(stub.titleKey);
    expect(missing.bodyKey).not.toBe(stub.bodyKey);
  });

  it('only calls the transient case an error', () => {
    // Tone drives the icon's colour. Nothing is broken when we simply do not
    // have a film, and painting that red tells the reader something failed —
    // and implies it might be their fault or their connection.
    expect(movieLoadFailureCopy('unavailable').tone).toBe('neutral');
    expect(movieLoadFailureCopy('script_too_short').tone).toBe('neutral');
    expect(movieLoadFailureCopy('transient').tone).toBe('error');
  });

  it('gives every kind a complete set of copy', () => {
    for (const kind of KINDS) {
      const copy = movieLoadFailureCopy(kind);
      expect(copy.titleKey).toMatch(/^movies:detail\./);
      expect(copy.bodyKey).toMatch(/^movies:detail\./);
      expect(copy.icon).toBeTruthy();
    }
  });

  it('names keys that exist in the bundled copy', () => {
    // A missing key renders as the key itself, which is how "movies:detail.
    // unavailableTitle" ends up on a user's screen. Cheap to catch here.
    /* eslint-disable @typescript-eslint/no-var-requires */
    const movies = require('../../../i18n/locales/en/movies.json');
    for (const kind of KINDS) {
      const copy = movieLoadFailureCopy(kind);
      const title = copy.titleKey.replace('movies:detail.', '');
      const body = copy.bodyKey.replace('movies:detail.', '');
      expect(movies.detail[title]).toBeTruthy();
      expect(movies.detail[body]).toBeTruthy();
    }
  });

  it('names the film in the unavailable title', () => {
    // "We don't have Hook yet" beats "This film is unavailable": the reader
    // searched for something specific and deserves to see that we understood
    // which film they meant.
    const movies = require('../../../i18n/locales/en/movies.json');
    const key = movieLoadFailureCopy('unavailable').titleKey.replace('movies:detail.', '');
    expect(movies.detail[key]).toContain('{{title}}');
  });

  it('says "yet", because unavailable is not permanent', () => {
    // We add sources and the worker retries, so a film that misses today can
    // land next month. Copy that closes the door would be wrong, and it is the
    // same premise `/movies/availability` is built on — derive it fresh, never
    // store it.
    const movies = require('../../../i18n/locales/en/movies.json');
    const key = movieLoadFailureCopy('unavailable').titleKey.replace('movies:detail.', '');
    expect(movies.detail[key].toLowerCase()).toContain('yet');
  });
});
