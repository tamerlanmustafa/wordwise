/**
 * authUser — one reader for the user object every sign-in path returns.
 *
 * ## The bug this exists to prevent
 *
 * `LoginScreen` had three sign-in handlers and each mapped the response by
 * hand. They did not agree. The Apple handler read `data.user.native_language`;
 * the email handler forty lines below read `data.user.nativeLanguage`. The API
 * sends snake_case, so every camelCase read was `undefined` and the fallback
 * always won:
 *
 *     learning_language: data.user.learningLanguage || 'es'   // always 'es'
 *     proficiency_level: data.user.proficiencyLevel || 'B1'   // always 'B1'
 *     is_admin:          data.user.isAdmin                    // always undefined
 *
 * Measured on device: signing out and back in moved the header's level chip
 * from A1 to B1 while the server still said A1. `proficiency_level` composes
 * the Practice deck and the Explore mix, so this was not cosmetic.
 *
 * The fallbacks are the part worth naming. `|| 'es'` does not mean "we don't
 * know"; it means the app asserts Spanish. A default that is indistinguishable
 * from an answer turns a missing field into a confident wrong one, which is
 * why this maps `null` through instead of inventing values.
 *
 * ## Why one function
 *
 * Three hand-written mappings of one payload is the same disease the backend
 * had with `UserInfo`: each is a list that goes stale on its own schedule, and
 * the one nobody exercises is the one that rots. `onboarding_completed` was
 * absent from all three — which is why an onboarded account, signing back in,
 * was sent through the placement quiz again.
 */

import type { User } from '../../types';

/** The user as every auth endpoint now sends it: snake_case, fully populated. */
export interface AuthUserPayload {
  id: number;
  email: string;
  username: string;
  [key: string]: unknown;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Map an auth response's `user` into the app's `User`.
 *
 * Deliberately total: every optional field the server sends is carried, so
 * adding one to `UserResponse` does not require remembering this file. The
 * three that broke things are called out because each cost a visible bug.
 */
export function mapAuthUser(raw: AuthUserPayload): User {
  return {
    id: raw.id,
    email: raw.email,
    username: raw.username,
    profile_picture_url: str(raw.profile_picture_url),
    native_language: str(raw.native_language),
    learning_language: str(raw.learning_language),
    // No `|| 'B1'`. An absent level means the server did not say, and the
    // surfaces that read it already know how to handle null; claiming B1 sent
    // A1 users a B1 deck.
    proficiency_level: str(raw.proficiency_level),
    default_tab: raw.default_tab === 'books' ? 'books' : 'movies',
    is_admin: raw.is_admin === true,
    language_preference: str(raw.language_preference),
    timezone: str(raw.timezone),
    // The flag that decides whether the first-run flow replays. Absent from
    // every hand-written mapping this replaces, so signing back in always
    // looked like a fresh install.
    onboarding_completed: raw.onboarding_completed === true,
    feed_level_mix:
      raw.feed_level_mix && typeof raw.feed_level_mix === 'object'
        ? (raw.feed_level_mix as Record<string, number>)
        : null,
    // The one that costs money if it is wrong: a missing entitlement reads as
    // the free tier, so dropping it turns a subscriber into a free user until
    // the next cold start.
    entitlements: (raw.entitlements as User['entitlements']) ?? undefined,
  };
}

/**
 * Pull the token pair out of an auth response.
 *
 * The password routes return `token`, the OAuth routes return `access_token`.
 * That difference is real and predates this; naming it here keeps the `||`
 * out of three call sites.
 */
export function readAuthTokens(data: {
  token?: unknown;
  access_token?: unknown;
  refresh_token?: unknown;
}): { access: string; refresh: string } | null {
  const access = str(data.token) ?? str(data.access_token);
  const refresh = str(data.refresh_token);
  if (!access || !refresh) return null;
  return { access, refresh };
}
