/**
 * revealFit — whether the word card has room to open its translation, and
 * what gives way when it does not.
 *
 * The card is one page of a vertical pager: it cannot scroll, so anything laid
 * out past its bottom edge is simply gone. On a 667pt iPhone SE the card is
 * ~548pt tall, and a longer card — a top-5% example sentence under a two-line
 * definition — already sliced the last line of its translation in half when
 * revealed; the longest sentence lost two lines. The 13 mini and every taller
 * phone fit the same card.
 *
 * What gives way is the English gloss. The translation answers the question
 * the gloss answers ("what does this mean?") in the reader's own language, so
 * while it is open the gloss is the line the reader needs least — and it is
 * also the only thing tall enough to make the room: up to three lines, ~80pt on
 * the SE, against ~50pt missing in the worst case measured. The overflow only
 * ever happens on cards that HAVE a gloss, which is why folding it always
 * frees enough.
 *
 * Pure, so the decision is tested without rendering: the card measures, this
 * decides.
 */

/** The least clear space the card keeps above and below its content — the
 *  `minHeight` of WordCard's two flex spacers. */
export const SPACER_TOP_MIN = 12;
export const SPACER_BOTTOM_MIN = 14;

/** Clear space above the translation block once it is open. */
export const REVEAL_GAP = 18;

/**
 * Height the card can still give to new content without anything crossing its
 * edges: whatever its two flex spacers hold beyond their minimums. Measured
 * with the translation closed.
 */
export function spareHeight(spacerTop: number, spacerBottom: number): number {
  return Math.max(0, spacerTop - SPACER_TOP_MIN) + Math.max(0, spacerBottom - SPACER_BOTTOM_MIN);
}

export interface RevealFitInput {
  revealed: boolean;
  hasGloss: boolean;
  /** From `spareHeight`, or null before the card has laid out once. */
  spare: number | null;
  /** The translation block's measured height; 0 before it is measured. */
  revealHeight: number;
}

/**
 * Should the gloss fold away while the translation is open?
 *
 * Only when both are true: the translation is open, and it would not fit in the
 * spare height the card had with it closed. A card that fits changes nothing —
 * every card on a tall phone, and most cards on a short one.
 *
 * An unmeasured card never folds: guessing wrong in that direction costs the
 * overflow this exists to fix, but guessing wrong the other way would hide a
 * definition that had room.
 */
export function glossYieldsToReveal({ revealed, hasGloss, spare, revealHeight }: RevealFitInput): boolean {
  if (!revealed || !hasGloss || spare === null || revealHeight <= 0) return false;
  return revealHeight + REVEAL_GAP > spare;
}
