/**
 * Bare glyphs for the Explore action rail.
 *
 * No chip, no border, no background — the rail sits directly on the feed
 * surface, so these are stroke-only shapes at full text contrast. The
 * active state fills with gold and strokes gold, which is the only visual
 * feedback the rail gives (there is no toast on save).
 */

import Svg, { Circle, Path } from 'react-native-svg';

export type RailGlyph = 'sliders' | 'heart' | 'send';

interface Props {
  kind: RailGlyph;
  size: number;
  stroke: string;
  /** Gold when the action is on (saved). Undefined leaves the glyph hollow. */
  fill?: string;
}

export function RailIcon({ kind, size, stroke, fill }: Props) {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke,
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  if (kind === 'sliders') {
    return (
      <Svg {...props}>
        <Path d="M4 6h10M18 6h2M4 12h3M11 12h9M4 18h8M16 18h4" />
        <Circle cx="16" cy="6" r="2" fill={fill ?? 'none'} />
        <Circle cx="9" cy="12" r="2" fill={fill ?? 'none'} />
        <Circle cx="14" cy="18" r="2" fill={fill ?? 'none'} />
      </Svg>
    );
  }

  if (kind === 'heart') {
    return (
      <Svg {...props}>
        <Path
          d="M12 20.3l-1.5-1.35C5.4 14.36 2 11.28 2 7.5 2 4.42 4.42 2 7.5 2c1.74 0 3.41.81 4.5 2.09C13.09 2.81 14.76 2 16.5 2 19.58 2 22 4.42 22 7.5c0 3.78-3.4 6.86-8.5 11.45z"
          fill={fill ?? 'none'}
        />
      </Svg>
    );
  }

  // send — paper plane
  return (
    <Svg {...props}>
      <Path d="M21.5 2.5L2 10.2l7.6 2.9M21.5 2.5l-7.7 19-3.2-7.4M21.5 2.5L9.6 13.1" fill={fill ?? 'none'} />
    </Svg>
  );
}
