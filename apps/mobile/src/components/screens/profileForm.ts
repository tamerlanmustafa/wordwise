/**
 * profileForm — the Settings account form's save rules, as pure functions.
 *
 * Settings had two save models on one screen and no sign of which was which.
 * Theme, daily goal, app language, translation language and every toggle
 * committed on the tap. Username, native language, learning language and
 * proficiency level did not: they sat in local state until you found the
 * "Save changes" button — which is halfway down a long scroll, below the
 * translation-language chips, nowhere near the fields it governs. Change your
 * proficiency level, hit Back, and it is silently gone.
 *
 * That one hurts more than it looks. `proficiency_level` is what composes the
 * Practice deck (`_pad_with_fresh_level_lemmas`) and the Explore feed mix, so
 * a user who "set" themselves to B2 and lost it keeps getting A2 words and has
 * no way to tell why.
 *
 * The fix is to have one model, not two. The three pickers commit on selection
 * like everything else on the screen — they are discrete choices, and there is
 * nothing to validate. Username keeps an explicit save because it is free text
 * the server can reject ("Username already taken"), so it needs a moment where
 * the user is asking for a verdict; it just moved next to its own field.
 *
 * These helpers are what drives the button's state and the Back guard. Pure so
 * they can be tested — mobile testing here is logic + integration only.
 */

/** What the username field is currently asking for. */
export type UsernameState =
  /** Same as what the server already has — nothing to do. */
  | 'unchanged'
  /** Blank or whitespace. The server would reject it and so do we. */
  | 'empty'
  /** A real, different name, ready to submit. */
  | 'ready';

/** Trim only. Case is meaningful — the server treats names as distinct. */
export function normalizeUsername(raw: string): string {
  return raw.trim();
}

/**
 * Compare the draft against what the account holds.
 *
 * `saved` may be null/undefined for an account that has never had one, which
 * makes any non-empty draft `ready` rather than `unchanged`.
 */
export function usernameState(draft: string, saved: string | null | undefined): UsernameState {
  const next = normalizeUsername(draft);
  if (next.length === 0) return 'empty';
  if (next === normalizeUsername(saved ?? '')) return 'unchanged';
  return 'ready';
}

/** The Save button is live only when there is a valid, actual change. */
export function canSaveUsername(draft: string, saved: string | null | undefined): boolean {
  return usernameState(draft, saved) === 'ready';
}

/**
 * Whether leaving the screen would throw away a username edit.
 *
 * Only `ready` counts. A blank field is not work worth defending — the user
 * cleared it and is walking away — and warning about it would make Back feel
 * broken for anyone who tapped into the field by accident.
 */
export function hasUnsavedUsername(draft: string, saved: string | null | undefined): boolean {
  return usernameState(draft, saved) === 'ready';
}
