/**
 * credentialForm — what the sign-up form checks before it asks the server.
 *
 * The screen used to check only that the three boxes were non-empty, so a
 * mistyped email and a five-character password both went to the API and came
 * back as a 422 — which the screen then rendered as `[object Object]`. That is
 * fixed at the source in `services/apiError`, but the better answer for a rule
 * this cheap is not to spend the round trip: the server costs ~173ms of bcrypt
 * on a password it is about to reject.
 *
 * ## These are a convenience, never the guarantee
 *
 * The server enforces all three independently (`schemas/user.py`). A client
 * check that is *also* the only check is the mistake this audit found in the
 * username rules — onboarding validated, Settings did not, the schema did not.
 * So these exist to make the form feel immediate, and nothing depends on them
 * having run.
 *
 * ## Sign-in is deliberately not validated
 *
 * Only sign-UP calls this. Rejecting a sign-in locally would lock out an
 * existing account whose password predates today's minimum — the rules have
 * changed before and will again, and the server is the only thing that knows
 * which ones that account was created under.
 */

import { USERNAME_MAX, USERNAME_MIN, usernameProblem } from '../../utils/username';

/** Mirrors `UserCreate.validate_password`: 8 characters, 72 bytes. */
export const PASSWORD_MIN = 8;

export interface Credentials {
  email: string;
  password: string;
  username: string;
}

/** Minimal, deliberately permissive: something, an @, something with a dot. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailLooksValid(raw: string): boolean {
  return EMAIL_SHAPE.test(raw.trim());
}

/**
 * The first problem with a sign-up, in the user's language, or null.
 *
 * Ordered the way the form reads top to bottom, so the message points at the
 * field nearest the top that needs attention rather than at whichever rule
 * happened to be checked first.
 */
export function credentialProblem(
  { email, password, username }: Credentials,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string | null {
  if (!emailLooksValid(email)) return t('auth:error.emailInvalid');

  const nameProblem = usernameProblem(username, t);
  if (nameProblem) return nameProblem;

  if (password.length < PASSWORD_MIN) {
    return t('auth:error.passwordTooShort', { count: PASSWORD_MIN });
  }
  // bcrypt silently truncates past 72 bytes, so the server caps it there.
  // Counted in bytes, not characters — an emoji password hits this far sooner
  // than its length suggests.
  if (new TextEncoder().encode(password).length > 72) {
    return t('auth:error.passwordTooLong');
  }
  return null;
}

export { USERNAME_MAX, USERNAME_MIN };
