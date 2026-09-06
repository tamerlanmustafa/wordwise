import fs from 'fs';
import path from 'path';
/**
 * mcqLogic — choice-state matrix + copy for the translation MCQ card.
 * Pure logic, no React: covers the tile states (picked/reveal/dim)
 * that MCQCard renders.
 */
import * as mcqLogic from '../mcqLogic';
import {
  choiceIsDimmed,
  choiceStateFor,
  isChoiceCard,
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

describe('isChoiceCard', () => {
  it('accepts both question shapes', () => {
    // They score identically and post the same boolean; only the question
    // differs. Every screen that renders a grid asks this rather than testing
    // for 'mcq', so a third shape is one edit here instead of three identical
    // conditions drifting apart.
    expect(isChoiceCard('mcq')).toBe(true);
    expect(isChoiceCard('definition')).toBe(true);
  });

  it('rejects the self-rate card and anything unknown', () => {
    // A card type the client does not recognise is skipped rather than
    // rendered as an empty grid.
    expect(isChoiceCard('self_rate')).toBe(false);
    expect(isChoiceCard('synonym_mcq')).toBe(false);
    expect(isChoiceCard(null)).toBe(false);
    expect(isChoiceCard(undefined)).toBe(false);
  });
});

describe('the definition card asks rather than tells', () => {
  const wordCard = () => fs.readFileSync(path.join(__dirname, '..', 'WordCard.tsx'), 'utf8');

  it('blanks the target word out of the example instead of highlighting it', () => {
    // The sentence is the second half of the question. Lighting the word up in
    // it would print the answer directly above the four options.
    const s = wordCard();
    expect(s).toMatch(/asking \? \(/);
    expect(s).toMatch(/s\.exampleBlank/);
  });

  it('shows the gloss instead of the headword', () => {
    expect(wordCard()).toMatch(/\{asking \? \(\s*\n[^]*?s\.definition/);
  });

  it('leaves an ordinary card untouched when no definition is passed', () => {
    // `asking` is derived from the prop, so a translation card cannot fall
    // into the definition branch by accident.
    expect(wordCard()).toMatch(/const asking = Boolean\(definition\)/);
  });
});

describe('the quiz surface is one plane', () => {
  const backdrop = () => fs.readFileSync(path.join(__dirname, '..', 'QuizBackdrop.tsx'), 'utf8');
  const card = () => fs.readFileSync(path.join(__dirname, '..', 'MCQCard.tsx'), 'utf8');

  it('draws a flat background, not a gradient', () => {
    // A gradient that ends is a line. This one started right below the
    // progress panel, so the two read as two surfaces with a seam between
    // them rather than as one screen.
    const s = backdrop();
    expect(s).not.toMatch(/LinearGradient|expo-linear-gradient/);
    expect(s).toMatch(/backgroundColor: tc\.background/);
  });

  it('takes the same ground as the practice path', () => {
    const practice = fs.readFileSync(
      path.join(__dirname, '..', '..', 'PracticeScreen.tsx'), 'utf8',
    );
    expect(practice).toMatch(/backgroundColor: tc\.background/);
    expect(backdrop()).toMatch(/backgroundColor: tc\.background/);
  });

  it('puts no rule or fade under the options', () => {
    const s = card();
    expect(s).not.toMatch(/borderTopWidth/);
    expect(s).not.toMatch(/LinearGradient/);
  });
});

describe('options and the CTA are the deck’s buttons', () => {
  const card = () => fs.readFileSync(path.join(__dirname, '..', 'MCQCard.tsx'), 'utf8');
  const choice = () => fs.readFileSync(path.join(__dirname, '..', 'MCQChoice.tsx'), 'utf8');

  it('makes the edge a full-height copy, not a strip', () => {
    // The bug: a 4pt box with a 14pt corner radius is not a thin slab, it is a
    // line — the radius eats the whole shape, so there was nothing under the
    // tile with any thickness to see. Copying the tile and offsetting it gives
    // the band square shoulders where the tile's own curve leaves off, which
    // is what the word deck's pills do.
    const s = choice();
    expect(s).toMatch(/edge: \{[^}]*top: EDGE,[^}]*bottom: 0,/);
    expect(s).not.toMatch(/height: edgeHeight/);
    const cta = card();
    expect(cta).toMatch(/ctaEdge: \{[^}]*top: CTA_EDGE,[^}]*bottom: 0,/);
    expect(cta).not.toMatch(/bottom: -5/);
  });

  it('moves only the face, so the band below shrinks rather than sliding', () => {
    const s = choice();
    expect(s).toMatch(/outputRange: \[0, EDGE - EDGE_PRESSED\]/);
    expect(card()).toMatch(/outputRange: \[0, CTA_EDGE - 1\]/);
  });

  it('gives every option a paper face, a rim and an edge', () => {
    const s = choice();
    expect(s).toMatch(/backgroundColor: tc\.paper/);
    expect(s).toMatch(/borderWidth: 1\.5/);
    expect(s).toMatch(/backgroundColor: edge/);
    // The gradient fill is gone: a 4pt vertical shift was doing the work the
    // edge already does.
    expect(s).not.toMatch(/LinearGradient|quizRaisedTop|quizRaisedBottom/);
  });

  it('builds the CTA the same way', () => {
    const s = card();
    expect(s).toMatch(/backgroundColor: tc\.paper/);
    expect(s).toMatch(/borderWidth: 1\.5/);
    expect(s).toMatch(/borderColor: ctaAccent/);
  });

  it('adopts the verdict’s colour on both', () => {
    // Right and wrong have to reach the controls, since the backdrop no longer
    // says it behind them.
    expect(choice()).toMatch(/isCorrect \? tc\.quizCorrectEdge : isWrong \? tc\.quizWrongEdge/);
    expect(card()).toMatch(/userWasCorrect\s*\n?\s*\? tc\.success\s*\n?\s*: tc\.error/);
  });
});
