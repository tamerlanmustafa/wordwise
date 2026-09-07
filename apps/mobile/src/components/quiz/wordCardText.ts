/**
 * wordCardText — the text maths behind the word card.
 *
 * A separate module from `WordCard.tsx` for the same reason `mcqLogic` is
 * separate from `MCQCard`: the component imports `expo-linear-gradient`, and
 * this repo's jest setup is logic-only with no native module mocks, so a
 * helper exported from the component file cannot be imported by a test at all.
 * Pure helpers live in `.ts`, components in `.tsx` (see CLAUDE.md, "Mobile
 * test conventions").
 */

/**
 * Splits an example sentence around the first occurrence of the target word,
 * so the card can wash that run in accent.
 *
 * Case-insensitive and whole-word: "act" must not highlight the "act" inside
 * "factory". Returns null when the word does not appear — plenty of sentences
 * use an inflected form the lemma will never match, and the two failures are
 * not equally bad. A missed highlight is invisible; a wrong one is a visible
 * defect that reads as bad data. So this errs toward not highlighting.
 */
export function splitAroundWord(
  sentence: string,
  word: string,
): { before: string; match: string; after: string } | null {
  if (!sentence || !word) return null;
  // Lemmas have carried punctuation before now; an unescaped '.' would match
  // any character and light up a run of the wrong letters.
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}\\b`, 'i');
  const m = re.exec(sentence);
  if (!m) return null;
  return {
    before: sentence.slice(0, m.index),
    // Taken from the sentence, not the lemma, so a capitalised opener stays
    // capitalised instead of being replaced by its dictionary form.
    match: m[0],
    after: sentence.slice(m.index + m[0].length),
  };
}

/**
 * Whether the card may print its example sentence at all.
 *
 * `asking` is the definition card: the gloss is the question and the sentence
 * is the second half of it, so the target word in it has to be blanked. That
 * inverts the trade-off `splitAroundWord` is tuned for. A sentence the lemma
 * cannot be located in is a *missed highlight* on an ordinary card — invisible
 * — and the *answer printed above the four options* on a definition card.
 *
 * It is not a rare case: the sentence prompt explicitly allows an inflected
 * form ("an inflected form is fine, but it must be unambiguously the same
 * lemma"), and 9,453 of the 36,531 eligible global sentences in prod use one.
 * So a quarter of definition cards would answer themselves.
 *
 * The gloss alone is a complete question, so the card drops the sentence
 * rather than showing a compromised one.
 */
export function shouldShowExample(
  example: string | null | undefined,
  word: string,
  asking: boolean,
): boolean {
  if (!example) return false;
  if (!asking) return true;
  return splitAroundWord(example, word) !== null;
}
