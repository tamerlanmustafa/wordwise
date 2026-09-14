/**
 * PressableScale puts layout where layout actually happens.
 *
 * The component is two views: an outer `Pressable` that takes the touch and an
 * inner `Animated.View` that scales. `style` belongs on the inner one, because
 * that is where padding, background and radius have to be for the press dip to
 * scale them — but the view that sits among its siblings is the OUTER one.
 *
 * So `flex: 1` on `style` stretched the inner view to fill a Pressable that was
 * itself only as wide as its content, and did nothing. That is what the
 * paywall's plan cards showed: two `flex: 1` cards in a row, each sized to its
 * text, a gap on the right, and a "7-DAY TRIAL" badge wrapped onto two lines
 * because its card was only as wide as "then $4.99/mo".
 *
 * `flexItemStyle` is the pure half of the fix, so it is what gets tested — the
 * suite is logic-only by project rule.
 */

import { StyleSheet } from 'react-native';

import { flexItemStyle } from '../PressableScale';

describe('flexItemStyle', () => {
  it('lifts flex onto the outer view', () => {
    // The paywall's plan card, reduced to the property that mattered.
    expect(flexItemStyle({ flex: 1, padding: 18, borderRadius: 16 })).toEqual({ flex: 1 });
  });

  it('lifts every property that positions an element among its siblings', () => {
    expect(
      flexItemStyle({ flexGrow: 1, flexShrink: 0, flexBasis: 120, alignSelf: 'stretch' }),
    ).toEqual({ flexGrow: 1, flexShrink: 0, flexBasis: 120, alignSelf: 'stretch' });
  });

  it('leaves visual properties on the inner view', () => {
    // Padding, fill and radius must stay where the scale transform applies,
    // or the press dip would shrink an empty box around unscaled content.
    const out = flexItemStyle({ padding: 18, backgroundColor: 'gold', borderRadius: 16 });
    expect(out).toBeUndefined();
  });

  it('leaves margins alone', () => {
    // A margin places the box identically from either view, and every
    // existing call site (EmptyState's marginTop, ReelReady's) uses them on
    // the inner one — moving them would be a change with no purpose.
    expect(flexItemStyle({ marginTop: 24 })).toBeUndefined();
  });

  it('reads through arrays and registered styles, which is how callers pass them', () => {
    const sheet = StyleSheet.create({ card: { flex: 1, padding: 14 } });
    expect(flexItemStyle([sheet.card, { borderColor: 'red' }])).toEqual({ flex: 1 });
    expect(flexItemStyle([sheet.card, false, null])).toEqual({ flex: 1 });
  });

  it('lets a later style override an earlier flex, as React Native does', () => {
    expect(flexItemStyle([{ flex: 1 }, { flex: 2 }])).toEqual({ flex: 2 });
  });

  it('keeps a zero, which is a real value and not an absence', () => {
    // `flexShrink: 0` is the common way to stop a button being squeezed; a
    // truthiness check would silently drop it.
    expect(flexItemStyle({ flexShrink: 0 })).toEqual({ flexShrink: 0 });
  });

  it('returns nothing for no style at all', () => {
    expect(flexItemStyle(undefined)).toBeUndefined();
    expect(flexItemStyle(null)).toBeUndefined();
  });
});
