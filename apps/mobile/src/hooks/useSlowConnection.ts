/**
 * useSlowConnection — true once a load has been running long enough to admit
 * it is slow.
 *
 * A poor connection is not a failure and cannot be detected like one: nothing
 * throws, no status arrives, the request is simply still open. The only signal
 * available on the client is elapsed time, which is why this is a timer rather
 * than anything cleverer.
 *
 * ## Why it is not just `loading && Date.now() - start > N`
 *
 * That expression is only re-evaluated when something else re-renders, so on a
 * screen with nothing else happening — which is precisely a screen waiting on
 * one slow request — it would never become true. The timer is what makes the
 * notice appear on the screens that need it most.
 *
 * The flag drops the instant loading stops, so a request that finally lands
 * takes its own warning away. Nothing else has to remember to clear it.
 */

import { useEffect, useState } from 'react';

import { SLOW_AFTER_MS } from '../services/connection';

export function useSlowConnection(loading: boolean, afterMs: number = SLOW_AFTER_MS): boolean {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!loading) {
      // Reset rather than leave it set: this hook is used on screens that load
      // repeatedly (pull to refresh, a tab returning), and a sticky flag would
      // put a slow-connection notice above a page that loaded instantly.
      setSlow(false);
      return undefined;
    }
    const id = setTimeout(() => setSlow(true), afterMs);
    // Clearing on unmount matters more than it looks: the timer holds a
    // setState on a screen the user may have already left, and on a slow
    // connection leaving is the likely outcome.
    return () => clearTimeout(id);
  }, [loading, afterMs]);

  return slow;
}
