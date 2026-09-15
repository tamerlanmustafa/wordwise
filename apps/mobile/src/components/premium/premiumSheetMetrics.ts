/**
 * PremiumSheet's height, as arithmetic.
 *
 * The sheet used to scroll. Every feature carried a line of description under
 * its title, and the bottom was padded by the tab bar's height — for a bar the
 * sheet is drawn over, since it mounts after the bar at the app root. That came
 * to ~870pt of content on a 667pt iPhone SE, inside a sheet capped at 86% of
 * the screen, so the plan cards, the buy button and the way out were all below
 * the fold on exactly the phones with the least room.
 *
 * Every block now states its height, a feature is one line, and the sheet pads
 * only the safe area. The sum below IS the layout rather than a guess at what
 * the copy wraps to, so a test can hold it against the shortest phones we ship
 * to (`premiumSheetFits.test`), the arrangement `filmFeed/filterSheetMetrics`
 * uses. The text whose length depends on the language caps its line count and
 * shrinks to fit instead of growing its block.
 *
 * Pure on purpose.
 */

export const PREMIUM_SHEET = {
  /** Above the grabber. */
  padTop: 8,
  grabber: { height: 4, gap: 8 },
  /** "WordWise Plus". */
  eyebrow: { line: 12 },
  /** The headline. Two lines in every language: the copy carries its own break. */
  hero: { gap: 4, size: 22, line: 27, lines: 2 },
  /** Why the sheet opened. At most two lines; a long translation shrinks. */
  sub: { gap: 4, size: 12.5, line: 17, lines: 2 },
  /** The annual and monthly cards. `gap` includes the badges' 10pt overhang. */
  plans: { gap: 14, height: 96 },
  /** "Or pay once". */
  lifetime: { gap: 8, height: 38 },
  /** The buy button: its face, and the pill's edge under it. */
  cta: { gap: 10, height: 46, edge: 4 },
  /**
   * The price and renewal terms under the button. A fixed two-line box rather
   * than a two-line cap: the text changes with the selected plan, and a box
   * that grew by a line would move the whole sheet under the finger that just
   * picked the plan.
   */
  hint: { gap: 6, line: 14, lines: 2 },
  /** One line per feature. */
  features: { gap: 10, row: 21 },
  /** Restore purchases · Later. */
  footer: { gap: 8, line: 18 },
  /** Below the footer, above the safe area. */
  padBottom: 10,
  /**
   * The least scrim left showing above the sheet, below the status bar, so it
   * still reads as a sheet over the app and there is somewhere to tap outside
   * it.
   */
  topClearance: 12,
} as const;

/** The whole sheet, from the bottom of the screen to its top edge. */
export function premiumSheetHeight({
  features,
  bottomInset,
}: {
  /** How many feature rows it lists. */
  features: number;
  /** The safe area below it: the home indicator, or Android's navigation bar. */
  bottomInset: number;
}): number {
  const p = PREMIUM_SHEET;
  return (
    p.padTop +
    p.grabber.height +
    p.grabber.gap +
    p.eyebrow.line +
    p.hero.gap +
    p.hero.line * p.hero.lines +
    p.sub.gap +
    p.sub.line * p.sub.lines +
    p.plans.gap +
    p.plans.height +
    p.lifetime.gap +
    p.lifetime.height +
    p.cta.gap +
    p.cta.height +
    p.cta.edge +
    p.hint.gap +
    p.hint.line * p.hint.lines +
    p.features.gap +
    p.features.row * features +
    p.footer.gap +
    p.footer.line +
    p.padBottom +
    bottomInset
  );
}

/** The height the sheet may take: the screen, less the status bar and the
 *  clearance kept above the sheet. */
export function premiumSheetRoom({
  screenHeight,
  topInset,
}: {
  screenHeight: number;
  topInset: number;
}): number {
  return screenHeight - topInset - PREMIUM_SHEET.topClearance;
}
