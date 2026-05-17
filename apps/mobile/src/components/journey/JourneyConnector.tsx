/**
 * JourneyConnector — single SVG drawing the path lines between
 * adjacent tile centers across the full scroll content. Lives BEHIND
 * the tiles in z-order so the strokes appear to emerge from under
 * each frame instead of crossing it.
 *
 * Two reasons a segment renders solid gold:
 *   1. The segment is already completed (q.idx <= completedCount).
 *   2. Both endpoints are user-pick tiles (user-zone segments stay
 *      solid even when uncompleted, so user picks read as "real"
 *      rather than "not-real-yet").
 */

import Svg, { Line } from "react-native-svg";

interface Pt {
  idx: number;
  x: number;
  y: number;
  source?: "user" | "suggested";
}

interface Props {
  width: number;
  height: number;
  points: Pt[];
  completedCount: number;
}

export function JourneyConnector({ width, height, points, completedCount }: Props) {
  return (
    <Svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      pointerEvents="none"
      style={{ position: "absolute", top: 0, left: 0 }}
    >
      {points.slice(0, -1).map((p, i) => {
        const q = points[i + 1];
        const isDone = q.idx <= completedCount;
        const isUserSegment = p.source === "user" && q.source === "user";
        const isSolid = isDone || isUserSegment;
        return (
          <Line
            key={`conn-${p.idx}`}
            x1={p.x}
            y1={p.y}
            x2={q.x}
            y2={q.y}
            stroke={isSolid ? "#FFD166" : "rgba(255,255,255,0.18)"}
            strokeWidth={isSolid ? 2.5 : 1.5}
            strokeLinecap="round"
            strokeDasharray={isSolid ? undefined : "3 5"}
          ></Line>
        );
      })}
    </Svg>
  );
}
