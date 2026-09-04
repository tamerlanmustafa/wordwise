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
