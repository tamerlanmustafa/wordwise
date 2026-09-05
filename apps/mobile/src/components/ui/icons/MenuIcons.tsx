/**
 * MenuIcon — the stroked icon set the account area uses.
 *
 * Lifted out of UserMenuSheet when the profile sheet became a full screen, so
 * the icons outlived the component that happened to define them. Same cinema /
 * reading-room system as Home, My Movies and the bottom bar: 1.6pt strokes,
 * round caps, currentColor. No emoji anywhere — see noEmoji.test.ts.
 */

import Svg, { Circle, Path, Rect } from 'react-native-svg';

// ── Stroked icon set (no emoji) — mirrors the cinema system used across
//    Home / My Movies / the bottom bar. ─────────────────────────────────
export type MenuIconName =
  | 'bell'
  | 'progress'
  | 'badge'
  | 'leaderboard'
  | 'lists'
  | 'film'
  | 'book'
  | 'settings'
  | 'admin'
  | 'logout'
  | 'trash'
  | 'chevron';

export function MenuIcon({ name, size = 18, color = '#000' }: { name: MenuIconName; size?: number; color?: string }) {
  const p = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (name) {
    // Same glyph the Home header used, so the bell is recognisable in its
    // new home rather than reading as a different feature.
    case 'bell':
      return (
        <Svg {...p}>
          <Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0" />
        </Svg>
      );
    case 'progress':
      return (
        <Svg {...p}>
          <Path d="M4 20h16" />
          <Path d="M6 20v-6M11 20V6M16 20v-9" />
        </Svg>
      );
    case 'badge':
      return (
        <Svg {...p}>
          <Circle cx={12} cy={9} r={5} />
          <Path d="M8.5 13L7 21l5-2.6L17 21l-1.5-8" />
        </Svg>
      );
    case 'leaderboard':
      return (
        <Svg {...p}>
          <Path d="M8 21h8M12 17v4" />
          <Path d="M7 4h10v4a5 5 0 0 1-10 0z" />
          <Path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3" />
        </Svg>
      );
    case 'lists':
      return (
        <Svg {...p}>
          <Path d="M9 6h11M9 12h11M9 18h11" />
          <Path d="M4 6h.01M4 12h.01M4 18h.01" />
        </Svg>
      );
    case 'film':
      return (
        <Svg {...p}>
          <Rect x={3} y={4} width={18} height={16} rx={2} />
          <Path d="M3 8h18M3 16h18M8 4v16M16 4v16" />
        </Svg>
      );
    case 'book':
      return (
        <Svg {...p}>
          <Path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6.5A1.5 1.5 0 0 0 5 20.5z" />
          <Path d="M5 17.5A1.5 1.5 0 0 1 6.5 16H19" />
        </Svg>
      );
    case 'settings':
      return (
        <Svg {...p}>
          <Path d="M4 7h9M17 7h3" />
          <Path d="M4 17h3M11 17h9" />
          <Circle cx={15} cy={7} r={2.2} />
          <Circle cx={9} cy={17} r={2.2} />
        </Svg>
      );
    case 'admin':
      return (
        <Svg {...p}>
          <Path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" />
          <Path d="M9 12l2 2 4-4" />
        </Svg>
      );
    case 'logout':
      return (
        <Svg {...p}>
          <Path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
          <Path d="M16 17l5-5-5-5M21 12H9" />
        </Svg>
      );
    case 'trash':
      return (
        <Svg {...p}>
          <Path d="M4 7h16" />
          <Path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          <Path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
          <Path d="M10 11v6M14 11v6" />
        </Svg>
      );
    case 'chevron':
    default:
      return (
        <Svg {...p}>
          <Path d="M9 6l6 6-6 6" />
        </Svg>
      );
  }
}
