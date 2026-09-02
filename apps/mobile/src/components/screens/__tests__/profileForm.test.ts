/**
 * The Settings account form had two save models and no way to tell them apart.
 *
 * Theme, daily goal, app language, translation language and every toggle on
 * the screen committed on the tap. Username, native language, learning
 * language and proficiency level did not — they sat in local state waiting for
 * a "Save changes" button parked below the translation-language chips, far
 * enough down that the button and the fields it governed were never on screen
 * together. Tap Back and the edit was gone, silently.
 *
 * The three pickers now commit on selection, which leaves username as the only
 * field Back can still destroy — free text the server can reject, so it keeps
 * an explicit save. These are the rules that drive that button and the guard.
 */
import {
  canSaveUsername,
  hasUnsavedUsername,
  normalizeUsername,
  usernameState,
} from '../profileForm';

describe('normalizeUsername', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeUsername('  tamerlan  ')).toBe('tamerlan');
  });

  it('preserves case, because the server treats names as distinct', () => {
    expect(normalizeUsername('Tamerlan')).toBe('Tamerlan');
  });

  it('leaves inner spacing alone', () => {
    expect(normalizeUsername(' film buff ')).toBe('film buff');
  });
});

describe('usernameState', () => {
  it('is unchanged when the draft matches the account', () => {
    expect(usernameState('tamerlan', 'tamerlan')).toBe('unchanged');
  });

  it('ignores whitespace-only edits', () => {
    // Tapping into the field and adding a trailing space is not a change, and
    // treating it as one would arm the Back guard over nothing.
    expect(usernameState('  tamerlan ', 'tamerlan')).toBe('unchanged');
  });

  it('is empty for a blank or whitespace draft', () => {
    expect(usernameState('', 'tamerlan')).toBe('empty');
    expect(usernameState('   ', 'tamerlan')).toBe('empty');
  });

  it('is ready for a real, different name', () => {
    expect(usernameState('cinephile', 'tamerlan')).toBe('ready');
  });

  it('treats a case-only edit as a real change', () => {
    expect(usernameState('Tamerlan', 'tamerlan')).toBe('ready');
  });

  it('is ready when the account has no username yet', () => {
    // OAuth accounts can arrive without one; the field must still be savable.
    expect(usernameState('newname', null)).toBe('ready');
    expect(usernameState('newname', undefined)).toBe('ready');
    expect(usernameState('', null)).toBe('empty');
  });
});

describe('canSaveUsername', () => {
  it('is live only for a valid, actual change', () => {
    expect(canSaveUsername('cinephile', 'tamerlan')).toBe(true);
  });

  it('stays dark when nothing changed', () => {
    // The button is hidden entirely in this state — a permanently-visible
    // Save is what made the old form look like it was doing something.
    expect(canSaveUsername('tamerlan', 'tamerlan')).toBe(false);
  });

  it('stays dark for an empty field', () => {
    expect(canSaveUsername('   ', 'tamerlan')).toBe(false);
  });
});

describe('hasUnsavedUsername — the Back guard', () => {
  it('defends a real pending edit', () => {
    expect(hasUnsavedUsername('cinephile', 'tamerlan')).toBe(true);
  });

  it('lets Back through when there is nothing to lose', () => {
    expect(hasUnsavedUsername('tamerlan', 'tamerlan')).toBe(false);
  });

  it('does not defend an emptied field', () => {
    // Clearing the box and walking away is not work worth a confirm dialog,
    // and prompting there would make Back feel broken for anyone who tapped
    // into the field by accident.
    expect(hasUnsavedUsername('', 'tamerlan')).toBe(false);
  });

  it('agrees with the Save button', () => {
    // The guard and the button must never disagree: a Back prompt for an edit
    // the user has no way to save is a trap with no exit.
    const cases: Array<[string, string | null]> = [
      ['cinephile', 'tamerlan'],
      ['tamerlan', 'tamerlan'],
      ['', 'tamerlan'],
      ['  ', null],
      ['first', null],
    ];
    for (const [draft, saved] of cases) {
      expect(hasUnsavedUsername(draft, saved)).toBe(canSaveUsername(draft, saved));
    }
  });
});
