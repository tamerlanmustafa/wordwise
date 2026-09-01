/**
 * TileRing — the ring of dots that turns slowly around the active tile.
 *
 * This used to be a `View` with `borderStyle: 'dashed'` and a border radius,
 * which is why it never looked round: React Native draws a dashed border by
 * stroking the *border box*, so the dashes bunch and flatten where the
 * rounding starts — visibly a rounded rectangle on Android and a lumpy oval
 * on iOS. One SVG circle has no corners to bunch at.
 *
 * Two details do the rest of the work:
 *   • Round stroke caps on zero-length dashes render each dash as a true
 *     circle, so they are *dots*, not tick marks.
 *   • The dot count is chosen so the gap divides the circumference exactly
 *     (see {@link ringDashes}). A dash pattern that doesn't tile leaves one
 *     short gap where the stroke closes — a seam that walks around the ring
 *     as it rotates, which is exactly the thing the eye catches.
 *
 * The ring is a perfect circle while the tile it surrounds is a wide ellipse,
 * so it sits closer at the sides than at top and bottom — the same halo
 * Duolingo draws around its active node.
 */

import Svg, { Circle } from 'react-native-svg';

/** Diameter of the ring around a {@link COIN_W}-wide coin. */
export const RING_SIZE = 88;
/** Dot diameter (the stroke width). */
const DOT = 3.5;
/** Target centre-to-centre spacing; the real one is rounded to fit exactly. */
const DOT_SPACING = 11;
/** Dash length. Zero would be dropped by some rasterisers; this is a point. */
const DASH = 0.1;

/**
 * How many dots fit around a circle of `radius` at roughly `spacing` apart,
 * and the exact step that divides the circumference by that count. Pure and
 * exported for testing: the invariant that `count * step` is the whole
 * circumference is what keeps the ring seamless.
 */
export function ringDashes(radius: number, spacing: number): { count: number; step: number } {
  const circumference = 2 * Math.PI * radius;
  const count = Math.max(6, Math.round(circumference / spacing));
  return { count, step: circumference / count };
}

export interface TileRingProps {
  color: string;
  /** Overall diameter. Defaults to {@link RING_SIZE}. */
  size?: number;
}

export function TileRing({ color, size = RING_SIZE }: TileRingProps) {
  // Inset by half the stroke so the dots sit inside the box rather than
  // being clipped in half by the SVG viewport.
  const r = (size - DOT) / 2;
  const { step } = ringDashes(r, DOT_SPACING);
  return (
    <Svg width={size} height={size} pointerEvents="none">
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={DOT}
        strokeLinecap="round"
        strokeDasharray={[DASH, step - DASH]}
      />
    </Svg>
  );
}
