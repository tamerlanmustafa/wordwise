/**
 * connectionFailure — what to say when a screen could not load, as a pure map.
 *
 * The sibling of `movies/movieLoadFailure`, and deliberately the same shape:
 * a record from a failure kind to the icon, tone, copy keys and — the
 * load-bearing field — whether Retry is honest.
 *
 * ## Why each kind gets its own sentence
 *
 * "Something went wrong. Please try again." is what the app said for all of
 * them, and it is the least useful true statement available. The reader
 * already knows something went wrong; what they cannot tell is whether it is
 * theirs to fix. Sending someone to check their wifi while our API is down
 * wastes their time and blames them for it; saying "our end" while they are in
 * a lift leaves them waiting for a fix that will never come.
 *
 * No React here, so the branch is testable — the mobile suite is logic-only by
 * policy, and a decision made inside JSX is a decision nothing can check.
 */

// Type-only, so nothing native is pulled into a module the logic-only jest
// setup has to load.
import type { Ionicons } from '@expo/vector-icons';
import type { ConnectionFailure } from '../../services/connection';
import type { EmptyStateTone } from './EmptyState';

export interface ConnectionFailureCopy {
  icon: keyof typeof Ionicons.glyphMap;
  tone: EmptyStateTone;
  titleKey: string;
  bodyKey: string;
  /**
   * Whether to offer Retry.
   *
   * True for all three today, and kept as a field rather than assumed: these
   * are the failures where trying again is a real suggestion, and the moment
   * one is added that is not — an unsupported client, a region block — the
   * button has to be able to disappear. `movieLoadFailure` learned this the
   * expensive way with a Retry that could only ever return the same screen.
   */
  retryable: boolean;
}

const COPY: Record<ConnectionFailure, ConnectionFailureCopy> = {
  offline: {
    icon: 'cloud-offline-outline',
    // Not `error`. Being offline is a state of the world, not a fault, and a
    // red ring says something broke.
    tone: 'neutral',
    titleKey: 'common:connection.offlineTitle',
    bodyKey: 'common:connection.offlineBody',
    retryable: true,
  },
  server: {
    icon: 'alert-circle-outline',
    tone: 'error',
    titleKey: 'common:connection.serverTitle',
    bodyKey: 'common:connection.serverBody',
    retryable: true,
  },
  unknown: {
    // The honest fallback for a failure we could not classify — which includes
    // the day React Native changes the wording this detection reads. Generic
    // on purpose: a confident wrong answer is worse than a vague right one.
    icon: 'refresh-outline',
    tone: 'neutral',
    titleKey: 'common:connection.unknownTitle',
    bodyKey: 'common:connection.unknownBody',
    retryable: true,
  },
};

export function connectionFailureCopy(failure: ConnectionFailure): ConnectionFailureCopy {
  return COPY[failure];
}
