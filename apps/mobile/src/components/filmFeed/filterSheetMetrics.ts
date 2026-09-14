/**
 * FeedFilterSheet's height, as arithmetic.
 *
 * The sheet used to hold its sort and film-type groups as full-width rows —
 * 48pt each, one with a second line of copy — under a level ladder with a
 * two-line explanation above it. That came to 639pt of content, and
 * `BottomSheet` adds the tab bar's height inside the sheet on top of it (81pt
 * on an iPhone SE). On a 667pt screen the sheet's top edge sat 53pt above the
 * top of the screen: the title and the Reset link beside it could not be
 * reached, and the search row — drawn above the sheet's scrim on purpose —
 * painted over what was left of the top.
 *
 * `BottomSheet` has no maximum height and does not scroll, so nothing stopped
 * it. The fix is in the content: every group is a grid of fixed-height cells
 * (`SheetChoiceGrid`) and the explanatory copy is gone, so the sum below IS
 * the layout rather than a guess at what the copy wraps to, and a test can
 * hold it against the shortest phones we ship to.
 *
 * Pure on purpose, same as `vocabulary/deckMetrics`.
 */

import { SHEET_GRABBER, SHEET_PAD_BOTTOM, SHEET_PAD_TOP } from '../common/bottomSheetMetrics';

/** One cell. 44, the stores' minimum tap target — the cells are the controls. */
export const CHOICE_HEIGHT = 44;
/** Between cells, across and down. */
export const CHOICE_GAP = 6;

/** Six CEFR codes in one row: a scale, not a menu. */
export const LEVEL_COLUMNS = 6;
/** Four sorts in two rows. One row of four would shrink "Recommended" past
 *  legible on a 375pt phone, and further in Portuguese. */
export const SORT_COLUMNS = 2;
/** All films · Animation · Live action. */
export const TYPE_COLUMNS = 3;

/** "Filter films", with Reset beside it once something is set. A stated line
 *  height, so the row is the same height on both platforms. */
export const TITLE_LINE = 22;

/** The small uppercase label above each group. */
export const SECTION_LABEL = { top: 14, line: 12, bottom: 4 } as const;

/** Done, and the space above it. */
export const DONE_BUTTON = { gap: 16, height: 48 } as const;

/** Laid-out height of `count` cells in rows of `columns`. */
export function choiceGridHeight(count: number, columns: number): number {
  if (count <= 0 || columns <= 0) return 0;
  const rows = Math.ceil(count / columns);
  return rows * CHOICE_HEIGHT + (rows - 1) * CHOICE_GAP;
}

/**
 * The whole sheet, from the bottom of the screen to its top edge.
 * `bottomOffset` is the tab bar's reserved height, which the sheet pads inside
 * itself because the bar is drawn over it.
 */
export function filterSheetHeight({
  levels,
  sorts,
  types,
  bottomOffset,
}: {
  levels: number;
  sorts: number;
  types: number;
  bottomOffset: number;
}): number {
  const label = SECTION_LABEL.top + SECTION_LABEL.line + SECTION_LABEL.bottom;
  return (
    SHEET_PAD_TOP +
    SHEET_GRABBER.height +
    SHEET_GRABBER.gap +
    TITLE_LINE +
    label +
    choiceGridHeight(levels, LEVEL_COLUMNS) +
    label +
    choiceGridHeight(sorts, SORT_COLUMNS) +
    label +
    choiceGridHeight(types, TYPE_COLUMNS) +
    DONE_BUTTON.gap +
    DONE_BUTTON.height +
    SHEET_PAD_BOTTOM +
    bottomOffset
  );
}
