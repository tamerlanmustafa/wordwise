/**
 * The `[object Object]` bug, pinned.
 *
 * FastAPI sends `detail` as a string for most errors and as an **array of
 * objects** for validation failures. Every call site assumed the string, so a
 * 422 rendered to the user as the literal text "[object Object]" — and 422 is
 * exactly what the two commonest signup mistakes produce:
 *
 *   an email with no "@"       → 422
 *   a password under 8 chars   → 422
 *
 * Both bodies below are copied from the running API, not invented. The server
 * was sending a usable sentence the whole time; the client discarded it.
 */

import { readApiError } from '../apiError';

/** Verbatim from `POST /auth/login` with `{"email": "verifybot"}`. */
const EMAIL_422 = {
  detail: [
    {
      type: 'value_error',
      loc: ['body', 'email'],
      msg: 'value is not a valid email address: An email address must have an @-sign.',
      input: 'verifybot',
      ctx: { reason: 'An email address must have an @-sign.' },
    },
  ],
};

/** Verbatim from `POST /auth/register` with a five-character password. */
const PASSWORD_422 = {
  detail: [
    {
      type: 'value_error',
      loc: ['body', 'password'],
      msg: 'Value error, Password must be at least 8 characters long',
      input: 'short',
      ctx: { error: {} },
    },
  ],
};

describe('the shape that shipped', () => {
  it('never returns something that stringifies to [object Object]', () => {
    // The regression itself, stated as the property rather than as a value.
    for (const body of [EMAIL_422, PASSWORD_422]) {
      expect(String(readApiError(body))).not.toContain('[object Object]');
    }
  });

  it('reads the reason out of a validation array', () => {
    expect(readApiError(EMAIL_422)).toContain('not a valid email address');
  });

  it('strips pydantic’s "Value error," prefix', () => {
    // An implementation detail of the validator, not something to show a
    // person — the rest of the sentence is already well written.
    expect(readApiError(PASSWORD_422)).toBe('Password must be at least 8 characters long');
  });

  it('reports every bad field at once', () => {
    // Being told about one problem, fixing it, and being told about the next
    // is what makes a signup form feel broken.
    const both = {
      detail: [
        { loc: ['body', 'email'], msg: 'bad email' },
        { loc: ['body', 'password'], msg: 'bad password' },
      ],
    };
    expect(readApiError(both)).toBe('bad email\nbad password');
  });
});

describe('the ordinary shapes', () => {
  it('passes a plain string detail through', () => {
    expect(readApiError({ detail: 'Username already taken' })).toBe('Username already taken');
  });

  it('accepts an already-extracted detail', () => {
    expect(readApiError('Incorrect email or password')).toBe('Incorrect email or password');
  });

  it('reads `message` out of a structured detail', () => {
    // The paywall's 402 carries counts alongside its prose.
    const paywall = {
      detail: { paywall: 'srs_daily_cap_reached', message: 'Come back tomorrow', previews_used: 1 },
    };
    expect(readApiError(paywall)).toBe('Come back tomorrow');
  });
});

describe('when there is nothing useful to say', () => {
  it('returns null rather than inventing copy', () => {
    // Null, not a fallback string: the caller supplies the generic message so
    // it comes out of the locale files in the user's own language.
    expect(readApiError(null)).toBeNull();
    expect(readApiError(undefined)).toBeNull();
    expect(readApiError({})).toBeNull();
    expect(readApiError({ detail: '' })).toBeNull();
    expect(readApiError({ detail: [] })).toBeNull();
  });

  it('survives a validation array with no messages', () => {
    expect(readApiError({ detail: [{ loc: ['body'] }] })).toBeNull();
  });

  it('survives a body that is not shaped like an error at all', () => {
    expect(readApiError({ detail: 42 })).toBeNull();
    expect(readApiError([1, 2, 3])).toBeNull();
  });
});
