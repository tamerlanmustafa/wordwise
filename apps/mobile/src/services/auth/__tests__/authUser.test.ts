/**
 * One reader for the sign-in payload.
 *
 * `LoginScreen` had three hand-written mappings of one response and they did
 * not agree: the Apple handler read `native_language`, the email handler forty
 * lines below read `nativeLanguage`. The API sends snake_case, so every
 * camelCase read was `undefined` and the fallback beside it always won.
 *
 * Measured on device: signing out and back in moved the header's level chip
 * from A1 to B1 while the server still said A1.
 *
 * The payload below is verbatim from `POST /auth/login` after the server fix.
 */

import { mapAuthUser, readAuthTokens } from '../authUser';

/** Verbatim `user` object from a real `POST /auth/login`. */
const PAYLOAD = {
  id: 2,
  email: 'verifybot@example.com',
  username: 'verifybot',
  language_preference: 'en',
  timezone: 'America/New_York',
  native_language: 'es',
  learning_language: 'es',
  proficiency_level: 'A1',
  default_tab: 'movies',
  is_active: true,
  is_admin: true,
  profile_picture_url: null,
  oauth_provider: 'email',
  entitlements: {
    tier: 'free',
    is_premium: true,
    is_admin: true,
    ads_eligible: false,
    subscription_expires_at: null,
  },
  onboarding_completed: true,
  feed_level_mix: null,
};

describe('the fields whose absence was visible', () => {
  it('carries entitlements', () => {
    // The expensive one. `useEffectiveEntitlements` reads a missing
    // entitlement as the free tier, so dropping this turned a paying
    // subscriber into a free user — daily cap, paywall, and a Family Plan
    // screen telling them it requires Plus.
    expect(mapAuthUser(PAYLOAD).entitlements?.is_premium).toBe(true);
  });

  it('carries onboarding_completed', () => {
    // Absent from all three hand-written mappings, so signing back in looked
    // like a fresh install and replayed the whole first-run flow.
    expect(mapAuthUser(PAYLOAD).onboarding_completed).toBe(true);
  });

  it('reads the real proficiency level rather than defaulting to B1', () => {
    expect(mapAuthUser(PAYLOAD).proficiency_level).toBe('A1');
  });

  it('reads is_admin', () => {
    expect(mapAuthUser(PAYLOAD).is_admin).toBe(true);
  });

  it('carries language_preference and timezone', () => {
    const user = mapAuthUser(PAYLOAD);
    expect(user.language_preference).toBe('en');
    expect(user.timezone).toBe('America/New_York');
  });
});

describe('a missing field stays missing', () => {
  /** An older server, or a field genuinely unset on the account. */
  const SPARSE = { id: 1, email: 'a@b.com', username: 'ab' };

  it('does not invent a proficiency level', () => {
    // The old code said `|| 'B1'`, which does not mean "we don't know" — it
    // means the app asserts B1. A default indistinguishable from an answer
    // turns a missing field into a confidently wrong one, and this one
    // composes the Practice deck.
    expect(mapAuthUser(SPARSE).proficiency_level).toBeNull();
  });

  it('does not invent a learning language', () => {
    // `|| 'es'` is why the interface turned Spanish on sign-in.
    expect(mapAuthUser(SPARSE).learning_language).toBeNull();
    expect(mapAuthUser(SPARSE).native_language).toBeNull();
  });

  it('treats an absent onboarding flag as "no opinion", not as "not onboarded"', () => {
    // False here is safe *because* App ORs it with the local flag; what must
    // not happen is this throwing or reading as `undefined` somewhere that
    // compares with ===.
    expect(mapAuthUser(SPARSE).onboarding_completed).toBe(false);
  });

  it('never claims admin by accident', () => {
    expect(mapAuthUser(SPARSE).is_admin).toBe(false);
    expect(mapAuthUser({ ...SPARSE, is_admin: 'yes' } as never).is_admin).toBe(false);
  });

  it('falls back to the movies tab for an unknown value', () => {
    expect(mapAuthUser(SPARSE).default_tab).toBe('movies');
    expect(mapAuthUser({ ...SPARSE, default_tab: 'books' }).default_tab).toBe('books');
    expect(mapAuthUser({ ...SPARSE, default_tab: 'zzz' }).default_tab).toBe('movies');
  });

  it('treats an empty string as absent', () => {
    // The server sends null, but a proxy or an older build can send "".
    expect(mapAuthUser({ ...SPARSE, proficiency_level: '' }).proficiency_level).toBeNull();
  });
});

describe('readAuthTokens', () => {
  it('accepts the password routes’ `token`', () => {
    expect(readAuthTokens({ token: 'a', refresh_token: 'b' })).toEqual({
      access: 'a',
      refresh: 'b',
    });
  });

  it('accepts the OAuth routes’ `access_token`', () => {
    // A real difference between the two route families, not a guess — this is
    // why the call sites all carried a `||`.
    expect(readAuthTokens({ access_token: 'a', refresh_token: 'b' })).toEqual({
      access: 'a',
      refresh: 'b',
    });
  });

  it('returns null when a token is missing, rather than signing in with undefined', () => {
    // Saving `undefined` as the access token produced a session that looked
    // authenticated and 401'd on every request.
    expect(readAuthTokens({ refresh_token: 'b' })).toBeNull();
    expect(readAuthTokens({ token: 'a' })).toBeNull();
    expect(readAuthTokens({})).toBeNull();
  });
});
