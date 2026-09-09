/**
 * newListError — turning a create failure into something the reader can read.
 *
 * `POST /lists` refuses for two reasons the user can act on, and both arrive
 * as a `code` on the error:
 *
 *   • `duplicate_name`      — they already have a list with that name.
 *   • `list_limit_reached`  — they are at `MAX_LISTS_PER_KIND` (50 per kind).
 *
 * The second one had no case here, so it fell through to the server's own
 * sentence — "You can have at most 50 words lists" — which is English however
 * the app is set, and phrased for whoever reads the logs rather than for
 * someone who has just been stopped mid-task. A localised app that prints raw
 * API English at its one refusal point is worse than one that never
 * translated anything, because the seam only shows where it hurts.
 *
 * The copy deliberately names no number. The cap lives in
 * `services/lists.MAX_LISTS_PER_KIND` and the client has no honest way to know
 * it — the error carries a code and a message, not a limit — so hardcoding 50
 * here would be a second source of truth that silently goes stale the day the
 * cap moves. "You've reached the maximum" is true at any cap, and the sentence
 * that matters is the next one: delete one to make room.
 *
 * Returns a translation key, or `null` when the failure is not one we have
 * words for — the caller falls back to the raw message then, which is the
 * right behaviour for an unexpected 500: something unhelpful is still better
 * than something silent.
 */

/** Wire codes `routes/lists.py` puts in `detail.code`. */
const KEY_BY_CODE: Record<string, string> = {
  duplicate_name: 'new.errorDuplicate',
  list_limit_reached: 'new.errorLimit',
};

export function newListErrorKey(code: unknown): string | null {
  return typeof code === 'string' ? KEY_BY_CODE[code] ?? null : null;
}
