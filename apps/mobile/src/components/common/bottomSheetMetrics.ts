/**
 * BottomSheet's own chrome, as numbers.
 *
 * Pure, like `navBarMetrics`, so a sheet's height can be added up in a test
 * without rendering one. `BottomSheet` styles itself from these; nothing else
 * should re-type them. The first sheet that needed its height checked was
 * `FeedFilterSheet`, which ran 53pt off the top of an iPhone SE with nothing
 * to notice — see `filmFeed/filterSheetMetrics`.
 */

/** Above the grabber. */
export const SHEET_PAD_TOP = 10;

/** The drag handle, and the space under it. */
export const SHEET_GRABBER = { height: 4, gap: 14 } as const;

/** The sheet's own bottom padding, before the bar's height is added. */
export const SHEET_PAD_BOTTOM = 24;

/** Left and right. */
export const SHEET_PAD_H = 20;
