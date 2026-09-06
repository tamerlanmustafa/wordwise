/**
 * The quiz's two "go forward" buttons — the per-card Next and the
 * end-of-session primary — share one design, and the card's is visibly
 * disabled until an answer is picked.
 *
 * Source-reading, not rendering: mobile tests are logic + integration only,
 * so like tileVisuals.test.ts this asserts on the components' source.
 */

import fs from 'fs';
import path from 'path';

const mcqCard = () =>
  fs.readFileSync(path.join(__dirname, '..', 'MCQCard.tsx'), 'utf8');
const sessionComplete = () =>
  fs.readFileSync(
    path.join(__dirname, '..', '..', 'common', 'SessionComplete.tsx'),
    'utf8',
  );

describe('the quiz card Next button is disabled by default', () => {
  it('is not pressable until an answer is picked', () => {
    expect(mcqCard()).toMatch(/const ctaEnabled = phase === 'answered'/);
    expect(mcqCard()).toMatch(/disabled=\{!ctaEnabled\}/);
  });

  it('looks disabled while idle, not like a tappable gold control', () => {
    const s = mcqCard();
    // Idle wears the faint rim + text and the border-grey edge; the verdict
    // colours only arrive once the phase is 'answered'.
    expect(s).toMatch(/phase === 'idle'\s*\n\s*\? tc\.textFaint/);
    expect(s).toMatch(/phase === 'idle'\s*\n\s*\? tc\.border/);
  });
});

describe('the end-of-quiz next button wears the card button\'s design', () => {
  it('is a paper face over a full-height edge, not a solid fill over a strip', () => {
    const s = sessionComplete();
    // Full-height edge copy offset by the same CTA_EDGE the card uses.
    expect(s).toMatch(/const CTA_EDGE = 4/);
    expect(s).toMatch(/primaryEdge: \{\s*\n\s*position: 'absolute',\s*\n\s*left: 0,\s*\n\s*right: 0,\s*\n\s*top: CTA_EDGE,\s*\n\s*bottom: 0,/);
    // Paper face with a rim, not a solid gold fill.
    expect(s).toMatch(/borderWidth: 1\.5,\s*\n\s*borderColor: tc\.success,\s*\n\s*backgroundColor: tc\.paper,/);
    expect(s).not.toMatch(/backgroundColor: tc\.gold,/);
  });

  it('sinks its face onto the edge on press, like the card button', () => {
    expect(sessionComplete()).toMatch(
      /translateY: ctaPress\.interpolate\(\{ inputRange: \[0, 1\], outputRange: \[0, CTA_EDGE - 1\] \}\)/,
    );
  });

  it('keeps the mono uppercase label, in the correct-answer accent', () => {
    const s = sessionComplete();
    expect(s).toMatch(/primaryBtnText: \{\s*\n\s*fontFamily: MONO_FAMILY,\s*\n\s*color: tc\.success,/);
    expect(s).toMatch(/textTransform: 'uppercase',/);
  });
});
