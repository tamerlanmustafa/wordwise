/**
 * mcqLogic — choice-state matrix + copy for the translation MCQ card.
 * Pure logic, no React: covers the tile states (picked/reveal/dim)
 * that MCQCard renders.
 */
import * as mcqLogic from '../mcqLogic';
import {
  choiceIsDimmed,
  choiceStateFor,
  type MCQAnswerState,
} from '../mcqLogic';

const idle: MCQAnswerState = {
  phase: 'idle',
  pickedIdx: null,
  correctIdx: 2,
  userWasCorrect: false,
};

const pickedRight: MCQAnswerState = {
  phase: 'answered',
  pickedIdx: 2,
  correctIdx: 2,
  userWasCorrect: true,
};

const pickedWrong: MCQAnswerState = {
  phase: 'answered',
  pickedIdx: 0,
  correctIdx: 2,
  userWasCorrect: false,
};

describe('choiceStateFor', () => {
  it('keeps every tile idle before the user answers', () => {
    for (let i = 0; i < 4; i++) {
      expect(choiceStateFor(i, idle)).toBe('idle');
    }
  });

  it('marks the picked tile correct on a right answer', () => {
    expect(choiceStateFor(2, pickedRight)).toBe('correct');
    // Other tiles stay visually idle (they just dim).
    expect(choiceStateFor(0, pickedRight)).toBe('idle');
    expect(choiceStateFor(1, pickedRight)).toBe('idle');
  });

  it('marks the picked tile wrong AND reveals the real answer on a miss', () => {
    expect(choiceStateFor(0, pickedWrong)).toBe('wrong');
    expect(choiceStateFor(2, pickedWrong)).toBe('reveal-correct');
    expect(choiceStateFor(1, pickedWrong)).toBe('idle');
    expect(choiceStateFor(3, pickedWrong)).toBe('idle');
  });
});

describe('choiceIsDimmed', () => {
  it('never dims while idle', () => {
    for (let i = 0; i < 4; i++) {
      expect(choiceIsDimmed(i, idle)).toBe(false);
    }
  });

  it('after a correct pick, dims everything except the picked tile', () => {
    expect(choiceIsDimmed(2, pickedRight)).toBe(false);
    expect(choiceIsDimmed(0, pickedRight)).toBe(true);
    expect(choiceIsDimmed(1, pickedRight)).toBe(true);
    expect(choiceIsDimmed(3, pickedRight)).toBe(true);
  });

  it('after a miss, keeps the picked and revealed-correct tiles full-opacity', () => {
    expect(choiceIsDimmed(0, pickedWrong)).toBe(false);
    expect(choiceIsDimmed(2, pickedWrong)).toBe(false);
    expect(choiceIsDimmed(1, pickedWrong)).toBe(true);
    expect(choiceIsDimmed(3, pickedWrong)).toBe(true);
  });
});

describe('the card carries no hardcoded copy', () => {
  it('exports no MCQ_COPY object', () => {
    // It held "PICK THE TRANSLATION", the same sentence again as the idle
    // button, and " is the translation." for the wrong-answer callout — three
    // strings restating the four translations already on screen, none of them
    // translatable. The card's only string is its CTA, from i18n.
    expect(Object.keys(mcqLogic)).not.toContain('MCQ_COPY');
  });

  it('still highlights the right answer, which is what the callout said', () => {
    // Removing the prose must not remove the information. The correct row
    // turns green next to the user's red one whether or not they got it.
    const pickedWrong = { phase: 'answered' as const, pickedIdx: 0, correctIdx: 2, userWasCorrect: false };
    expect(choiceStateFor(2, pickedWrong)).toBe('reveal-correct');
    expect(choiceIsDimmed(2, pickedWrong)).toBe(false);
  });
});
