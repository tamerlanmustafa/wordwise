/**
 * JourneyReelSprockets — sprocket perforations + edge codes that span
 * the entire scroll content. Rendered inside the ScrollView so the
 * holes and Kodak-style codes travel with the tiles, while the gutter
 * bands in JourneyReelBackground stay fixed to the viewport. The
 * combined effect: the film visibly unrolls past the viewing window.
 *
 * Light/dark: perforation + edge-code palette comes from tokens.
 * Edge-code density is throttled to every 4th sprocket pair so the
 * markings don't crowd tile number badges.
 */

import { useMemo } from 'react';
import Svg, {
  Defs,
  LinearGradient,
  Rect,
  Stop,
  G,
  Text as SvgText,
} from 'react-native-svg';
import { useThemeColors } from '../../theme/tokens';

interface Props {
  width: number;
  height: number;
}

const SPROCKET_PITCH = 26;
const SPROCKET_W = 11;
const SPROCKET_H = 16;

function splitRgba(input: string): { color: string; opacity: number } {
  const m = input.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)/i);
  if (!m) return { color: input, opacity: 1 };
  const a = m[4] != null ? parseFloat(m[4]) : 1;
  return { color: `rgb(${m[1]}, ${m[2]}, ${m[3]})`, opacity: a };
}

export function JourneyReelSprockets({ width: W, height: H }: Props) {
  const tc = useThemeColors();
  const sprocketShadow = useMemo(() => splitRgba(tc.reelSprocketShadow), [tc.reelSprocketShadow]);
  const edgeCode = useMemo(() => splitRgba(tc.reelEdgeCode), [tc.reelEdgeCode]);

  const sprocketYs = useMemo(() => {
    const ys: number[] = [];
    for (let y = 8; y < H - 8; y += SPROCKET_PITCH) ys.push(y);
    return ys;
  }, [H]);

  // Edge codes — every 4th sprocket pair so number badges aren't crowded.
  const edgeCodes = useMemo(() => {
    const out: Array<{ y: number; label: string }> = [];
    for (let i = 0; i + 1 < sprocketYs.length; i += 4) {
      const a = sprocketYs[i];
      const b = sprocketYs[i + 1];
      const y = (a + b) / 2 + SPROCKET_H / 2;
      const idx = Math.floor(i / 4);
      out.push({ y, label: 'WW·' + String(42 + idx).padStart(3, '0') + 'A' });
    }
    return out;
  }, [sprocketYs]);

  return (
    <Svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      pointerEvents="none"
      style={{ position: 'absolute', top: 0, left: 0 }}
    >
      <Defs>
        <LinearGradient id="reel-sprocket-rim-scroll" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={sprocketShadow.color} stopOpacity={sprocketShadow.opacity} />
          <Stop offset="80%" stopColor={sprocketShadow.color} stopOpacity={0} />
          <Stop offset="100%" stopColor="rgb(255,180,80)" stopOpacity={0.10} />
        </LinearGradient>
      </Defs>

      {sprocketYs.map((y, i) => (
        <G key={`spk-${i}`}>
          <Rect x={9.5} y={y} width={SPROCKET_W} height={SPROCKET_H} rx={2.5} ry={2.5} fill={tc.reelSprocket} />
          <Rect x={9.5} y={y} width={SPROCKET_W} height={SPROCKET_H} rx={2.5} ry={2.5} fill="url(#reel-sprocket-rim-scroll)" />
          <Rect x={W - 9.5 - SPROCKET_W} y={y} width={SPROCKET_W} height={SPROCKET_H} rx={2.5} ry={2.5} fill={tc.reelSprocket} />
          <Rect x={W - 9.5 - SPROCKET_W} y={y} width={SPROCKET_W} height={SPROCKET_H} rx={2.5} ry={2.5} fill="url(#reel-sprocket-rim-scroll)" />
        </G>
      ))}

      {edgeCodes.map((c, i) => {
        const x = W - 6;
        return (
          <SvgText
            key={`ec-${i}`}
            x={x}
            y={c.y}
            fontSize={6}
            fontWeight="700"
            fill={edgeCode.color}
            fillOpacity={edgeCode.opacity}
            letterSpacing={0.2}
            fontFamily='"SF Mono", "Menlo", Consolas, monospace'
            transform={`rotate(-90 ${x} ${c.y})`}
            textAnchor="start"
          >
            {c.label}
          </SvgText>
        );
      })}
    </Svg>
  );
}
