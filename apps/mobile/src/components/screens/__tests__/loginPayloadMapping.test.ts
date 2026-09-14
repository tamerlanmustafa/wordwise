/**
 * Source guard: the sign-in screen must not map the payload by hand again.
 *
 * This is the class of bug where every piece looks fine in isolation. Three
 * handlers, each with a plausible-looking object literal, one of them reading
 * `data.user.nativeLanguage` where the API sends `native_language` — and the
 * `|| 'es'` sitting right beside it makes the wrong read look like a
 * thoughtful default instead of dead code.
 *
 * Nothing at runtime catches it: the app gets a `User`, every field is
 * populated, and the values are merely wrong. It surfaced only by watching the
 * header's level chip change from A1 to B1 across a sign-out and back in.
 *
 * So the guard is structural rather than behavioural — there is one mapper,
 * and the screen calls it.
 */

import fs from 'fs';
import path from 'path';

const SCREEN = path.join(__dirname, '..', 'LoginScreen.tsx');

/**
 * Source with comments stripped. The forbidden patterns are described in the
 * prose explaining why they are forbidden, and a guard that fires on its own
 * explanation teaches people to stop writing explanations.
 */
const read = () =>
  fs
    .readFileSync(SCREEN, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the sign-in screen reads the payload through one mapper', () => {
  it('calls mapAuthUser', () => {
    expect(read()).toContain('mapAuthUser(');
  });

  it('reads no camelCase field off the response', () => {
    // The actual defect: these names do not exist on the wire, so each read
    // was `undefined` and the fallback next to it always won.
    const src = read();
    const camel = [
      'nativeLanguage',
      'learningLanguage',
      'proficiencyLevel',
      'profilePictureUrl',
      'defaultTab',
      'isAdmin',
    ].filter((k) => src.includes(`user.${k}`));
    expect(camel).toEqual([]);
  });

  it('hardcodes no language or level default', () => {
    // `|| 'es'` and `|| 'B1'` are not "we don't know" — they are the app
    // asserting Spanish and B1. Every user who signed in with email got both.
    const src = read();
    expect(src).not.toMatch(/\|\|\s*'(es|en|B1|A1)'/);
  });

  it('builds no user object literal of its own', () => {
    // `id: data.user.id` was the first line of all three mappings.
    expect(read()).not.toContain('id: data.user.id');
  });
});

describe('the sign-in screen reads errors through one reader', () => {
  it('calls readApiError', () => {
    expect(read()).toContain('readApiError(');
  });

  it('never puts a raw detail into an Error', () => {
    // `new Error(data.detail)` is what rendered "[object Object]" to users,
    // because a 422's detail is an array of objects.
    expect(read()).not.toMatch(/Error\(\s*data\.detail/);
  });
});
