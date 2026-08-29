/**
 * sentencePreviews — the single rule deciding whether a vocabulary item is
 * worth rendering on MovieDetail, shared by the rows and the card deck.
 *
 * Example sentences are AI-authored (SentenceBank), not lifted from the
 * subtitles, so a word the generator never produced a sentence for has
 * nothing to teach with: the rows have always dropped those words, but the
 * deck rendered them as a full card with an empty sentence slot. Both read
 * the same batch-preview map, so both now ask the same question of it.
 */

import type { SentenceExample } from './VocabRow';

/** Word → its batch-fetched preview. `undefined` = not fetched (yet). */
export type SentencePreviewMap = Record<string, SentenceExample | undefined>;

/** Display key for a vocabulary item: the phrase for idioms, the word for words. */
export const itemKey = (item: { word: string } | { phrase: string }): string =>
  'phrase' in item ? item.phrase : item.word;

/**
 * Should this item be shown?
 *
 * - No entry → yes. Either the batch is still in flight (the caller paints a
 *   skeleton and the answer firms up when it lands) or the item was never
 *   batched at all — idioms aren't, and they carry their own example.
 * - Entry with a sentence → yes.
 * - Entry with an empty sentence → no. That is a confirmed miss: the backend
 *   checked SentenceBank *and* ran the LLM slow path and still came back with
 *   nothing, so waiting longer will not produce a sentence.
 */
export function hasRenderableSentence(key: string, previews: SentencePreviewMap): boolean {
  const entry = previews[key];
  return entry === undefined ? true : entry.sentence.length > 0;
}
