import { usernameProblem, USERNAME_MAX, USERNAME_MIN } from '../username';

describe('usernameProblem', () => {
  it('accepts a normal username', () => {
    expect(usernameProblem('movielover')).toBeNull();
    expect(usernameProblem('jane_doe42')).toBeNull();
    expect(usernameProblem('a.b-c')).toBeNull();
  });

  it('trims before validating', () => {
    expect(usernameProblem('  movielover  ')).toBeNull();
  });

  it('rejects too-short names', () => {
    expect(usernameProblem('a')).toContain(`${USERNAME_MIN}`);
    expect(usernameProblem('  a  ')).toContain(`${USERNAME_MIN}`);
    expect(usernameProblem('')).toContain(`${USERNAME_MIN}`);
  });

  it('rejects too-long names', () => {
    expect(usernameProblem('x'.repeat(USERNAME_MAX + 1))).toContain(`${USERNAME_MAX}`);
    expect(usernameProblem('x'.repeat(USERNAME_MAX))).toBeNull();
  });

  it('rejects inner whitespace', () => {
    expect(usernameProblem('jane doe')).toContain('spaces');
  });
});
