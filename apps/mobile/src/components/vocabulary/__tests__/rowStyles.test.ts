import { ROW_ACTIONS_GAP, ROW_ICON_HIT_SLOP } from '../rowStyles';

describe('ROW_ICON_HIT_SLOP', () => {
  // Same defect as the card deck's speaker: a bare `Text onPress` on a 14pt
  // emoji, inside the row's own expand/collapse touchable, gives a target
  // barely bigger than the glyph — a near miss collapsed the row instead of
  // playing the word.

  it('cannot overlap a neighbouring action on either axis', () => {
    // `actionsRow` wraps, so when the actions spill onto a second line the
    // vertical spacing is ROW_ACTIONS_GAP too — which is why this row's slop
    // is bounded on both axes where the card footer's is bounded only
    // horizontally. Overlapping slop means the deeper view steals the tap.
    expect(ROW_ICON_HIT_SLOP.left + ROW_ICON_HIT_SLOP.right).toBeLessThanOrEqual(
      ROW_ACTIONS_GAP,
    );
    expect(ROW_ICON_HIT_SLOP.top + ROW_ICON_HIT_SLOP.bottom).toBeLessThanOrEqual(
      ROW_ACTIONS_GAP,
    );
  });

  it('actually enlarges the target', () => {
    for (const edge of Object.values(ROW_ICON_HIT_SLOP)) {
      expect(edge).toBeGreaterThan(0);
    }
  });
});
