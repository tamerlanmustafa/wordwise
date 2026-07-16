/**
 * Username validation shared by the onboarding UsernameStep (and any future
 * username form). Deliberately permissive — the backend only enforces
 * uniqueness — we just catch obviously broken input before a round-trip.
 */

export const USERNAME_MIN = 2;
export const USERNAME_MAX = 30;

/** Returns a user-facing problem with the (raw) username, or null if OK. */
export function usernameProblem(raw: string): string | null {
  const name = raw.trim();
  if (name.length < USERNAME_MIN) {
    return `Username must be at least ${USERNAME_MIN} characters.`;
  }
  if (name.length > USERNAME_MAX) {
    return `Username must be at most ${USERNAME_MAX} characters.`;
  }
  if (/\s/.test(name)) {
    return 'Username cannot contain spaces.';
  }
  return null;
}
