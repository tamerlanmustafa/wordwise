import { formatAppleFullName } from '../appleName';

describe('formatAppleFullName', () => {
  it('joins given + family name', () => {
    expect(formatAppleFullName('Jane', 'Appleseed')).toBe('Jane Appleseed');
  });

  it('handles a single present part', () => {
    expect(formatAppleFullName('Jane', null)).toBe('Jane');
    expect(formatAppleFullName(undefined, 'Appleseed')).toBe('Appleseed');
  });

  it('returns null (not empty string) on repeat logins with no name', () => {
    expect(formatAppleFullName(null, null)).toBeNull();
    expect(formatAppleFullName(undefined, undefined)).toBeNull();
    expect(formatAppleFullName('', '')).toBeNull();
  });
});
