/**
 * Which decks count as today's practice.
 *
 * The Practice tab and a list's gold button land on the same review screen,
 * and finishing either one used to run the same completion path: bump the
 * streak, advance the stair-tile cursor, claim the day's chest. Every one of
 * those is one-per-day, which made the entanglement break in both directions
 * at once — a three-word list could stand in for the lesson, and having stood
 * in for it, it *spent* the day, so the real Practice lesson an hour later
 * found the chest already claimed and the cursor already moved.
 *
 * This predicate is the fix, and it is deliberately one predicate rather than
 * a check at each site: the bug was never that the condition was wrong, it was
 * that only some of the call sites were asking it.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { isPracticeSession } from '../sessionCredit';

describe('isPracticeSession', () => {
  it('credits the Practice tab', () => {
    expect(isPracticeSession('practice')).toBe(true);
  });

  it('credits a deck that names no kind at all', () => {
    // The Practice tab passes nothing and takes the server's default, so an
    // absent kind has always meant `practice`. Reading it as uncredited would
    // silently stop the streak for the app's main loop.
    expect(isPracticeSession(undefined)).toBe(true);
    expect(isPracticeSession()).toBe(true);
  });

  it('does not credit either list kind', () => {
    expect(isPracticeSession('list_words', 4)).toBe(false);
    expect(isPracticeSession('list_films', 4)).toBe(false);
  });

  it('does not credit a list whose kind went missing', () => {
    // `SrsSessionStart.kind` is optional on the wire, so a list session can
    // arrive carrying only its id. The id is the signal that cannot be lost,
    // and it is the one that has to win: claiming this as practice would hand
    // a list the streak, which is the whole defect.
    expect(isPracticeSession(undefined, 4)).toBe(false);
  });

  it('does not credit list id 0', () => {
    // `== null` rather than a truthiness check, because a falsy-but-present id
    // is still a list. Postgres ids start at 1 so this is defence rather than
    // a live case — but it is the exact shape of bug that survives review.
    expect(isPracticeSession(undefined, 0)).toBe(false);
  });

  it('is the same answer for "does the path continue" and "does the day advance"', () => {
    // ReviewScreen uses this one value for both the "Next lesson" loop and the
    // streak gate. They were always the same question; the bug was that only
    // the first one was asking it.
    const cases: Array<[Parameters<typeof isPracticeSession>, boolean]> = [
      [['practice', undefined], true],
      [['list_words', 7], false],
      [['list_films', 7], false],
    ];
    for (const [args, expected] of cases) {
      expect(isPracticeSession(...args)).toBe(expected);
    }
  });
});

/**
 * Where the predicate is actually applied.
 *
 * The predicate being right is the easy half. The defect was that the
 * once-a-day writes sat unguarded in a completion handler both kinds of deck
 * run through, so the thing worth pinning is not the boolean — it is that each
 * of those writes is *inside* the gate. A future edit that lifts one line out
 * of the `if` for readability restores the bug exactly, and nothing else in
 * this suite would notice: the screen cannot be render-tested here (see
 * CLAUDE.md, "Mobile test conventions"), so the source is the only place left
 * to assert it.
 */
describe('the once-a-day writes are inside the gate', () => {
  const source = readFileSync(
    join(__dirname, '..', '..', 'ReviewScreen.tsx'),
    'utf8',
  );

  /** The body of `if (isPracticePath) { … }`, by brace balance. */
  function gatedBlock(): string {
    const open = source.indexOf('if (isPracticePath) {');
    expect(open).toBeGreaterThan(-1);
    let depth = 0;
    let i = source.indexOf('{', open);
    const start = i + 1;
    for (; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) return source.slice(start, i);
      }
    }
    throw new Error('unbalanced braces after `if (isPracticePath)`');
  }

  // Each of these moves something the user only gets once per day.
  const ONCE_A_DAY = [
    // The streak, and the daily-goal ring behind it.
    'useDailyGoalStore.getState().bump()',
    // The Practice cursor — the number engraved on the stair tiles.
    'usePracticePathStore.getState().advance()',
  ];

  it.each(ONCE_A_DAY)('%s is called only inside the gate', (call) => {
    const occurrences = source.split(call).length - 1;
    expect(occurrences).toBe(1);
    expect(gatedBlock()).toContain(call);
  });

  it('sends the kind on to the server rather than deciding alone', () => {
    // The client's gate is optimistic; the server is the authority, and it
    // cannot be one without being told which deck this was. Installed builds
    // that send nothing are handled there, not here.
    expect(source).toContain(
      "completeSession(justCorrect, total, isPracticePath ? 'practice' : kind)",
    );
  });

  it('does not overwrite the streak from the server on a list deck', () => {
    // The reply carries the account's real streak whatever the deck was, so an
    // ungated correction would put "Streak extended — day 12" on the end of a
    // list session: a true number in a false sentence.
    expect(source).toContain(
      "if (isPracticePath && typeof res.streak === 'number'",
    );
  });
});
