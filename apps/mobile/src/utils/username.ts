/**
 * Username rules, shared by every form that can set one.
 *
 * ## Two things were wrong here
 *
 * **It was enforced in one place out of three.** Onboarding's `UsernameStep`
 * called this; Settings only trimmed; the server had no validator at all. So
 * the rules applied to the screen a user passes through once and not to the one
 * they can open at any time — and a `PATCH /auth/me` of `"   "`, of 300
 * characters, or of a name containing newlines was accepted and stored.
 * `schemas/user.py` now enforces the same limits, which is what makes them
 * real; this stays as the fast local answer, not as the guarantee.
 *
 * **The messages were hardcoded English** in an app that ships six locales,
 * on a screen in the first-run flow. `t` is passed in rather than imported so
 * this stays a pure function the logic suite can call directly.
 */

export const USERNAME_MIN = 2;
export const USERNAME_MAX = 30;

type Translate = (key: string, opts?: Record<string, unknown>) => string;

/**
 * Returns a user-facing problem with the (raw) username, or null if OK.
 *
 * Deliberately says nothing about which characters are allowed: names are not
 * ASCII, and the two things that actually broke rendering were length and
 * whitespace.
 */
export function usernameProblem(raw: string, t: Translate): string | null {
  const name = raw.trim();
  if (name.length < USERNAME_MIN) {
    return t('auth:error.usernameTooShort', { count: USERNAME_MIN });
  }
  if (name.length > USERNAME_MAX) {
    return t('auth:error.usernameTooLong', { count: USERNAME_MAX });
  }
  // `\s` covers tabs and newlines, not just the space bar — a name with a
  // newline in it renders as two lines in every list that shows it.
  if (/\s/.test(name)) {
    return t('auth:error.usernameNoSpaces');
  }
  return null;
}

/** Whether a draft is acceptable, without building a message for it. */
export function usernameIsValid(raw: string): boolean {
  const name = raw.trim();
  return name.length >= USERNAME_MIN && name.length <= USERNAME_MAX && !/\s/.test(name);
}
