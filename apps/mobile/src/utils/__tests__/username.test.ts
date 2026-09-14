/**
 * Username rules on the client.
 *
 * Two things changed here. The rules are no longer the *only* enforcement —
 * `schemas/user.py` now checks the same limits, which is what makes them real,
 * because this file was called from onboarding and nowhere else while Settings
 * and the server both accepted anything. And the messages come from i18n
 * rather than being hardcoded English on a first-run screen in a six-locale
 * app.
 *
 * `t` is injected, so these assert on the KEY rather than on prose — the
 * wording is the locale files' business and pinning it here would make every
 * copy edit a test failure.
 */

import { USERNAME_MAX, USERNAME_MIN, usernameIsValid, usernameProblem } from '../username';

/** Returns the key, so a test reads as "which rule fired". */
const t = (key: string) => key;

describe('usernameProblem', () => {
  it('accepts an ordinary username', () => {
    expect(usernameProblem('movielover', t)).toBeNull();
    expect(usernameProblem('jane_doe42', t)).toBeNull();
    expect(usernameProblem('a.b-c', t)).toBeNull();
  });

  it('accepts non-ASCII names', () => {
    // The rule must not quietly become "English names only" — no character
    // class is checked, only length and whitespace.
    expect(usernameProblem('Ünal', t)).toBeNull();
    expect(usernameProblem('小明', t)).toBeNull();
    expect(usernameProblem('Аня_2', t)).toBeNull();
  });

  it('ignores surrounding whitespace', () => {
    expect(usernameProblem('  movielover  ', t)).toBeNull();
  });

  it('rejects a name that is too short', () => {
    expect(usernameProblem('a', t)).toBe('auth:error.usernameTooShort');
    expect(usernameProblem('  a  ', t)).toBe('auth:error.usernameTooShort');
    expect(usernameProblem('', t)).toBe('auth:error.usernameTooShort');
  });

  it('rejects a whitespace-only name as too short, not as spaces', () => {
    // It trims to empty, so length is the honest complaint. This is the value
    // the API accepted and stored: truthy, so the profile rendered a blank
    // name rather than falling back to a placeholder.
    expect(usernameProblem('   ', t)).toBe('auth:error.usernameTooShort');
  });

  it('rejects a name that is too long', () => {
    expect(usernameProblem('x'.repeat(USERNAME_MAX + 1), t)).toBe('auth:error.usernameTooLong');
  });

  it('rejects interior whitespace of any kind', () => {
    expect(usernameProblem('john smith', t)).toBe('auth:error.usernameNoSpaces');
    // Tabs and newlines too — a name with a newline renders as two lines in
    // every list that shows it, and the server accepted one.
    expect(usernameProblem('john\tsmith', t)).toBe('auth:error.usernameNoSpaces');
    expect(usernameProblem('a\nb', t)).toBe('auth:error.usernameNoSpaces');
  });

  it('is inclusive at both boundaries', () => {
    expect(usernameProblem('x'.repeat(USERNAME_MIN), t)).toBeNull();
    expect(usernameProblem('x'.repeat(USERNAME_MAX), t)).toBeNull();
  });
});

describe('usernameIsValid', () => {
  it('agrees with usernameProblem', () => {
    // Two functions, one rule: the boolean is what the Save button reads and
    // the message is what the error line reads, and they must never disagree
    // about whether a name is acceptable.
    for (const name of ['movielover', 'a', '   ', 'john smith', 'x'.repeat(40), 'Ünal']) {
      expect(usernameIsValid(name)).toBe(usernameProblem(name, t) === null);
    }
  });
});
