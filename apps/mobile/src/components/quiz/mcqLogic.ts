/**
 * mcqLogic — pure state helpers for the MCQ card, shared by the synonym
 * and translation variants. No React / React-Native imports so the
 * choice-state matrix stays unit-testable under the logic-only jest
 * setup (see CLAUDE.md "Mobile test conventions").
 */

export type MCQVariant = 'synonym' | 'translation';
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

/** Copy that differs between the two card variants. */
export const MCQ_COPY: Record<
  MCQVariant,
  { eyebrow: string; idleCta: string; notQuiteSuffix: string }
> = {
  synonym: {
    eyebrow: 'PICK THE SYNONYM',
    idleCta: 'Pick a synonym',
    notQuiteSuffix: ' is the closest synonym.',
  },
  translation: {
    eyebrow: 'PICK THE TRANSLATION',
    idleCta: 'Pick the translation',
    notQuiteSuffix: ' is the translation.',
  },
};
