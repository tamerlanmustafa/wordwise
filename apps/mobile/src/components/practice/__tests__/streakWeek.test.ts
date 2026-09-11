/**
 * The Practice header must not resize after the network answers.
 *
 * `PracticeScreen`'s header has always stated its height rather than letting
 * content size it, and the reason is recorded there: everything above the tile
 * path moves every tile below it, and the path bottom-anchors itself once per
 * cursor on `onContentSizeChange`. The old header held two chips whose only
 * variable content was a number; the new one holds a week strip whose entire
 * contents arrive from `/daily/state`. That makes the constraint stricter, not
 * looser — a panel that grows when the response lands shoves the tile path
 * down under the user's thumb.
 *
 * Source-reading, because there is no component-render library in this suite by
 * project rule.
 */

import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(SRC, ...p), 'utf8');
const panel = () => read('components', 'practice', 'StreakWeek.tsx');
const screen = () => read('components', 'PracticeScreen.tsx');

describe('the week panel is a fixed box', () => {
  it('states its height as a constant', () => {
    expect(panel()).toMatch(/export const WEEK_PANEL_H = \d+;/);
    expect(panel()).toMatch(/height: WEEK_PANEL_H/);
  });

  it('the header derives its height from that constant', () => {
    // Not a second hardcoded number — the two would drift, and the symptom
    // would be a gap or a clipped panel that nobody traces back to here.
    expect(screen()).toMatch(/const HEADER_H = WEEK_PANEL_H \+ \d+;/);
    expect(screen()).toMatch(/height: HEADER_H/);
  });

  it('never sizes the header to its content', () => {
    const style = screen().slice(screen().indexOf('    header: {'));
    const block = style.slice(0, style.indexOf('},'));
    expect(block).not.toMatch(/minHeight|flexGrow|height: 'auto'/);
  });
});

describe('the seven states are all drawn, and drawn differently', () => {
  it('has a distinct style for done and for frozen', () => {
    // Both keep the streak alive, so collapsing them is the tempting
    // simplification. It would report a freeze that WORKED as a gap — on the
    // one mechanic the user is being asked to trust.
    const s = panel();
    expect(s).toMatch(/cellDone: \{/);
    expect(s).toMatch(/cellFrozen: \{/);
    const done = s.slice(s.indexOf('cellDone: {'), s.indexOf('cellFuture: {'));
    expect(done).toMatch(/cellFrozen/);
    // …and they must not be the same declaration.
    expect(s).not.toMatch(/cellDone: cellFrozen|cellFrozen: cellDone/);
  });

  it('treats missed as the default rather than a state it must be told', () => {
    // A day the server did not describe should read as empty, not as a claim.
    const s = panel();
    const base = s.slice(s.indexOf('    cell: {'), s.indexOf('    cellDone: {'));
    expect(base).toMatch(/backgroundColor: 'transparent'/);
  });

  it('marks today separately from the day states', () => {
    // `is_today` is orthogonal: today can be done, missed or frozen, and the
    // ring has to survive all three.
    expect(panel()).toMatch(/day\?\.is_today && s\.cellToday/);
  });
});

describe('the weekday letters come from the locale files', () => {
  it('does not reach for Intl', () => {
    // React Native's Hermes build has shipped without full ICU, so
    // `Intl.DateTimeFormat(..., { weekday })` is not dependable here — it
    // degrades to English or throws, on a string in every user's face.
    expect(panel()).not.toMatch(/Intl\./);
    expect(panel()).toMatch(/practice:weekday\./);
  });

  it('every locale supplies all seven, Monday first', () => {
    const localesDir = path.join(SRC, 'i18n', 'locales');
    const langs = fs.readdirSync(localesDir)
      .filter((d) => fs.existsSync(path.join(localesDir, d, 'practice.json')));
    expect(langs.length).toBeGreaterThanOrEqual(5);
    for (const lang of langs) {
      const ns = JSON.parse(read('i18n', 'locales', lang, 'practice.json'));
      expect(Object.keys(ns.weekday ?? {})).toEqual(
        ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
      );
      for (const [day, letter] of Object.entries(ns.weekday)) {
        expect(typeof letter).toBe('string');
        expect((letter as string).length).toBeGreaterThan(0);
        expect(day).toBeTruthy();
      }
    }
  });

  it('is Monday-first, matching the server that builds the week', () => {
    // `week_bounds` returns Monday–Sunday. A client that labelled them
    // Sunday-first would draw the right data under the wrong letters — the
    // kind of bug that looks like a data bug for a long time.
    expect(panel()).toMatch(/\['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'\]/);
  });
});
