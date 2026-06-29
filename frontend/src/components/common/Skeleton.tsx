/**
 * Skeleton — web shimmer primitive (Motion §E3). A `tc.skeleton`-tinted block
 * with a sweeping `tc.skeletonSheen` band via a CSS keyframe. Honors
 * prefers-reduced-motion (the keyframe is disabled by the media query).
 *
 * Mirrors apps/mobile/src/components/ui/Skeleton.tsx's sheen look.
 */

import type { CSSProperties } from 'react';
import { useThemeColors } from '../../theme/tokens';

let injected = false;
function ensureKeyframes() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const el = document.createElement('style');
  el.textContent = `
@keyframes wwSkeletonSheen { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
.ww-skeleton-sheen { animation: wwSkeletonSheen 1.2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .ww-skeleton-sheen { animation: none; } }
`;
  document.head.appendChild(el);
}

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number;
  style?: CSSProperties;
}

export function Skeleton({ width = '100%', height = 12, radius = 6, style }: SkeletonProps) {
  const t = useThemeColors();
  ensureKeyframes();
  return (
    <div style={{ width, height, borderRadius: radius, background: t.skeleton, position: 'relative', overflow: 'hidden', ...style }}>
      <div
        className="ww-skeleton-sheen"
        style={{ position: 'absolute', inset: 0, background: `linear-gradient(90deg, transparent, ${t.skeletonSheen}, transparent)` }}
      />
    </div>
  );
}
