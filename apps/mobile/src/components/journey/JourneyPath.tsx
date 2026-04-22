/**
 * JourneyPath — the winding "road" connecting all nodes.
 *
 * Rendered BEHIND the nodes (Layer B in the architecture). One SVG
 * <Path>, not a polyline — smooth Beziers read as a real road, per the
 * contract's "no linear staircase" rule. The path is drawn twice:
 *   - a wider, darker stroke for the contact shadow (ground contact)
 *   - a narrower, lighter stroke for the path surface itself
 * to preserve the dual-layer depth system even on the connector.
 */

import Svg, { Path } from 'react-native-svg';

export interface JourneyPathProps {
  pathD: string;
  width: number;
  height: number;
  /** Color of the path surface (on-top stroke). Defaults to a warm sand. */
  surfaceColor?: string;
  /** Color of the contact-shadow stroke under the path. */
  shadowColor?: string;
}

export function JourneyPath({
  pathD,
  width,
  height,
  surfaceColor = '#E8D9B5',
  shadowColor = 'rgba(0,0,0,0.18)',
}: JourneyPathProps) {
  if (!pathD) return null;
  return (
    <Svg
      width={width}
      height={height}
      style={{ position: 'absolute', top: 0, left: 0 }}
      pointerEvents="none"
    >
      {/* Contact shadow under the path — same geometry, wider and offset
          down by 3px to match the tile's contact shadow direction. */}
      <Path
        d={pathD}
        stroke={shadowColor}
        strokeWidth={16}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        translate="0,3"
      />
      {/* The path surface itself — the "road". Solid stroke with rounded
          caps so segment joins don't break the material feel. */}
      <Path
        d={pathD}
        stroke={surfaceColor}
        strokeWidth={12}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Thin top-left catchlight on the road — single highlight stroke
          offset up+left, keeps the global light source consistent. */}
      <Path
        d={pathD}
        stroke="rgba(255,255,255,0.35)"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        translate="-1,-1"
      />
    </Svg>
  );
}
