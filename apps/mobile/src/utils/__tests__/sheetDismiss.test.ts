/**
 * Pulling a sheet closed: when a drag is the sheet's, and when letting go of it
 * closes. Pure, so it is tested here rather than by driving a gesture.
 */

import {
  SHEET_CLAIM,
  SHEET_DISMISS_DY,
  SHEET_DISMISS_FRACTION,
  SHEET_DISMISS_VELOCITY,
  SHEET_RUBBER_BAND,
  sheetDismissOnRelease,
  sheetDragOffset,
  shouldClaimSheetDrag,
} from '../sheetDismiss';

/** The upgrade sheet's height on an iPhone SE (premiumSheetMetrics). */
const SE_SHEET = 508;

describe('claiming a drag', () => {
  it('leaves a tap to the button under the finger', () => {
    // A tap does not travel. Claiming on no movement would make every button
    // inside the sheet dead.
    expect(shouldClaimSheetDrag(0, 0)).toBe(false);
    expect(shouldClaimSheetDrag(1, SHEET_CLAIM)).toBe(false);
  });

  it('takes a vertical drag in either direction', () => {
    expect(shouldClaimSheetDrag(0, SHEET_CLAIM + 1)).toBe(true);
    // Up is claimed too, so it can rubber-band instead of doing nothing.
    expect(shouldClaimSheetDrag(0, -(SHEET_CLAIM + 1))).toBe(true);
  });

  it('leaves a mostly sideways movement alone', () => {
    expect(shouldClaimSheetDrag(40, 20)).toBe(false);
  });
});

describe('letting go', () => {
  it('closes past the distance threshold and not before it', () => {
    expect(sheetDismissOnRelease(SHEET_DISMISS_DY + 1, 0, SE_SHEET)).toBe(true);
    expect(sheetDismissOnRelease(SHEET_DISMISS_DY - 1, 0, SE_SHEET)).toBe(false);
  });

  it('asks a short sheet for a quarter of its height rather than the full cap', () => {
    const short = 300;
    const threshold = short * SHEET_DISMISS_FRACTION;
    expect(threshold).toBeLessThan(SHEET_DISMISS_DY);
    expect(sheetDismissOnRelease(threshold + 1, 0, short)).toBe(true);
    expect(sheetDismissOnRelease(threshold - 1, 0, short)).toBe(false);
  });

  it('closes on a fast flick down, however short the pull', () => {
    expect(sheetDismissOnRelease(10, SHEET_DISMISS_VELOCITY + 0.1, SE_SHEET)).toBe(true);
  });

  it('stays open when a long pull ends in a flick back up', () => {
    // The last thing the finger said was "no".
    expect(
      sheetDismissOnRelease(SHEET_DISMISS_DY + 80, -(SHEET_DISMISS_VELOCITY + 0.1), SE_SHEET),
    ).toBe(false);
  });

  it('never closes on an upward drag, even one that ends moving down', () => {
    expect(sheetDismissOnRelease(-200, 0, SE_SHEET)).toBe(false);
    expect(sheetDismissOnRelease(-10, SHEET_DISMISS_VELOCITY + 1, SE_SHEET)).toBe(false);
  });

  it('uses the cap before the sheet has measured itself', () => {
    // A zero height would otherwise make any downward twitch close the sheet.
    expect(sheetDismissOnRelease(10, 0, 0)).toBe(false);
    expect(sheetDismissOnRelease(SHEET_DISMISS_DY + 1, 0, 0)).toBe(true);
  });
});

describe('where the sheet follows the finger', () => {
  it('tracks a downward drag exactly', () => {
    expect(sheetDragOffset(0)).toBe(0);
    expect(sheetDragOffset(137)).toBe(137);
  });

  it('resists upward, approaching the band without reaching it', () => {
    expect(sheetDragOffset(-10)).toBeLessThan(0);
    expect(sheetDragOffset(-10)).toBeGreaterThan(-10);
    expect(sheetDragOffset(-10000)).toBeGreaterThan(-SHEET_RUBBER_BAND);
    // Pulling harder always moves it a little further, so it never feels stuck.
    expect(sheetDragOffset(-100)).toBeLessThan(sheetDragOffset(-50));
  });
});
