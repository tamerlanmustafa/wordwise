/**
 * The rail's list label reports *state*, not a count, until there is more
 * than one — "1 list" reads like a counter and tells the user less than
 * "In list" does.
 */
import { listLabel } from '../ActionRail';

describe('listLabel', () => {
  it('invites the action when the word is in no list', () => {
    expect(listLabel(0)).toBe('List');
  });

  it('reports state rather than a count for a single list', () => {
    expect(listLabel(1)).toBe('In list');
  });

  it('counts once there is more than one', () => {
    expect(listLabel(2)).toBe('2 lists');
    expect(listLabel(7)).toBe('7 lists');
  });

  it('treats a negative count as none rather than rendering it', () => {
    expect(listLabel(-1)).toBe('List');
  });
});
