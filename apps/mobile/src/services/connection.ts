/**
 * connection — telling "your phone has no network" apart from "our server
 * broke", as a pure decision.
 *
 * Every screen that loads something used to collapse both into one boolean and
 * show the same sentence, which is wrong in the way that matters: the two
 * failures ask completely different things of the reader. One is theirs to fix
 * in five seconds by walking to a window; the other is ours, and telling them
 * to check their connection while our API is down sends them to reset a router
 * that was never the problem.
 *
 * ## How the difference is detected
 *
 * `fetch` rejects only when the request never completed — DNS failure, no
 * route, connection dropped mid-flight, or an abort. React Native throws a
 * `TypeError` with the message "Network request failed" for all of those.
 * Anything that *resolves* reached a server, even a 500, so the status code is
 * what classifies it from there.
 *
 * The string match is unavoidable and worth naming as a risk: it is RN's
 * wording, not a standard, and a platform update could change it. That is why
 * `unknown` exists as a third answer with retryable copy — a misclassification
 * degrades to a generic "try again" rather than to a confident lie.
 *
 * No React and no imports from the app: the mobile suite is logic-only by
 * policy, and this has to be callable from stores, services and components
 * alike. Same shape as `movies/movieLoadFailure`.
 */

/** What went wrong, from the reader's point of view. */
export type ConnectionFailure = 'offline' | 'server' | 'unknown';

/**
 * How long a load may run before the app admits it is slow.
 *
 * Six seconds, not two: a slow-connection notice that appears on every
 * ordinary cold start is noise, and noise is how a warning stops being read.
 * This is well past the p99 of a healthy request and comfortably short of the
 * point where a person decides the app is broken.
 */
export const SLOW_AFTER_MS = 6000;

/** True when the request never reached a server. */
export function isOfflineError(err: unknown): boolean {
  if (err == null) return false;
  // `AbortError` is our own timeout firing, which is indistinguishable from a
  // dead connection as far as the reader is concerned — both mean "nothing
  // came back", and both are fixed by trying again with a better signal.
  const name = (err as { name?: string }).name;
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  if (!(err instanceof TypeError)) return false;
  const msg = String((err as Error).message || '').toLowerCase();
  return (
    msg.includes('network request failed') ||
    msg.includes('failed to fetch') ||
    // Firefox/undici say "NetworkError when attempting to fetch", with no
    // space — the spaced form alone missed it.
    msg.includes('networkerror') ||
    msg.includes('network error')
  );
}

/**
 * Classify a caught error.
 *
 * `status` is the HTTP status when one was received. Pass it whenever the
 * caller has one — a thrown `Error('GET /x → 503')` carries the number in a
 * string this cannot read, and guessing from message text is how a 404 ends up
 * telling someone their wifi is off.
 */
export function classifyFailure(err: unknown, status?: number): ConnectionFailure {
  if (isOfflineError(err)) return 'offline';
  if (typeof status === 'number') {
    // 5xx is ours. 4xx is not a connection problem at all — it is a request
    // the server understood and refused, and the screens that care about those
    // (a 402 paywall, a 404 film) handle them by status long before here.
    return status >= 500 ? 'server' : 'unknown';
  }
  return 'unknown';
}

/**
 * Should a failure take over the screen, or stay out of the way?
 *
 * Full-screen only when there is nothing else to show. A cached feed is worth
 * more than a correct error message: blanking a list the reader was halfway
 * through, in order to report a background refresh they never asked for, costs
 * them their place to tell them something they cannot act on anyway.
 *
 * So a failure with data behind it belongs in a quiet inline strip, and a
 * failure with an empty screen behind it belongs in the middle of it.
 */
export function failureIsBlocking(hasData: boolean): boolean {
  return !hasData;
}
