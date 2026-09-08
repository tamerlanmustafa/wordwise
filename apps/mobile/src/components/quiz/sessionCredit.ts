/**
 * sessionCredit — is this deck today's practice, or extra?
 *
 * Two things reach the same review screen and are not the same activity:
 *
 *   • The **Practice tab** — one lesson a day, drawn for you, the thing the
 *     streak counts and the stair tiles number. Finishing one is the habit.
 *   • A **list** — words the user gathered themselves and chose to drill
 *     again, from the Lists tab's gold button. Practising one is *more*
 *     practice, on the user's own initiative, at a moment of their choosing.
 *
 * Everything the completion path writes is one-per-day — the streak, the
 * daily-goal ring, the Practice cursor, the chest — so letting a list write
 * them broke the day in both directions at once. A three-word list could
 * stand in for the lesson, which is exactly the hollow number a streak exists
 * against; and having stood in for it, it *spent* the day, so the real
 * Practice lesson an hour later arrived to an already-claimed chest and a
 * cursor that had already moved.
 *
 * So the split is at the session, not the card. Per-card `POST /srs/review`
 * stays kind-blind on purpose: a word answered correctly should advance its
 * Leitner box wherever it was answered, because that is a fact about the word
 * rather than about the user's day. What a list must not touch is anything
 * counted per day.
 *
 * A separate module from `ReviewScreen.tsx` for the usual reason (see
 * `wordCardText`): the screen imports native modules jest cannot load, so a
 * predicate exported from it could not be tested. It also has one caller too
 * many to live inline — the credit gate and the "Next lesson" loop are the
 * same question, and the bug this fixes is what happens when one place
 * answers it and another forgets to ask.
 *
 * The server asks the same question independently
 * (`session_kinds.counts_toward_streak`) and is the authority: this predicate
 * only decides what the *device* does optimistically, and an installed build
 * that has never heard of it is still handled there.
 */

import type { SessionKind } from '../../services/api';

/**
 * Whether this deck is a Practice-tab lesson.
 *
 * `undefined` is the Practice tab: the tab passes no kind and takes the
 * server's default, so an absent kind has always meant `practice`.
 *
 * `listId` is checked as well as the kind, and not redundantly. The two
 * arrive from different places — the kind is echoed by the server inside the
 * started session, the list id is what the Lists tab navigated with — and a
 * session that carries a list id is a list deck whatever its kind says. The
 * looser of two signals should not be the one that decides whether the streak
 * moves.
 */
export function isPracticeSession(kind?: SessionKind, listId?: number): boolean {
  return (kind ?? 'practice') === 'practice' && listId == null;
}
