/**
 * JourneyReelBackground — purely visual film-strip substrate for the
 * Journey Reel screen. Fixed to the viewport: stock, radial light,
 * warm leaks, grain, dust, gutters and scratches all belong to the
 * "viewing window," not the film itself. The sprocket perforations
 * and edge codes — which read as physical features of the strip —
 * live in `JourneyReelSprockets` and travel with the scroll content
 * so the film visibly unrolls past the gutters.
 *
 * Light/dark: the structure is identical across both modes; only the
 * stock + leak + grain palette flips, read from `useThemeColors()`.
 *
 * All UI chrome (header, daily-goal strip, tiles, CTA card, bottom
 * nav) is absolutely positioned on top of this; chrome should stay
 * inside x: [32, width - 32] so the sprocket gutters remain visible.
 */

import { useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, {
  Defs,
  Rect,
  RadialGradient,
  LinearGradient,
  Stop,
  Filter,
  FeTurbulence,
  FeColorMatrix,
  FeGaussianBlur,
  G,
  Circle,
} from 'react-native-svg';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';

interface Props {
  width?: number;
  height?: number;
}

const GUTTER_W = 30;

// Deterministic dust positions normalized to [0,1] × [0,1].
const DUST: Array<{ x: number; y: number; r: number }> = [
  { x: 0.18, y: 0.07, r: 1.0 },
  { x: 0.42, y: 0.13, r: 1.3 },
  { x: 0.71, y: 0.09, r: 1.0 },
  { x: 0.29, y: 0.24, r: 1.2 },
  { x: 0.58, y: 0.31, r: 1.0 },
  { x: 0.83, y: 0.27, r: 1.5 },
  { x: 0.21, y: 0.46, r: 1.0 },
  { x: 0.49, y: 0.52, r: 1.3 },
  { x: 0.77, y: 0.58, r: 1.0 },
  { x: 0.34, y: 0.71, r: 1.2 },
  { x: 0.62, y: 0.79, r: 1.0 },
  { x: 0.46, y: 0.91, r: 1.4 },
];

// Splits an rgba(r,g,b,a) string into solid rgb() + opacity. Falls back
// gracefully for hex values (returns the input + opacity 1).
function splitRgba(input: string): { color: string; opacity: number } {
  const m = input.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)/i);
  if (!m) return { color: input, opacity: 1 };
  const r = m[1], g = m[2], b = m[3];
  const a = m[4] != null ? parseFloat(m[4]) : 1;
  return { color: `rgb(${r}, ${g}, ${b})`, opacity: a };
}

export function JourneyReelBackground({ width: wProp, height: hProp }: Props) {
  const tc = useThemeColors();
  const [size, setSize] = useState<{ w: number; h: number }>({
    w: wProp ?? 402,
    h: hProp ?? 874,
  });

  const onLayout = (e: LayoutChangeEvent) => {
    if (wProp != null && hProp != null) return;
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0 && (width !== size.w || height !== size.h)) {
      setSize({ w: wProp ?? width, h: hProp ?? height });
    }
  };

  const W = size.w;
  const H = size.h;

  const leakWarm = useMemo(() => splitRgba(tc.reelLeakWarm), [tc.reelLeakWarm]);
  const leakCool = useMemo(() => splitRgba(tc.reelLeakCool), [tc.reelLeakCool]);
  const sprocketShadow = useMemo(() => splitRgba(tc.reelSprocketShadow), [tc.reelSprocketShadow]);
  const scratchTone = useMemo(() => splitRgba(tc.reelScratch), [tc.reelScratch]);

  return (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: tc.reelStock }]}
      pointerEvents="none"
      onLayout={onLayout}
    >
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
      >
        <Defs>
          {/* Film-stock radial gradient */}
          <RadialGradient
            id="reel-stock"
            cx="50%"
            cy="50%"
            rx="60%"
            ry="35%"
            fx="50%"
            fy="50%"
          >
            <Stop offset="0%" stopColor={tc.reelStockLight} stopOpacity="1" />
            <Stop offset="60%" stopColor={tc.reelStock} stopOpacity="1" />
            <Stop offset="100%" stopColor={tc.reelStockDeep} stopOpacity="1" />
          </RadialGradient>

          {/* Warm leak (top-right) */}
          <RadialGradient
            id="reel-leak-primary"
            cx="50%"
            cy="50%"
            rx="50%"
            ry="50%"
          >
            <Stop offset="0%" stopColor={leakWarm.color} stopOpacity={leakWarm.opacity} />
            <Stop offset="35%" stopColor={leakWarm.color} stopOpacity={leakWarm.opacity * 0.45} />
            <Stop offset="75%" stopColor={leakWarm.color} stopOpacity={0} />
          </RadialGradient>
          {/* Cool leak (top-left) */}
          <RadialGradient
            id="reel-leak-secondary"
            cx="50%"
            cy="50%"
            rx="50%"
            ry="50%"
          >
            <Stop offset="0%" stopColor={leakCool.color} stopOpacity={leakCool.opacity} />
            <Stop offset="70%" stopColor={leakCool.color} stopOpacity={0} />
          </RadialGradient>

          {/* Gutter gradients */}
          <LinearGradient id="reel-gutter-left" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0%" stopColor={tc.reelStockDeep} stopOpacity="1" />
            <Stop offset="80%" stopColor={tc.reelStock} stopOpacity="1" />
            <Stop offset="100%" stopColor={tc.reelStock} stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id="reel-gutter-right" x1="1" y1="0" x2="0" y2="0">
            <Stop offset="0%" stopColor={tc.reelStockDeep} stopOpacity="1" />
            <Stop offset="80%" stopColor={tc.reelStock} stopOpacity="1" />
            <Stop offset="100%" stopColor={tc.reelStock} stopOpacity="0" />
          </LinearGradient>

          {/* Film-grain filter */}
          <Filter
            id="reel-grain"
            x="0%"
            y="0%"
            width="100%"
            height="100%"
          >
            <FeTurbulence
              type="fractalNoise"
              baseFrequency="1.5"
              numOctaves={2}
              seed={7}
            />
            <FeColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.4 0" />
          </Filter>

          {/* Light-leak blur filters */}
          <Filter id="reel-blur-20" x="-20%" y="-20%" width="140%" height="140%">
            <FeGaussianBlur stdDeviation="20" />
          </Filter>
          <Filter id="reel-blur-28" x="-20%" y="-20%" width="140%" height="140%">
            <FeGaussianBlur stdDeviation="28" />
          </Filter>
        </Defs>

        {/* 1. Film-stock base */}
        <Rect x={0} y={0} width={W} height={H} fill={tc.reelStock} />
        <Rect x={0} y={0} width={W} height={H} fill="url(#reel-stock)" />

        {/* 2. Light leaks — screen-blended warm + cool blobs */}
        <G mixBlendMode="screen">
          <Rect
            x={W - 60 - 360}
            y={-80}
            width={360}
            height={320}
            fill="url(#reel-leak-primary)"
            filter="url(#reel-blur-20)"
          />
          <Rect
            x={-80}
            y={-40}
            width={280}
            height={240}
            fill="url(#reel-leak-secondary)"
            filter="url(#reel-blur-28)"
          />
        </G>

        {/* 3. Film grain — blend mode flips per theme. */}
        <G opacity={0.35} mixBlendMode={tc.reelGrainBlendMode}>
          <Rect
            x={0}
            y={0}
            width={W}
            height={H}
            filter="url(#reel-grain)"
          />
        </G>

        {/* 4. Dust specks */}
        <G opacity={0.5}>
          {DUST.map((d, i) => (
            <Circle
              key={`dust-${i}`}
              cx={d.x * W}
              cy={d.y * H}
              r={d.r}
              fill={tc.reelDust}
              opacity={0.7}
            />
          ))}
        </G>

        {/* 5. Sprocket gutters */}
        <Rect x={0} y={0} width={GUTTER_W} height={H} fill="url(#reel-gutter-left)" />
        <Rect
          x={W - GUTTER_W}
          y={0}
          width={GUTTER_W}
          height={H}
          fill="url(#reel-gutter-right)"
        />
        {/* Gutter inner-edge seams (1px crisp line) */}
        <Rect
          x={GUTTER_W - 1}
          y={0}
          width={1}
          height={H}
          fill={sprocketShadow.color}
          opacity={sprocketShadow.opacity * 0.5}
        />
        <Rect
          x={W - GUTTER_W}
          y={0}
          width={1}
          height={H}
          fill={sprocketShadow.color}
          opacity={sprocketShadow.opacity * 0.5}
        />

        {/* 6 + 7. Sprocket perforations and edge codes are rendered by
            JourneyReelSprockets inside the ScrollView's content so they
            travel with the film while the gutters above stay fixed. */}

        {/* 8. Emulsion scratches — two stacked vertical repeating patterns,
            rendered as discrete rects (no repeating-linear-gradient in SVG). */}
        <G>
          {Array.from({ length: Math.ceil(W / 10) }).map((_, i) => (
            <Rect
              key={`scr-h-${i}`}
              x={i * 10 + 9}
              y={0}
              width={1}
              height={H}
              fill={scratchTone.color}
              opacity={scratchTone.opacity * 0.5}
            />
          ))}
          {Array.from({ length: Math.ceil(W / 48) }).map((_, i) => (
            <Rect
              key={`scr-d-${i}`}
              x={i * 48 + 47}
              y={0}
              width={1}
              height={H}
              fill={scratchTone.color}
              opacity={scratchTone.opacity}
            />
          ))}
        </G>
      </Svg>
    </View>
  );
}

// Exported for callers that need the same tokens (e.g. JourneyScreen's
// top-fade gradient colour-match).
export type ReelStockTokens = Pick<ThemeColors, 'reelStock' | 'reelStockDeep' | 'reelStockLight'>;
