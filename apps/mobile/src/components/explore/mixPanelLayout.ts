/**
 * How the mix panel's bands are sized for the panel height it is handed.
 *
 * The panel's height is not its own to choose — it comes from `exploreMetrics`
 * and must match the action rail exactly, which is 285pt on the reference
 * phone and ~224pt on a 4.7" one. The composition bar was drawn at 86pt for
 * the tall case, and 86 plus the title, the hint, the legend and the footer
 * does not fit in 224. Since the panel has `overflow: hidden` and deliberately
 * does not scroll, an over-tall layout is not a scrollbar — it is a clipped
 * Done button.
 *
 * So the bar is the *residual*: everything else is a fixed band, and the bar
 * takes what is left, clamped. Same trick as `metrics.ts` one level up — the
 * layout is a function of the viewport, which is what lets a test assert the
 * content fits on every phone without rendering anything.
 */

/** Panel padding, from MixPanel's stylesheet. Stated here too because the
 *  budget is meaningless without it; the two must move together. */
const PAD_TOP = 14;
const PAD_BOTTOM = 16;

/** "Word mix", 18pt serif at lineHeight 24. */
const TITLE = 24;
/** One line of 11.5pt hint at lineHeight 15, plus its marginTop. */
const HINT_LINE = 15;
const HINT_GAP = 2;
/** Clear space above the bar. */
const BAR_GAP = 10;
/** Legend row: 6pt marginTop over two mono lines (11 + 12). */
const LEGEND = 30;
/** The thin-level note: 4pt marginTop over one 15pt line. */
const NOTE = 19;
/** Footer: 1pt rule, 10pt paddingTop, a 34pt Done button. */
const FOOTER = 45;

/** The bar as drawn on the reference phone. */
const BAR_MAX = 86;
/** Below this the bar stops reading as a composition of six things — but it
 *  is still the control, so it wins over the note, which is dropped first. */
const BAR_MIN = 34;
/** Breathing room so nothing ends up touching the panel's rounded corner. */
const SLACK = 8;

/** Two lines of hint are worth more than the ~15pt they cost only when the
 *  bar is not the thing paying for them. */
const TWO_LINE_HINT_MIN_HEIGHT = 250;

export interface MixPanelLayout {
  /** Height for the composition bar. */
  barHeight: number;
  /** How many lines of hint copy the panel has room for. */
  hintLines: 1 | 2;
  /** Whether the thin-level note fits. It is the first thing cut. */
  showsNote: boolean;
  /** Every fixed band added up — never more than `height` minus padding,
   *  which is the property the test pins. */
  contentHeight: number;
}

export function mixPanelLayout(height: number, hasNote: boolean = false): MixPanelLayout {
  const available = Math.max(0, height - PAD_TOP - PAD_BOTTOM);
  const base = TITLE + BAR_GAP + LEGEND + FOOTER;

  const hintLines: 1 | 2 = height >= TWO_LINE_HINT_MIN_HEIGHT ? 2 : 1;
  const hint = HINT_GAP + hintLines * HINT_LINE;

  // The note only appears if it can be paid for out of slack rather than out
  // of the bar's minimum.
  const showsNote = hasNote && available - base - hint - BAR_MIN - NOTE >= 0;
  const note = showsNote ? NOTE : 0;

  const barHeight = Math.round(
    Math.min(Math.max(available - base - hint - note - SLACK, BAR_MIN), BAR_MAX),
  );

  return {
    barHeight,
    hintLines,
    showsNote,
    contentHeight: base + hint + note + barHeight,
  };
}
