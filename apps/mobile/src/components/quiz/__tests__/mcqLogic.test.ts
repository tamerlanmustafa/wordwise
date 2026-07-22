/**
 * mcqLogic — choice-state matrix + copy for the translation MCQ card.
 * Pure logic, no React: covers the tile states (picked/reveal/dim)
 * that MCQCard renders.
 */
import {
  MCQ_COPY,
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

describe('MCQ_COPY', () => {
  it('carries the translation-card eyebrow, idle CTA, and callout suffix', () => {
    expect(MCQ_COPY.eyebrow).toBe('PICK THE TRANSLATION');
    expect(MCQ_COPY.idleCta).toBe('Pick the translation');
    expect(MCQ_COPY.notQuiteSuffix).toBe(' is the translation.');
  });
});
