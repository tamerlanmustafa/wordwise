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

describe('the panel never draws "not loaded yet" as facts', () => {
  // Measured on the first tap of Practice after a cold start: "0 DAYS", an
  // unlit flame, "0/0 FREEZES" and seven empty circles until the request
  // landed, then the real 41. Every piece of that was a claim about the user.

  it('draws a placeholder for a null state, not zeros', () => {
    const s = panel();
    expect(s).toMatch(/if \(!state\) return <StreakWeekPlaceholder/);
    // The old shape: a number with a fallback that was 0 before hydration.
    expect(s).not.toMatch(/fallbackStreak/);
    expect(s).not.toMatch(/state\?\.streak \?\?/);
  });

  it('gives the placeholder the real panel’s geometry, not numbers of its own', () => {
    // A placeholder that states its own sizes drifts from what it stands in
    // for, and the panel below re-lays-out when the data lands.
    const s = panel();
    const ph = s.slice(s.indexOf('function StreakWeekPlaceholder'), s.indexOf('const makeStyles'));
    expect(ph).toMatch(/style=\{s\.panel\}/);
    expect(ph).toMatch(/width=\{FLAME\} height=\{FLAME\}/);
    expect(ph).toMatch(/width=\{CELL\} height=\{CELL\}/);
    expect(s).toMatch(/fontSize: STREAK_SIZE/);
    expect(s).toMatch(/fontSize: FREEZE_SIZE/);
  });

  it('opens on the last known state, loaded before the tab can be tapped', () => {
    const s = screen();
    expect(s).toMatch(/<StreakWeek state=\{displayState\}/);
    expect(s).toMatch(/serverState \?\? \(snapshot \? carryForward\(snapshot/);
    // Hydrated at launch — a read started when the lazy tab mounts resolves a
    // frame after its first paint, which is the same flash, shorter.
    expect(read('core', 'App.tsx')).toMatch(/useStreakSnapshotStore\.getState\(\)\.hydrate\(\)/);
  });

  it('keeps the free tier’s lesson gate on the live answer only', () => {
    // A carried-forward copy is for display. An unverified copy is not grounds
    // to tell someone today's lesson is used up.
    const s = screen();
    expect(s).toMatch(/if \(!isPremium && serverState\?\.today_done\)/);
    expect(s).not.toMatch(/displayState\?\.today_done/);
  });

  it('forgets the snapshot on sign-out', () => {
    expect(read('services', 'accountState.ts')).toMatch(/useStreakSnapshotStore\.getState\(\)\.reset\(\)/);
  });
});

describe('the date is drawn inside each circle', () => {
  it('puts the number inside the cell, not in a new row that would grow the panel', () => {
    // The panel's height is load-bearing (see the top of this file). A date
    // row under the circles would push the tile path; inside the circle it
    // costs no height at all.
    const s = panel();
    expect(s).toMatch(/dayOfMonth\(day\?\.date\)/);
    const cellOpen = s.indexOf('s.cellToday,');
    const cellClose = s.indexOf('</View>', cellOpen);
    expect(s.slice(cellOpen, cellClose)).toContain('{date}');
  });

  it('keeps the frozen fill off the circle itself, so the date is not faded with it', () => {
    // `opacity` on the circle applied to everything inside it. The fill is a
    // layer now, and the circle carries no opacity of its own.
    const s = panel();
    const frozen = s.slice(s.indexOf('cellFrozen: {'), s.indexOf('cellFuture: {'));
    const cellFrozenDecl = frozen.slice(0, frozen.indexOf('}'));
    expect(cellFrozenDecl).not.toMatch(/opacity/);
    expect(s).toMatch(/frozenFill: \{[\s\S]*?opacity: 0\.45/);
  });

  it('never draws white on the gold fill', () => {
    // White on this gold measures about 2:1.
    const s = panel();
    expect(s).toMatch(/inkOnGold: \{ color: tc\.goldDeep \}/);
  });

  it('caps text scaling inside the fixed circle', () => {
    expect(panel()).toMatch(/maxFontSizeMultiplier=\{1\.25\}/);
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
