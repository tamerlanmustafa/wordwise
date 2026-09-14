/**
 * What the sign-up form checks before it asks the server.
 *
 * The screen used to check only that the boxes were non-empty, so a mistyped
 * email and a five-character password both went to the API — and came back as
 * a 422 the screen rendered as `[object Object]`.
 *
 * The two halves of that are fixed separately and both matter: `apiError`
 * makes the server's answer readable when it does arrive, and this makes the
 * cheap cases not cost a round trip (~173ms of bcrypt on a password the server
 * is about to reject).
 */

import { credentialProblem, emailLooksValid, PASSWORD_MIN } from '../credentialForm';

const t = (key: string) => key;
const ok = { email: 'a@b.com', password: 'longenough', username: 'movielover' };

describe('emailLooksValid', () => {
  it('accepts ordinary addresses', () => {
    expect(emailLooksValid('someone@example.com')).toBe(true);
    expect(emailLooksValid('  someone@example.co.uk  ')).toBe(true);
    expect(emailLooksValid('first.last+tag@example.com')).toBe(true);
  });

  it('rejects the mistake people actually make', () => {
    // A missing "@" is what produced the `[object Object]` on device.
    expect(emailLooksValid('verifybot')).toBe(false);
    expect(emailLooksValid('someone@')).toBe(false);
    expect(emailLooksValid('someone@example')).toBe(false);
    expect(emailLooksValid('')).toBe(false);
  });

  it('stays permissive rather than clever', () => {
    // Deliberately not RFC 5322. The server is the authority; an over-strict
    // client regex that rejects a valid address is worse than a round trip,
    // because the user has no way to argue with it.
    expect(emailLooksValid("o'brien@example.com")).toBe(true);
    expect(emailLooksValid('用户@example.com')).toBe(true);
  });
});

describe('credentialProblem', () => {
  it('is null for a valid signup', () => {
    expect(credentialProblem(ok, t)).toBeNull();
  });

  it('catches a malformed email', () => {
    expect(credentialProblem({ ...ok, email: 'verifybot' }, t)).toBe('auth:error.emailInvalid');
  });

  it('catches a short password', () => {
    expect(credentialProblem({ ...ok, password: 'short' }, t)).toBe(
      'auth:error.passwordTooShort',
    );
    expect(credentialProblem({ ...ok, password: 'x'.repeat(PASSWORD_MIN - 1) }, t)).toBe(
      'auth:error.passwordTooShort',
    );
    expect(credentialProblem({ ...ok, password: 'x'.repeat(PASSWORD_MIN) }, t)).toBeNull();
  });

  it('counts the password cap in bytes, not characters', () => {
    // bcrypt truncates past 72 *bytes*, so a 25-character password in a
    // three-byte script is over the limit while a 72-character ASCII one is
    // not. Measuring in characters would accept a password whose tail never
    // participates in the hash — it would silently become a shorter password.
    expect(credentialProblem({ ...ok, password: 'a'.repeat(72) }, t)).toBeNull();
    expect(credentialProblem({ ...ok, password: '密'.repeat(24) }, t)).toBeNull(); // 72 bytes
    expect(credentialProblem({ ...ok, password: '密'.repeat(25) }, t)).toBe(
      'auth:error.passwordTooLong',
    ); // 75 bytes
  });

  it('catches a bad username with the same rule onboarding uses', () => {
    expect(credentialProblem({ ...ok, username: 'a' }, t)).toBe('auth:error.usernameTooShort');
    expect(credentialProblem({ ...ok, username: 'john smith' }, t)).toBe(
      'auth:error.usernameNoSpaces',
    );
  });

  it('reports the field nearest the top of the form first', () => {
    // All three are wrong here. Pointing at the password while the email above
    // it is also broken makes the form feel like it is moving the goalposts.
    expect(credentialProblem({ email: 'nope', password: 'x', username: 'a' }, t)).toBe(
      'auth:error.emailInvalid',
    );
  });
});
