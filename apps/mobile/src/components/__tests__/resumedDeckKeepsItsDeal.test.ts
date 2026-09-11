/**
 * A resumed deck must complete against the deal it was dealt from.
 *
 * `ReviewScreen` has two ways to end up holding cards, and only one of them
 * talks to the server:
 *
 *   1. a fresh `/srs/session/start`, which returns `session_id`;
 *   2. a deck recovered from `reviewSessionStore`, which returns early and
 *      never touches the network.
 *
 * Path 2 is the ordinary one — quit mid-deck, reopen within 24h — and it used
 * to leave `sessionIdRef` at null. The completion then arrived with no id, so
 * the server skipped all three things the id is for: the clamp on the reported
 * counts, the `local_date` stamp the week strip reads, and the
 * `WHERE completed_at IS NULL` claim that makes the completion idempotent. The
 * visible symptom was the worst of the three — the strip drew a gap on a day
 * the streak had counted, so the panel contradicted the number printed beside
 * it.
 *
 * Source-reading, because this suite has no component-render library by
 * project rule. These assertions are cheap and they pin the two lines that a
 * refactor of `loadSession` would quietly drop.
 */

import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

/** Source with block and line comments removed. The docblocks in these files
 *  discuss `sessionId` at length, so matching raw text would pass on prose. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the resume path recovers the deal id', () => {
  it('assigns the ref from the cached session', () => {
    const screen = code(read('components', 'ReviewScreen.tsx'));
    const resume = screen.slice(screen.indexOf('if (resumable) {'));
    const block = resume.slice(0, resume.indexOf('    try {'));
    expect(block).toMatch(/sessionIdRef\.current = resumable\.sessionId/);
  });

  it('caches the id when a fresh deck is dealt', () => {
    // The other half: nothing to recover unless the deal was written down.
    const screen = code(read('components', 'ReviewScreen.tsx'));
    const start = screen.slice(screen.indexOf('useReviewSessionStore.getState().start({'));
    expect(start.slice(0, start.indexOf('});'))).toMatch(/sessionId: sessionIdRef\.current/);
  });

  it('keeps the id on the cached session type, not just in the ref', () => {
    // A ref dies with the process. The whole point of this fix is that the id
    // outlives the app being killed, which means it lives in the store.
    expect(code(read('stores', 'reviewSessionStore.ts'))).toMatch(
      /sessionId: number \| null;/,
    );
  });

  it('sends the id it holds on completion', () => {
    const screen = code(read('components', 'ReviewScreen.tsx'));
    expect(screen).toMatch(/sessionIdRef\.current,/);
  });
});
