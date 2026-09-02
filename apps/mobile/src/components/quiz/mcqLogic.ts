/**
 * mcqLogic — pure state helpers for the translation MCQ card. No
 * React / React-Native imports so the choice-state matrix stays
 * unit-testable under the logic-only jest setup (see CLAUDE.md
 * "Mobile test conventions").
 */

export type MCQPhase = 'idle' | 'answered';
export type MCQChoiceState = 'idle' | 'correct' | 'wrong' | 'reveal-correct';

export interface MCQAnswerState {
  phase: MCQPhase;
  /** Index the user tapped; null while idle. */
  pickedIdx: number | null;
  /** Index of the is_correct choice (-1 when the payload has none). */
  correctIdx: number;
  userWasCorrect: boolean;
}

/**
 * Visual state for choice `i` (cf. CLAUDE_PROMPT §7.1): the picked tile
 * flips to correct/wrong immediately, and the actual right answer is
 * always highlighted (`reveal-correct`) even when the user picked wrong.
 */
export function choiceStateFor(i: number, a: MCQAnswerState): MCQChoiceState {
  if (a.phase === 'idle') return 'idle';
  if (i === a.pickedIdx) {
    return a.userWasCorrect ? 'correct' : 'wrong';
  }
  if (i === a.correctIdx && !a.userWasCorrect) {
    return 'reveal-correct';
  }
  return 'idle';
}

/**
 * Post-answer, every tile except the picked one and the revealed-correct
 * one fades to 0.4 opacity so the eye lands on the two relevant tiles.
 */
export function choiceIsDimmed(i: number, a: MCQAnswerState): boolean {
  if (a.phase === 'idle') return false;
  if (i === a.pickedIdx) return false;
  if (i === a.correctIdx && !a.userWasCorrect) return false;
  return true;
}

/** Card copy (a single object since the synonym variant was retired). */
export const MCQ_COPY: { eyebrow: string; idleCta: string; notQuiteSuffix: string } = {
  eyebrow: 'PICK THE TRANSLATION',
  idleCta: 'Pick the translation',
  notQuiteSuffix: ' is the translation.',
};

// ── Card geometry ──────────────────────────────────────────────────────────
// Shared between the real card and the skeleton shown while the deck loads.
// The skeleton carried its own numbers and got all of them wrong: three rows
// where every deck has four, 52pt tall against a 56pt tap target, radius 12
// against 14. A placeholder that is the wrong size is worse than none, because
// the screen visibly re-lays-out the moment the cards arrive — and nothing
// fails, so it survives every review.

/** Choices per card. The server builds exactly four; the deck has no other
 *  shape, so a placeholder showing three is simply wrong. */
export const MCQ_CHOICE_COUNT = 4;
/** Minimum row height — this is the tap target, not just a look. */
export const MCQ_CHOICE_MIN_H = 56;
export const MCQ_CHOICE_RADIUS = 14;
/** Vertical gap between two choice rows. */
export const MCQ_CHOICE_GAP = 10;
/** WordCard's corner radius. */
export const WORD_CARD_RADIUS = 18;
/** WordCard's outer vertical margin. */
export const WORD_CARD_MARGIN_Y = 16;
/** Roughly what a WordCard occupies with a word and a one-line subtitle:
 *  28pt padding, a ~44pt serif line, an 8pt gap, a 17pt subtitle, 28pt
 *  padding. Approximate on purpose — the real card grows with the sentence,
 *  and a placeholder that guesses the common case is closer than one that
 *  guesses nothing. */
export const WORD_CARD_H = 125;
