/**
 * Assemble the display name from an Apple credential's fullName parts.
 *
 * Apple only supplies the name on the FIRST authorization for an Apple ID —
 * repeat logins give null parts — and either part may be independently
 * missing. The backend expects `null` (not an empty string) when there's no
 * usable name, so it falls back to deriving a username from the email.
 */
export function formatAppleFullName(
  givenName?: string | null,
  familyName?: string | null,
): string | null {
  const joined = [givenName, familyName].filter(Boolean).join(' ').trim();
  return joined.length > 0 ? joined : null;
}
