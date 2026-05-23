/**
 * LessonConnector — v0.7 Practice tab connector between two lesson nodes.
 *
 * Renders an SVG line that spans the vertical gap between two adjacent
 * nodes in a zigzag unit path. `tc.gold` solid when the previous lesson
 * is `done`; `tc.divider` dashed (4 6) otherwise. Width spans both x
 * offsets so the line drifts diagonally with the zigzag.
 *
 * Spec: `tabs/practice.jsx → Connector`.
 */

import Svg, { Line } from 'react-native-svg';
import { useThemeColors } from '../../theme/tokens';

export interface LessonConnectorProps {
  /** x-offset of the previous node from the path's center, in px. */
  prevOffset: number;
  /** x-offset of the current node from the path's center, in px. */
  currOffset: number;
  /** Whether the previous node is `done` (drives color + dash). */
  prevDone: boolean;
}

const W = 200;
const H = 58;
const CENTER = W / 2;

export function LessonConnector({ prevOffset, currOffset, prevDone }: LessonConnectorProps) {
  const tc = useThemeColors();
  const color = prevDone ? tc.gold : tc.divider;
  const dash = prevDone ? undefined : '4 6';
  const stroke = prevDone ? 4 : 3;

  return (
    <Svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      // Vertical bleed by -14 each side so the line tucks behind the
      // 76px hit areas of the two nodes it connects. Matches the JSX.
      style={{ marginTop: -14, marginBottom: -14, alignSelf: 'center' }}
      pointerEvents="none"
    >
      <Line
        x1={CENTER + prevOffset}
        y1={0}
        x2={CENTER + currOffset}
        y2={H}
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={dash}
        strokeLinecap="round"
      />
    </Svg>
  );
}
