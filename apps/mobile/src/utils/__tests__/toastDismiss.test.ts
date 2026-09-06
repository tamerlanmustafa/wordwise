import {
  rubberBand,
  shouldClaimToastDrag,
  toastDismissOnRelease,
  TOAST_CLAIM,
  TOAST_DISMISS_DX,
  TOAST_DISMISS_DY,
  TOAST_DISMISS_VELOCITY,
  TOAST_RUBBER_BAND,
} from '../toastDismiss';

describe('shouldClaimToastDrag', () => {
  it('ignores the jitter in a tap', () => {
    // The toast's action button ("Undo") is inside the draggable area, so a
    // claim threshold of 0 would turn every Undo press into a one-pixel drag
    // and the press would never land.
    expect(shouldClaimToastDrag(0, 0)).toBe(false);
    expect(shouldClaimToastDrag(TOAST_CLAIM, TOAST_CLAIM)).toBe(false);
  });

  it('claims in any direction, unlike a feed row', () => {
    // A SwipeableRow has to let vertical drags through to the list. Nothing
    // scrolls under a toast, so it takes whatever it is given.
    expect(shouldClaimToastDrag(TOAST_CLAIM + 1, 0)).toBe(true);
    expect(shouldClaimToastDrag(0, TOAST_CLAIM + 1)).toBe(true);
    expect(shouldClaimToastDrag(0, -(TOAST_CLAIM + 1))).toBe(true);
  });
});

describe('toastDismissOnRelease', () => {
  it('springs back when the drag went nowhere', () => {
    expect(toastDismissOnRelease(0, 0, 0, 0)).toBeNull();
    expect(toastDismissOnRelease(TOAST_DISMISS_DX, 0, 0, 0)).toBeNull();
  });

  it('dismisses sideways past the distance threshold', () => {
    expect(toastDismissOnRelease(TOAST_DISMISS_DX + 1, 0, 0, 0)).toBe('end');
    expect(toastDismissOnRelease(-(TOAST_DISMISS_DX + 1), 0, 0, 0)).toBe('start');
  });

  it('dismisses upward past the (smaller) vertical threshold', () => {
    expect(toastDismissOnRelease(0, -(TOAST_DISMISS_DY + 1), 0, 0)).toBe('up');
  });

  it('never dismisses downward, however hard it is thrown', () => {
    // Down is where the toast came from. A downward throw is the gesture that
    // most looks like dragging it further out, so it must not delete it.
    expect(toastDismissOnRelease(0, 200, 0, 0)).toBeNull();
    expect(toastDismissOnRelease(0, 200, 0, TOAST_DISMISS_VELOCITY + 1)).toBeNull();
  });

  it('takes a flick that did not travel far', () => {
    expect(toastDismissOnRelease(4, 0, TOAST_DISMISS_VELOCITY + 0.1, 0)).toBe('end');
    expect(toastDismissOnRelease(0, -4, 0, -(TOAST_DISMISS_VELOCITY + 0.1))).toBe('up');
  });

  it('lets the dominant axis win a diagonal sweep', () => {
    // A real thumb swiping sideways drifts upward, and the vertical threshold
    // is the smaller of the two — so distance alone would classify a mostly
    // horizontal sweep as "up" and fly the toast out through the wrong edge.
    expect(toastDismissOnRelease(120, -40, 0, 0)).toBe('end');
    expect(toastDismissOnRelease(-120, -40, 0, 0)).toBe('start');
    // …and the reverse: mostly vertical stays vertical.
    expect(toastDismissOnRelease(40, -120, 0, 0)).toBe('up');
  });

  it('falls back to the flick direction at dx exactly 0', () => {
    expect(toastDismissOnRelease(0, 0, TOAST_DISMISS_VELOCITY + 1, 0)).toBe('end');
    expect(toastDismissOnRelease(0, 0, -(TOAST_DISMISS_VELOCITY + 1), 0)).toBe('start');
  });
});

describe('rubberBand', () => {
  it('leaves upward drags alone', () => {
    expect(rubberBand(-50)).toBe(-50);
    expect(rubberBand(0)).toBe(0);
  });

  it('resists downward drags without ever stopping dead', () => {
    // Monotonic and bounded: the toast keeps answering the finger, so the
    // gesture reads as a closed axis rather than as a dropped touch.
    expect(rubberBand(10)).toBeGreaterThan(0);
    expect(rubberBand(10)).toBeLessThan(10);
    expect(rubberBand(400)).toBeGreaterThan(rubberBand(100));
    expect(rubberBand(10_000)).toBeLessThan(TOAST_RUBBER_BAND);
  });
});
