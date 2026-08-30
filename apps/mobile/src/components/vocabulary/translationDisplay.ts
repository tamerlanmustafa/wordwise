/**
 * What to put in a word card's translation slot.
 *
 * Every translation surface eventually meets the same case: the provider hands
 * back the word unchanged. `khat` is `khat` in Turkish, so is `grappa`, `malt`
 * and `argon` — genuine loanwords, not failures. Echoing them reads as a bug
 * ("khat = khat") even though the answer is correct, so the slot says so in
 * words instead.
 *
 * This is a decision, not a render: the deck, the rows and the home card all
 * need it, and mobile tests are logic-only (no render library), so the
 * judgement lives here as a pure function and the components just draw the
 * result. Keeping it out of the components is also what stops the three of
 * them drifting apart, which is exactly what had happened — rows had the
 * check, the deck never got it.
 *
 * Note this is the *client's* read of a single answer. The server records the
 * same observation across providers and sightings
 * (`translation_passthroughs`), which is what can eventually tell a loanword
 * apart from a dead API call. Here we only have one string, so we describe it
 * honestly rather than diagnosing it.
 */

export type WordTranslationDisplay =
  /** A real translation to show, already cased for the slot. */
  | { kind: 'translation'; text: string }
  /** The provider returned the word itself — say so, don't echo. */
  | { kind: 'sameAsSource' }
  /** Nothing came back (not yet loaded, or the fetch failed). */
  | { kind: 'unavailable' };

/**
 * Whether `translation` is just `term` handed back. Case- and
 * whitespace-insensitive, because providers vary on both ("Khat", " khat ").
 */
export function isSameAsSource(term: string, translation: string | null | undefined): boolean {
  if (!translation) return false;
  return translation.trim().toLowerCase() === term.trim().toLowerCase();
}

/**
 * Resolve the slot's content. Callers pass the raw fetched value; the caller
 * decides how to draw each `kind`.
 */
export function wordTranslationDisplay(
  term: string,
  translation: string | null | undefined,
): WordTranslationDisplay {
  const trimmed = translation?.trim() ?? '';
  if (trimmed.length === 0) return { kind: 'unavailable' };
  if (isSameAsSource(term, trimmed)) return { kind: 'sameAsSource' };
  // Lowercased to match the card's dictionary-entry voice; the sentence and
  // definition slots keep their own casing.
  return { kind: 'translation', text: trimmed.toLowerCase() };
}
