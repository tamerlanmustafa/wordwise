/**
 * NotFoundPage — catch-all for unknown routes (UX audit F-032/F-035). Without
 * it, navigating to an undefined path (e.g. the sidebar's not-yet-built
 * Practice/Stats) rendered an empty shell. Renders inside AppShell with a way
 * back home.
 */

import { useNavigate } from 'react-router-dom';
import { useThemeColors, SERIF } from '../theme/tokens';

export default function NotFoundPage() {
  const t = useThemeColors();
  const navigate = useNavigate();
  return (
    <div
      style={{
        minHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '48px 24px',
        color: t.text,
      }}
    >
      <div style={{ fontFamily: SERIF, fontSize: 26, fontWeight: 700, letterSpacing: -0.4 }}>Not here yet</div>
      <div style={{ marginTop: 10, fontSize: 15, color: t.text2, maxWidth: 380, lineHeight: 1.5 }}>
        This page doesn't exist (or hasn't landed on web yet). Let's get you back on track.
      </div>
      <button
        onClick={() => navigate('/')}
        style={{
          marginTop: 22,
          background: t.gold,
          color: t.goldDeep,
          border: 'none',
          padding: '12px 24px',
          borderRadius: 12,
          fontWeight: 800,
          fontSize: 14,
          letterSpacing: 0.3,
          cursor: 'pointer',
        }}
      >
        Back to Home
      </button>
    </div>
  );
}
