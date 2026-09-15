/**
 * The filter sheet fits on the shortest phones we ship to.
 *
 * It did not. Sort and film type were full-width rows under two lines of
 * explanation — 639pt of content — and the sheet pads the tab bar's height
 * inside itself on top of that. On an iPhone SE (667pt) its top edge sat 53pt
 * above the screen, measured on the simulator: the title and the Reset link
 * beside it could not be reached, and the search row painted over what was
 * left. `BottomSheet` has no maximum height and does not scroll, so nothing in
 * the app could notice.
 *
 * Every group is a grid of fixed-height cells now, and the sheet's height is a
 * sum of stated numbers (`filterSheetMetrics`). These tests hold that sum
 * against real phones and pin the source to the numbers, so a line of copy
 * added back to the sheet fails here instead of on a small phone.
 */

import fs from 'fs';
import path from 'path';
import { LEVEL_OPTIONS, MOVIE_TYPE_OPTIONS, SORT_OPTIONS } from '../filterOptions';
import {
  CHOICE_GAP,
  CHOICE_HEIGHT,
  LEVEL_COLUMNS,
  SORT_COLUMNS,
  TYPE_COLUMNS,
  choiceGridHeight,
  filterSheetHeight,
} from '../filterSheetMetrics';
import { navBarMetrics } from '../../navBarMetrics';
import { HEADER_CONTROL } from '../../ui/headerControl';

const DIR = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(DIR, rel), 'utf8');

/**
 * Where the search block ends, below the safe area: SearchBar's 6pt top
 * padding, its field (the shared header control height) and its 12pt bottom
 * padding. The filter and upgrade buttons in it are drawn above the sheet's
 * scrim on purpose, so the sheet must start below them. Pinned to SearchBar's
 * source further down.
 */
const SEARCH_BLOCK = 6 + HEADER_CONTROL.size + 12;

interface Phone {
  screenHeight: number;
  topInset: number;
  bottomInset: number;
  /** The iOS 26 floating capsule; Android and older iOS get the pinned bar. */
  glass: boolean;
}

const PHONES: [string, Phone][] = [
  ['iPhone 17 Pro', { screenHeight: 874, topInset: 62, bottomInset: 34, glass: true }],
  ['iPhone 13 mini', { screenHeight: 812, topInset: 50, bottomInset: 34, glass: true }],
  ['iPhone SE', { screenHeight: 667, topInset: 20, bottomInset: 0, glass: true }],
  ['Android 640, gesture nav', { screenHeight: 640, topInset: 24, bottomInset: 24, glass: false }],
  ['Android 640, 3-button nav', { screenHeight: 640, topInset: 24, bottomInset: 48, glass: false }],
];

const sheetOn = (p: Phone) =>
  filterSheetHeight({
    levels: LEVEL_OPTIONS.length,
    sorts: SORT_OPTIONS.length,
    types: MOVIE_TYPE_OPTIONS.length,
    bottomOffset: navBarMetrics(p.bottomInset, p.glass).reservedHeight,
  });

describe('the filter sheet on a short phone', () => {
  it.each(PHONES)('starts below the search block on %s', (_name, p) => {
    const top = p.screenHeight - sheetOn(p);
    expect(top).toBeGreaterThanOrEqual(p.topInset + SEARCH_BLOCK);
  });

  it('pins the height the SE gets', () => {
    // Deliberately brittle. It was ~720 on a 667pt screen; 491 puts the top
    // edge at 176. A block added to the sheet moves this number, and whoever
    // adds it decides whether the SE can afford it.
    const se = PHONES.find(([name]) => name === 'iPhone SE')![1];
    expect(sheetOn(se)).toBe(491);
  });
});

describe('every group is whole rows of fixed cells', () => {
  it('lays the level out as one row, the sorts as two, the film types as one', () => {
    expect(choiceGridHeight(LEVEL_OPTIONS.length, LEVEL_COLUMNS)).toBe(CHOICE_HEIGHT);
    expect(choiceGridHeight(SORT_OPTIONS.length, SORT_COLUMNS)).toBe(2 * CHOICE_HEIGHT + CHOICE_GAP);
    expect(choiceGridHeight(MOVIE_TYPE_OPTIONS.length, TYPE_COLUMNS)).toBe(CHOICE_HEIGHT);
  });

  it('keeps every cell a real tap target', () => {
    expect(CHOICE_HEIGHT).toBeGreaterThanOrEqual(44);
  });

  it('adds nothing for an empty group', () => {
    expect(choiceGridHeight(0, 3)).toBe(0);
  });
});

describe('the source is the arithmetic', () => {
  it('draws no full-width rows and no explanatory copy', () => {
    // The two lines that pushed the SE over, and the rows that made it worse.
    expect(read('FeedFilterSheet.tsx')).not.toMatch(/SheetOptionRow|scopeNote|recommendedNote/);
    expect(fs.existsSync(path.join(DIR, 'SheetOptionRow.tsx'))).toBe(false);
  });

  it('renders exactly three grids, with the columns the sum assumes', () => {
    const sheet = read('FeedFilterSheet.tsx');
    expect(sheet.match(/<SheetChoiceGrid/g) ?? []).toHaveLength(3);
    expect(sheet).toMatch(/columns=\{LEVEL_COLUMNS\}/);
    expect(sheet).toMatch(/columns=\{SORT_COLUMNS\}/);
    expect(sheet).toMatch(/columns=\{TYPE_COLUMNS\}/);
  });

  it('states its heights, so text cannot grow a row', () => {
    const sheet = read('FeedFilterSheet.tsx');
    expect(sheet).toMatch(/lineHeight: TITLE_LINE/);
    expect(sheet).toMatch(/marginTop: DONE_BUTTON\.gap/);
    expect(sheet).toMatch(/height: DONE_BUTTON\.height/);
    const grid = read('SheetChoiceGrid.tsx');
    expect(grid).toMatch(/height: CHOICE_HEIGHT/);
    expect(grid).toMatch(/lineHeight: SECTION_LABEL\.line/);
    // A long translation shrinks and wraps inside its cell rather than growing it.
    expect(grid).toMatch(/numberOfLines=\{mono \? 1 : 2\}/);
    expect(grid).toMatch(/adjustsFontSizeToFit/);
  });

  it('reads the search block it has to clear from SearchBar', () => {
    const bar = read('SearchBar.tsx');
    expect(bar).toMatch(/wrap: \{[\s\S]*?paddingTop: 6,\s*paddingBottom: 12,/);
    expect(bar).toMatch(/field: \{\s*height: HEADER_CONTROL\.size,/);
  });

  it('takes the bottom sheet chrome from the shared numbers', () => {
    const sheet = fs.readFileSync(path.join(DIR, '..', 'common', 'BottomSheet.tsx'), 'utf8');
    expect(sheet).toMatch(/paddingTop: SHEET_PAD_TOP/);
    expect(sheet).toMatch(/paddingBottom: SHEET_PAD_BOTTOM/);
    expect(sheet).toMatch(/height: SHEET_GRABBER\.height/);
    expect(sheet).toMatch(/marginBottom: SHEET_GRABBER\.gap/);
  });
});
