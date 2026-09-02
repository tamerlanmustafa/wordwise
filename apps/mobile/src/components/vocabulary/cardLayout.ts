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
/** 2. Word slot — bottom-aligned serif headword. 56 still seats both tiers
 *  exactly: the long tier is 2 × 28 lineHeight, the short tier one 38pt line
 *  sitting on the slot's floor. */
export const WORD_SLOT_HEIGHT = 56;
export const DEFINITION_SLOT_TOP = 6;
/** 2b. Definition slot — the English learner gloss for the sense the example
 *  sentence uses (`lemmas.definition`). Two lines at 12/16, so a long gloss
 *  wraps rather than shrinking; MAX_DEF_CHARS (90, backend) is sized against
 *  this slot.
 *
 *  32, not 27. The first cut packed two lines into 27 (12pt on a 13.5
 *  lineHeight, a 1.125 ratio — the tightest in this file by some way). iOS
 *  treats lineHeight as advisory and would have absorbed it; Android enforces
 *  it, and this text is serif ITALIC, whose descenders reach furthest below
 *  the baseline, so the clipping would have shown up on one platform only.
 *
 *  RESERVED UNCONDITIONALLY, like the translation zones — a card whose height
 *  depended on whether the definition had been generated yet would change the
 *  deck's geometry per word, and the fly-away overlay renders from the same
 *  slot heights as the focused card, so it would pop at the instant of detach.
 *  A lemma the definition worker hasn't reached renders the slot empty rather
 *  than dashed: dashes are this card's idiom for "this fills in on tap", and
 *  the definition never does.
 *
 *  Unlike the eyebrow row, this height is NOT taken out of a neighbour — it
 *  grows CARD_HEIGHT, and the deck scales down uniformly to pay for it. The
 *  large phones had slack above the scale clamp and absorbed it without
 *  moving (16 Pro and Pixel 8 both stay at 1.000); the SE, already the only
 *  device scaling, pays the whole cost at 0.720 → 0.659, still well clear of
 *  MIN_SCALE. The alternative was halving the sentence-translation slot,
 *  which would have cost real content on every reveal, on every device.
 *  deckMetrics' invariant test pins the exact numbers. */
export const DEFINITION_SLOT_HEIGHT = 32;
export const WORD_TR_SLOT_TOP = 5;
/** 3. Word-translation slot — dashed rule while hidden. */
export const WORD_TR_SLOT_HEIGHT = 26;
/** 4. `EXAMPLE SENTENCE` eyebrow + hairline. Replaced the bare 1pt divider;
 *  the 9pt it gained came out of the word slot and the gap above it, so
 *  CARD_HEIGHT is unchanged. */
export const SENTENCE_LABEL_TOP = 12;
export const SENTENCE_LABEL_HEIGHT = 10;
export const SENTENCE_SLOT_TOP = 12;
/** 5. Sentence-in-context slot. */
export const SENTENCE_SLOT_HEIGHT = 88;
export const SENTENCE_TR_SLOT_TOP = 10;
/** 6. Sentence-translation slot — two dashed rules while hidden. */
export const SENTENCE_TR_SLOT_HEIGHT = 68;
export const FOOTER_TOP = 14;
/** 7. Footer row: report · audio · TAP TO REVEAL hint. */
export const FOOTER_HEIGHT = 16;
/** Horizontal spacing between the footer's actions. */
export const FOOTER_GAP = 16;

/**
 * Touch padding for the footer's icon-only actions — today just the speaker.
 *
 * The speaker is a 13pt emoji sitting inside the card's own tap-to-reveal
 * Pressable, so without slop its target is the glyph itself: a tap a few
 * points off flips the card instead of playing the word, which reads as "the
 * speaker doesn't work". The save heart in the meta row was given a target
 * (`hitSlop` 10); the speaker never was.
 *
 * The two numbers are bounded by different neighbours, which is why they
 * differ:
 *
 * • Horizontal is capped at half `FOOTER_GAP`. Slop regions of adjacent
 *   actions must not overlap — where they do, the deeper/later view wins the
 *   touch and "Report an issue" would start swallowing presses meant for the
 *   speaker. Half the gap each is the widest that cannot collide.
 * • Vertical is capped at `FOOTER_TOP`, the empty run above the row. Nothing
 *   there is interactive (it belongs to the card's own Pressable, which the
 *   speaker is allowed to win), so it can take the whole gap — and it needs
 *   to, since `FOOTER_HEIGHT` alone is 16pt and 16 + 14 + 14 is the ~44pt
 *   target both platforms' guidelines ask for.
 */
export const FOOTER_ICON_HIT_SLOP = {
  top: FOOTER_TOP,
  bottom: FOOTER_TOP,
  left: FOOTER_GAP / 2,
  right: FOOTER_GAP / 2,
} as const;

/** The constant card height — the sum of every slot, gap, and padding. */
export const CARD_HEIGHT =
  CARD_PADDING +
  META_ROW_HEIGHT +
  WORD_SLOT_TOP +
  WORD_SLOT_HEIGHT +
  DEFINITION_SLOT_TOP +
  DEFINITION_SLOT_HEIGHT +
  WORD_TR_SLOT_TOP +
  WORD_TR_SLOT_HEIGHT +
  SENTENCE_LABEL_TOP +
  SENTENCE_LABEL_HEIGHT +
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

export const DEFINITION_TIER_MAX_CHARS = 46;
/** Definition: one comfortable line, or two for a long gloss. Both tiers fit
 *  inside DEFINITION_SLOT_HEIGHT (32) — 1 × 20, 2 × 16 — and both keep a
 *  lineHeight/fontSize ratio above 1.3, which is what stops Android clipping
 *  the descenders of serif italic (see the slot's note).
 *
 *  Measure the WHOLE line — `glossLine().text`, part-of-speech label included,
 *  not the definition on its own. The label is ~7 characters of the same
 *  budget, and sizing without it is how a line that "fits" gets clipped.
 *
 *  The 2-line tier seats about 90 characters, which is where the backend's
 *  MAX_DEF_CHARS came from. A label on top of a definition already at that cap
 *  therefore ellipsizes — true of 62 of the 27,068 glosses in the corpus
 *  (0.2%, all of them 84+ chars). Left to clamp rather than paid for with a
 *  third line: three at 12/16 is 48px against a 32px slot, so the fix would be
 *  a taller card for every word to save the tail. */
export function definitionTier(line: string): TypeTier {
  return line.length <= DEFINITION_TIER_MAX_CHARS
    ? { fontSize: 14, lineHeight: 20, lines: 1 }
    : { fontSize: 12, lineHeight: 16, lines: 2 };
}

export const SENTENCE_TIER_MAX_CHARS = 95;
/** Sentence: 3 comfortable lines, or 4 tighter ones for long sentences. */
export function sentenceTier(sentence: string): TypeTier {
  return sentence.length <= SENTENCE_TIER_MAX_CHARS
    ? { fontSize: 17, lineHeight: 26, lines: 3 }
    : { fontSize: 14.5, lineHeight: 22, lines: 4 };
}

export const MOVIE_TITLE_TIER_MAX_CHARS = 26;
/** Movie-detail hero title. Same step-down rule as the card's slots — a long
 *  title drops one tier and wraps to a second line rather than shrinking to
 *  fit, so the 119pt hero plate is the same height for every film. */
export function movieTitleTier(title: string): TypeTier {
  return title.length <= MOVIE_TITLE_TIER_MAX_CHARS
    ? { fontSize: 26, lineHeight: 29, lines: 2 }
    : { fontSize: 22, lineHeight: 25, lines: 2 };
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
