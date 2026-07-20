/**
 * cardLayout — the "Ledger Reveal" card's layout contract (mockup 1a).
 *
 * The card is a CONSTANT height in every state: translation zones are
 * permanently reserved (dashed placeholder rules while hidden, filled in
 * place on reveal), and long content steps down one type tier and wraps
 * instead of shrinking to unreadable or being filtered out. Slot heights
 * are the contract — content adapts INSIDE them, never the other way.
 *
 * Pure data + functions, no React/RN imports: unit-testable as-is.
 */

// ── Fixed slot heights (px), top to bottom inside the card ────────────────

export const CARD_PADDING = 20;

/** 1. Meta row: card number · CEFR pill · idiom badge · save star. */
export const META_ROW_HEIGHT = 24;
export const WORD_SLOT_TOP = 8;
/** 2. Word slot — bottom-aligned serif headword. */
export const WORD_SLOT_HEIGHT = 64;
export const WORD_TR_SLOT_TOP = 6;
/** 3. Word-translation slot — dashed rule while hidden. */
export const WORD_TR_SLOT_HEIGHT = 26;
export const DIVIDER_TOP = 12;
export const DIVIDER_HEIGHT = 1;
export const SENTENCE_SLOT_TOP = 12;
/** 5. Sentence-in-context slot. */
export const SENTENCE_SLOT_HEIGHT = 88;
export const SENTENCE_TR_SLOT_TOP = 10;
/** 6. Sentence-translation slot — two dashed rules while hidden. */
export const SENTENCE_TR_SLOT_HEIGHT = 68;
export const FOOTER_TOP = 14;
/** 7. Footer row: report · audio · TAP TO REVEAL hint. */
export const FOOTER_HEIGHT = 16;

/** The constant card height — the sum of every slot, gap, and padding. */
export const CARD_HEIGHT =
  CARD_PADDING +
  META_ROW_HEIGHT +
  WORD_SLOT_TOP +
  WORD_SLOT_HEIGHT +
  WORD_TR_SLOT_TOP +
  WORD_TR_SLOT_HEIGHT +
  DIVIDER_TOP +
  DIVIDER_HEIGHT +
  SENTENCE_SLOT_TOP +
  SENTENCE_SLOT_HEIGHT +
  SENTENCE_TR_SLOT_TOP +
  SENTENCE_TR_SLOT_HEIGHT +
  FOOTER_TOP +
  FOOTER_HEIGHT +
  CARD_PADDING;

// ── Deck stack geometry ───────────────────────────────────────────────────

/** Vertical room above the focused card for the two ghost cards behind it. */
export const STACK_HEADROOM = 18;
/** Deck zone height: headroom + the card itself. */
export const DECK_ZONE_HEIGHT = STACK_HEADROOM + CARD_HEIGHT;

/** Ghost card offsets: { top offset inside the zone, horizontal inset }. */
export const GHOSTS = [
  { top: 10, inset: 7, opacity: 0.85 },
  { top: 2, inset: 14, opacity: 0.55 },
] as const;

// ── Adaptive type tiers — pure functions of string length ─────────────────
// Long content steps down ONE tier and wraps; nothing is filtered out and
// nothing shrinks below the small tier.

export interface TypeTier {
  fontSize: number;
  lineHeight: number;
  /** Max lines the text may occupy inside its slot (clamped w/ ellipsis). */
  lines: number;
}

export const WORD_TIER_MAX_CHARS = 18;
/** Word slot: short words get display size, long words/idioms wrap on two lines. */
export function wordTier(word: string): TypeTier {
  return word.length <= WORD_TIER_MAX_CHARS
    ? { fontSize: 32, lineHeight: 38, lines: 1 }
    : { fontSize: 22, lineHeight: 28, lines: 2 };
}

export const WORD_TR_TIER_MAX_CHARS = 26;
/** Word translation: single ellipsized line, stepping down for long phrases. */
export function wordTranslationTier(translation: string): TypeTier {
  return translation.length <= WORD_TR_TIER_MAX_CHARS
    ? { fontSize: 17, lineHeight: WORD_TR_SLOT_HEIGHT, lines: 1 }
    : { fontSize: 14, lineHeight: WORD_TR_SLOT_HEIGHT, lines: 1 };
}

export const SENTENCE_TIER_MAX_CHARS = 95;
/** Sentence: 3 comfortable lines, or 4 tighter ones for long sentences. */
export function sentenceTier(sentence: string): TypeTier {
  return sentence.length <= SENTENCE_TIER_MAX_CHARS
    ? { fontSize: 17, lineHeight: 26, lines: 3 }
    : { fontSize: 14.5, lineHeight: 22, lines: 4 };
}

export const SENTENCE_TR_TIER_MAX_CHARS = 85;
/** Sentence translation: same step-down pattern inside its 68px slot. */
export function sentenceTranslationTier(translation: string): TypeTier {
  return translation.length <= SENTENCE_TR_TIER_MAX_CHARS
    ? { fontSize: 14.5, lineHeight: 22, lines: 3 }
    : { fontSize: 12.5, lineHeight: 17, lines: 4 };
}

// ── Reveal + transition timing ────────────────────────────────────────────

/** Cross-fade duration for the reveal (in) / hide (out) of translations. */
export const REVEAL_IN_MS = 240;
export const REVEAL_OUT_MS = 220;
/** Hidden→revealed layers rise 5px as they fade in. */
export const REVEAL_RISE_PX = 5;

/** Sentence highlight: B1's raw yellow is too light on white — darken it. */
export const B1_HIGHLIGHT = '#B08A00';
