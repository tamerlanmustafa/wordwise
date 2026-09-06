/**
 * FilmFeedIcons — the stroked SVG icon set for the redesigned Home screen.
 *
 * Mirrors the `Icon` set in the design template (home/home-mobile.jsx),
 * translated to `react-native-svg`. Every glyph here replaces an emoji the
 * old Home used (🔍 search, ▶ play, ⭐ star, ☆/★ save, 🔔 bell, etc.) so the
 * screen carries no emoji — matching the cinema system on My Movies /
 * Practice / Quiz.
 *
 * Default stroke 2.0, rounded caps/joins, 18px. `star`/`play` render filled.
 */

import Svg, { Circle, Path } from 'react-native-svg';

export type HomeIconName =
  | 'search'
  | 'close'
  | 'chevron'
  | 'play'
  | 'bookmark'
  | 'check'
  | 'star'
  | 'bell'
  | 'filter';

interface Props {
  name: HomeIconName;
  size?: number;
  color?: string;
  /** Stroke width — defaults to 2.0 (rounded caps), per the design set. */
  sw?: number;
}

export function HomeIcon({ name, size = 18, color = '#000', sw = 2 }: Props) {
  const stroke = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth: sw,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  // Filled glyphs (no stroke) — star + play.
  const filled = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: color,
  };

  switch (name) {
    case 'search':
      return (
        <Svg {...stroke}>
          <Circle cx={11} cy={11} r={7} />
          <Path d="M21 21l-4.3-4.3" />
        </Svg>
      );
    case 'close':
      return (
        <Svg {...stroke}>
          <Path d="M6 6l12 12M18 6L6 18" />
        </Svg>
      );
    case 'chevron':
      return (
        <Svg {...stroke}>
          <Path d="M6 9l6 6 6-6" />
        </Svg>
      );
    case 'play':
      return (
        <Svg {...filled}>
          <Path d="M8 5v14l11-7z" />
        </Svg>
      );
    case 'bookmark':
      return (
        <Svg {...stroke}>
          <Path d="M6 4h12v16l-6-4-6 4z" />
        </Svg>
      );
    case 'check':
      return (
        <Svg {...stroke}>
          <Path d="M5 12l4 4 10-10" />
        </Svg>
      );
    case 'star':
      return (
        <Svg {...filled}>
          <Path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.3L12 17.3 6.4 20.3l1.1-6.3L3 9.6l6.2-.9z" />
        </Svg>
      );
    case 'bell':
      return (
        <Svg {...stroke}>
          <Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0" />
        </Svg>
      );
    // Sliders, not a funnel: the sheet behind it sets *values* (which sort,
    // which film type) rather than narrowing a list down, and the knobs read
    // as adjustable at 18px where a funnel reads as a solid blob.
    case 'filter':
      return (
        <Svg {...stroke}>
          <Path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
          <Circle cx={16} cy={7} r={2.2} />
          <Circle cx={8} cy={17} r={2.2} />
        </Svg>
      );
    default:
      return null;
  }
}
