/**
 * glossLine — the "(noun) a person who stays too long" line, composed once for
 * every surface that prints it (the Explore card, the movie-detail card deck).
 *
 * Both halves are optional and arrive from different places at different
 * times: `pos` is written when a script is classified, `definition` when the
 * definition worker later reaches the lemma. So all four combinations happen
 * in production and each one has to read as a finished line — a card must
 * never show a stray "(noun)" with nothing after it *and* must never drop a
 * gloss just because the parser had no tag for the word.
 *
 * `text` is the whole line as one string. Callers that pick a type size from
 * content length (the deck's `definitionTier`) must measure THAT, not the
 * definition alone: "(noun) " is seven characters of the line budget, and
 * sizing without them is how a one-line tier ends up clipped on the device
 * with the least room.
 *
 * Pure — no React, no RN. The parens live here rather than in each card's JSX
 * so the two surfaces cannot drift into different punctuation.
 */

/** U+2068 FIRST STRONG ISOLATE / U+2069 POP DIRECTIONAL ISOLATE, wrapped
 *  around the label so its parentheses cannot mirror.
 *
 *  Without them, `(noun)` renders as `)noun(` under an RTL app language: the
 *  opening bracket is a bidi-neutral character sitting at the start of the
 *  line, so it inherits the paragraph's direction rather than the direction of
 *  the Latin word beside it, and mirroring brackets is exactly what the bidi
 *  algorithm is supposed to do to it. The isolate says "this run has its own
 *  direction, decide it from the first strong character inside" — which is
 *  the `n`. Invisible in LTR, and it costs no layout.
 *
 *  Built with fromCharCode rather than an escape so no editor, patch, or diff
 *  tool can turn an invisible control character into a visible one. */
const FSI = String.fromCharCode(0x2068);
const PDI = String.fromCharCode(0x2069);

export interface GlossLine {
  /** Print-ready label including its parentheses and bidi isolates, e.g.
   *  `(noun)`. Render as-is; do not add punctuation around it. */
  pos: string | null;
  definition: string | null;
  /** Both halves joined, as they render. What length-based type tiers should
   *  measure — it carries the two invisible isolates, which rounds a
   *  borderline gloss down to the smaller, safer tier. */
  text: string;
}

/**
 * @param pos        Learner label from the server (`noun` / `verb` / `adj` /
 *                   `adv`), already mapped from the raw UPOS tag. Anything
 *                   blank is treated as absent.
 * @param definition One-line English gloss for the sense the card's example
 *                   sentence uses.
 * @returns The composed line, or `null` when there is nothing to print.
 */
export function glossLine(
  pos?: string | null,
  definition?: string | null,
): GlossLine | null {
  const label = pos?.trim() ? `${FSI}(${pos.trim()})${PDI}` : null;
  const gloss = definition?.trim() || null;
  if (!label && !gloss) return null;
  return {
    pos: label,
    definition: gloss,
    text: [label, gloss].filter(Boolean).join(' '),
  };
}
