/**
 * Every speaker in the app has to behave the same way.
 *
 * There are three now — the vocabulary row, the card deck's footer, and the
 * Explore word card — and the pronunciation feature's whole history is of one
 * of them drifting from the others. It shipped 401ing on both call sites at
 * once because the bearer token was decided per component; the tap target was
 * a bare `Text onPress` in one place and a padded `TouchableOpacity` in
 * another; and a missed `stopPropagation` turns a speaker tap into whatever
 * the surrounding card does instead.
 *
 * None of that is reachable from a unit test — the repo has no component
 * render library on purpose (see CLAUDE.md) — but all of it is visible in the
 * source, and a source guard runs on every push. So this asserts the contract
 * rather than the rendering.
 */

import fs from 'fs';
import path from 'path';

const COMPONENTS = path.join(__dirname, '..');

/** Every component that plays a word, found rather than listed. */
function speakerCallSites(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') speakerCallSites(full, out);
    } else if (/\.tsx$/.test(entry.name)) {
      const src = fs.readFileSync(full, 'utf8');
      if (/from '.*utils\/pronunciation'/.test(src)) out.push(full);
    }
  }
  return out;
}

const FILES = speakerCallSites(COMPONENTS);
const rel = (f: string) => path.relative(COMPONENTS, f);
const read = (f: string) => fs.readFileSync(f, 'utf8');

describe('pronunciation call sites', () => {
  it('finds all three (guards the guard)', () => {
    // If this drops to two, a speaker was deleted; if it grows, the new one
    // has to satisfy everything below.
    // Sorted, so the order follows the directory names: `wordFeed` came after
    // the rename that `explore` came before.
    expect(FILES.map(rel).sort()).toEqual([
      path.join('vocabulary', 'VocabRow.tsx'),
      path.join('vocabulary', 'WordCardDeck.tsx'),
      path.join('wordFeed', 'WordCard.tsx'),
    ]);
  });

  it.each(FILES.map(rel))('%s goes through the shared `pronounce` helper', (f) => {
    // Never a hand-rolled Audio source: the endpoint is bearer-gated, and
    // deciding where the token comes from per component is exactly how every
    // speaker in the app 401'd silently for months.
    const src = read(path.join(COMPONENTS, f));
    expect(src).toMatch(/\bpronounce\(/);
    expect(src).not.toMatch(/Audio\.Sound\.createAsync/);
  });

  it.each(FILES.map(rel))('%s gates the speaker behind premium', (f) => {
    // One feature, one entitlement. A speaker that is free in one surface and
    // premium in another reads as a bug to the user either way.
    expect(read(path.join(COMPONENTS, f))).toMatch(/useIsPremium/);
  });

  it.each(FILES.map(rel))('%s stops the tap propagating to the card', (f) => {
    // All three speakers sit inside a larger touchable — a row that expands, a
    // card that flips, a card that reveals a translation. Without this the
    // speaker does two things at once.
    expect(read(path.join(COMPONENTS, f))).toMatch(/stopPropagation\(\)/);
  });

  it.each(FILES.map(rel))('%s pads the tap target past the glyph', (f) => {
    // The original user report was "I can't tap on the speaker": the target
    // was the 13pt glyph itself, so a near miss hit the card behind it.
    //
    // Two ways to satisfy this now. The rows still declare their own slop —
    // their speaker is one of several small actions in a line, so its padding
    // is a local decision about its neighbours. The two cards render
    // `SpeakerChip`, which owns the slop for them; the assertion below pins
    // that the shared component actually carries it, so delegating to it is
    // not a way of losing it.
    const src = read(path.join(COMPONENTS, f));
    expect(src.includes('hitSlop=') || src.includes('<SpeakerChip')).toBe(true);
  });

  it('the shared chip is the padded target it promises to be', () => {
    expect(read(path.join(COMPONENTS, 'ui', 'SpeakerChip.tsx'))).toMatch(/hitSlop=\{HIT_SLOP\}/);
  });

  it.each(FILES.map(rel))('%s reports failure rather than swallowing it', (f) => {
    // `pronounce` never rejects — it resolves 'failed'. A call site that
    // ignores the result reproduces the original bug exactly: nothing plays
    // and nothing says so.
    expect(read(path.join(COMPONENTS, f))).toMatch(/pronounceFailed/);
  });
});

describe('the two cards share one speaker design', () => {
  const chip = () => read(path.join(COMPONENTS, 'ui', 'SpeakerChip.tsx'));

  it('keeps the appearance in the shared component, not the cards', () => {
    // The feed card and the deck card used to draw different speakers: a gold
    // filled disc on one, a 16pt textFaint glyph in the other's footer on the
    // other. That is the same drift `cefrColors` had — two copies of one
    // design, each individually reasonable, disagreeing in front of the user.
    const src = chip();
    expect(src).toMatch(/backgroundColor: playing \? tc\.gold : tc\.goldWash/);
    expect(src).toMatch(/borderColor: playing \? tc\.gold : tc\.goldLine/);
    expect(src).toMatch(/borderRadius: size \/ 2/);

    // Neither card may re-declare the fill.
    for (const f of ['wordFeed/WordCard.tsx', 'vocabulary/WordCardDeck.tsx']) {
      const card = read(path.join(COMPONENTS, f));
      expect(card).toMatch(/<SpeakerChip/);
      expect(card).not.toMatch(/speakerPlaying/);
    }
  });

  it('scales the glyph with the chip instead of taking a second size', () => {
    // The two cards are different sizes, so the diameter has to be theirs —
    // but the glyph-to-chip ratio is what makes them read as one control, so
    // that is not negotiable per call site.
    expect(chip()).toMatch(/size \* GLYPH_RATIO/);
  });

  it('puts the deck chip beside the word, not in the footer', () => {
    // "At the end of the word" is the whole point: in the footer it was a
    // small grey glyph three slots away from the thing it pronounces.
    const deck = read(path.join(COMPONENTS, 'vocabulary', 'WordCardDeck.tsx'));
    expect(deck).toMatch(/wordRow[^]{0,400}<SpeakerChip/);
    expect(deck).not.toMatch(/footerRow[^]{0,400}<SpeakerChip/);
  });
});
