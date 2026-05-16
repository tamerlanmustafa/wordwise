/**
 * JourneyReelSprockets — sprocket perforations + edge codes that span
 * the entire scroll content. Rendered inside the ScrollView so the
 * holes and Kodak-style codes travel with the tiles, while the gutter
 * bands in JourneyReelBackground stay fixed to the viewport. The
 * combined effect: the film visibly unrolls past the viewing window.
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

interface Props {
  width: number;
  height: number;
}

const SPROCKET_PITCH = 26;
const SPROCKET_W = 11;
const SPROCKET_H = 16;

export function JourneyReelSprockets({ width: W, height: H }: Props) {
  const sprocketYs = useMemo(() => {
    const ys: number[] = [];
    for (let y = 8; y < H - 8; y += SPROCKET_PITCH) ys.push(y);
    return ys;
  }, [H]);

  const edgeCodes = useMemo(() => {
    const out: Array<{ y: number; label: string }> = [];
    for (let i = 0; i + 1 < sprocketYs.length; i += 2) {
      const a = sprocketYs[i];
      const b = sprocketYs[i + 1];
      const y = (a + b) / 2 + SPROCKET_H / 2;
      const idx = Math.floor(i / 2);
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
          <Stop offset="0%" stopColor="rgb(0,0,0)" stopOpacity="0.9" />
          <Stop offset="80%" stopColor="rgb(0,0,0)" stopOpacity="0" />
          <Stop offset="100%" stopColor="rgb(255,180,80)" stopOpacity="0.10" />
        </LinearGradient>
      </Defs>

      {sprocketYs.map((y, i) => (
        <G key={`spk-${i}`}>
          <Rect x={9.5} y={y} width={SPROCKET_W} height={SPROCKET_H} rx={2.5} ry={2.5} fill="#050300" />
          <Rect x={9.5} y={y} width={SPROCKET_W} height={SPROCKET_H} rx={2.5} ry={2.5} fill="url(#reel-sprocket-rim-scroll)" />
          <Rect x={W - 9.5 - SPROCKET_W} y={y} width={SPROCKET_W} height={SPROCKET_H} rx={2.5} ry={2.5} fill="#050300" />
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
            fill="rgba(255,180,80,0.55)"
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
