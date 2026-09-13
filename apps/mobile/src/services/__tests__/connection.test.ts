/**
 * Telling "your phone has no network" apart from "our server broke".
 *
 * Every screen used to collapse both into one boolean and print one sentence,
 * which is the least useful true statement available: the reader already knows
 * something went wrong, and what they cannot tell is whether it is theirs to
 * fix. Sending someone to reset a router while our API is down wastes their
 * evening and blames them for it.
 *
 * The classification rests on a string match against React Native's wording,
 * which is a real risk and the reason `unknown` exists — a misclassification
 * has to degrade to a vague "try again" rather than to a confident lie. The
 * tests below pin both halves: the messages RN actually throws, and the
 * fallback for everything else.
 */

import {
  SLOW_AFTER_MS,
  classifyFailure,
  failureIsBlocking,
  isOfflineError,
} from '../connection';

describe('isOfflineError', () => {
  it('recognises the message React Native throws', () => {
    // The exact string from RN's networking module. If this ever stops
    // matching, every dead-connection screen silently becomes "try again".
    expect(isOfflineError(new TypeError('Network request failed'))).toBe(true);
  });

  it('is case-insensitive and tolerates the web wording', () => {
    // The same failure is worded differently by different engines, and this
    // code also runs under jest's fetch.
    expect(isOfflineError(new TypeError('network request failed'))).toBe(true);
    expect(isOfflineError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isOfflineError(new TypeError('NetworkError when attempting to fetch'))).toBe(true);
  });

  it('treats an abort as offline', () => {
    // Our own timeout firing is indistinguishable from a dead connection as
    // far as the reader is concerned: nothing came back, and a better signal
    // fixes both.
    const abort = new Error('Aborted');
    abort.name = 'AbortError';
    expect(isOfflineError(abort)).toBe(true);
  });

  it('does not claim offline for an ordinary error', () => {
    // The dangerous direction. A parse failure or a thrown status string is
    // not a network problem, and saying so sends the reader to fix their wifi.
    expect(isOfflineError(new Error('GET /srs/feed → 500'))).toBe(false);
    expect(isOfflineError(new TypeError('undefined is not a function'))).toBe(false);
    expect(isOfflineError(null)).toBe(false);
    expect(isOfflineError(undefined)).toBe(false);
    expect(isOfflineError('Network request failed')).toBe(false);
  });
});

describe('classifyFailure', () => {
  it('calls a dead connection offline', () => {
    expect(classifyFailure(new TypeError('Network request failed'))).toBe('offline');
  });

  it('calls a 5xx ours', () => {
    expect(classifyFailure(new Error('boom'), 500)).toBe('server');
    expect(classifyFailure(new Error('boom'), 503)).toBe('server');
  });

  it('does not call a 4xx a connection problem', () => {
    // A 404 or a 402 is a request the server understood and refused. The
    // screens that care about those handle them by status long before here,
    // and telling the reader their connection is down would be nonsense.
    expect(classifyFailure(new Error('nope'), 404)).toBe('unknown');
    expect(classifyFailure(new Error('nope'), 402)).toBe('unknown');
  });

  it('prefers offline over a status when the request never landed', () => {
    // A caller passing a stale status alongside a genuine network throw must
    // not get "our server broke" — nothing reached our server.
    expect(classifyFailure(new TypeError('Network request failed'), 500)).toBe('offline');
  });

  it('falls back to unknown with nothing to go on', () => {
    expect(classifyFailure(new Error('something'))).toBe('unknown');
    expect(classifyFailure(undefined)).toBe('unknown');
  });
});

describe('failureIsBlocking', () => {
  it('takes over an empty screen', () => {
    expect(failureIsBlocking(false)).toBe(true);
  });

  it('stays out of the way when there is content', () => {
    // Blanking a list the reader is halfway through, to report a background
    // refresh they never asked for, costs them their place to tell them
    // something they cannot act on.
    expect(failureIsBlocking(true)).toBe(false);
  });
});

describe('the slow threshold', () => {
  it('is long enough not to fire on an ordinary load', () => {
    // A notice that appears on every cold start is noise, and noise is how a
    // warning stops being read.
    expect(SLOW_AFTER_MS).toBeGreaterThanOrEqual(4000);
  });

  it('is short enough to beat the reader deciding the app is broken', () => {
    expect(SLOW_AFTER_MS).toBeLessThanOrEqual(10000);
  });
});
